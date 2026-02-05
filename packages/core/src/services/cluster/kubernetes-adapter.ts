/**
 * Kubernetes 集群适配器
 * 通过 @kubernetes/client-node 与 K8s 交互
 */

import * as k8s from '@kubernetes/client-node';
import { createLogger } from '../../utils/logger';
import { generateShortId } from '../../utils/id';
import type {
  ClusterAdapter,
  JobSpec,
  JobHandle,
  JobStatus,
  JobState,
  JobMetrics,
  LogEntry,
} from './types';

const logger = createLogger('cluster:kubernetes');

// K8s Job 状态到通用状态的映射
function mapK8sState(job: k8s.V1Job): JobState {
  const status = job.status;
  if (!status) return 'unknown';

  if (status.succeeded && status.succeeded > 0) return 'completed';
  if (status.failed && status.failed > 0) return 'failed';
  if (status.active && status.active > 0) return 'running';

  // 检查条件
  const conditions = status.conditions || [];
  for (const cond of conditions) {
    if (cond.type === 'Complete' && cond.status === 'True') return 'completed';
    if (cond.type === 'Failed' && cond.status === 'True') return 'failed';
  }

  return 'pending';
}

export interface KubernetesConfig {
  namespace?: string;
  configPath?: string;
  inCluster?: boolean;
}

export class KubernetesAdapter implements ClusterAdapter {
  readonly type = 'kubernetes' as const;
  private config: KubernetesConfig;
  private kc: k8s.KubeConfig;
  private batchApi: k8s.BatchV1Api;
  private coreApi: k8s.CoreV1Api;

  constructor(config: KubernetesConfig = {}) {
    this.config = {
      namespace: config.namespace || process.env.K8S_NAMESPACE || 'default',
      configPath: config.configPath || process.env.KUBECONFIG,
      inCluster: config.inCluster || process.env.KUBERNETES_SERVICE_HOST !== undefined,
    };

    this.kc = new k8s.KubeConfig();

    if (this.config.inCluster) {
      this.kc.loadFromCluster();
    } else if (this.config.configPath) {
      this.kc.loadFromFile(this.config.configPath);
    } else {
      this.kc.loadFromDefault();
    }

    this.batchApi = this.kc.makeApiClient(k8s.BatchV1Api);
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.coreApi.listNamespace();
      return true;
    } catch {
      return false;
    }
  }

  async submit(job: JobSpec): Promise<JobHandle> {
    const jobName = `roc-${job.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${generateShortId()}`;
    const namespace = job.namespace || this.config.namespace!;

    const k8sJob: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'roc',
          'roc.io/job-name': job.name,
        },
      },
      spec: {
        backoffLimit: 0,  // 不自动重试
        ttlSecondsAfterFinished: 86400,  // 完成后保留 24 小时
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/managed-by': 'roc',
              'roc.io/job-name': job.name,
            },
          },
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'main',
                image: job.image || 'python:3.10',
                imagePullPolicy: job.imagePullPolicy || 'IfNotPresent',
                command: ['/bin/bash', '-c'],
                args: [job.script],
                workingDir: job.workDir,
                env: job.env
                  ? Object.entries(job.env).map(([name, value]) => ({ name, value }))
                  : undefined,
                resources: {
                  requests: this.buildResourceRequests(job),
                  limits: this.buildResourceLimits(job),
                },
              },
            ],
          },
        },
      },
    };

    // 添加 GPU 资源
    if (job.resources.gpuCount) {
      const container = k8sJob.spec!.template.spec!.containers[0];
      container.resources!.limits = {
        ...container.resources!.limits,
        'nvidia.com/gpu': job.resources.gpuCount.toString(),
      };
    }

    // 添加超时
    if (job.resources.timeLimit) {
      const seconds = this.parseTimeLimit(job.resources.timeLimit);
      k8sJob.spec!.activeDeadlineSeconds = seconds;
    }

    try {
      await this.batchApi.createNamespacedJob(namespace, k8sJob);

      logger.info({ jobId: jobName, namespace }, 'Kubernetes job submitted');

      return {
        jobId: jobName,
        clusterType: 'kubernetes',
        submittedAt: new Date(),
      };
    } catch (error) {
      logger.error({ error, jobName }, 'Failed to submit Kubernetes job');
      throw error;
    }
  }

  async status(jobId: string): Promise<JobStatus> {
    const namespace = this.config.namespace!;

    try {
      const response = await this.batchApi.readNamespacedJob(jobId, namespace);
      const job = response.body;

      const state = mapK8sState(job);
      const status = job.status;

      let reason: string | undefined;
      if (status?.conditions) {
        const failedCond = status.conditions.find((c) => c.type === 'Failed');
        if (failedCond) {
          reason = failedCond.reason || failedCond.message;
        }
      }

      return {
        jobId,
        state,
        startTime: status?.startTime ? new Date(status.startTime) : undefined,
        endTime: status?.completionTime ? new Date(status.completionTime) : undefined,
        reason,
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        return { jobId, state: 'unknown' };
      }
      logger.error({ jobId, error }, 'Failed to get job status');
      return { jobId, state: 'unknown' };
    }
  }

  async cancel(jobId: string): Promise<void> {
    const namespace = this.config.namespace!;

    try {
      // 删除 Job 及其 Pod
      await this.batchApi.deleteNamespacedJob(
        jobId,
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'Background'
      );

      logger.info({ jobId }, 'Kubernetes job cancelled');
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to cancel job');
      throw error;
    }
  }

  async *logs(jobId: string, options?: { follow?: boolean; tail?: number }): AsyncIterable<LogEntry> {
    const namespace = this.config.namespace!;

    try {
      // 获取 Job 的 Pod
      const podsResponse = await this.coreApi.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `job-name=${jobId}`
      );

      const pods = podsResponse.body.items;
      if (pods.length === 0) {
        return;
      }

      const pod = pods[0];
      const podName = pod.metadata!.name!;

      // 获取日志
      if (options?.follow) {
        // 流式日志 - 简化实现，使用轮询
        // 注意: 完整实现需要使用 k8s.Log 的流式 API
        const response = await this.coreApi.readNamespacedPodLog(
          podName,
          namespace,
          'main',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          options?.tail || 100
        );

        const lines = response.body.split('\n').filter(Boolean);
        for (const line of lines) {
          yield {
            timestamp: new Date(),
            stream: 'stdout' as const,
            message: line,
          };
        }
      } else {
        // 一次性获取
        const response = await this.coreApi.readNamespacedPodLog(
          podName,
          namespace,
          'main',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          options?.tail
        );

        const lines = response.body.split('\n').filter(Boolean);
        for (const line of lines) {
          yield {
            timestamp: new Date(),
            stream: 'stdout',
            message: line,
          };
        }
      }
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to get logs');
    }
  }

  async metrics(jobId: string): Promise<JobMetrics> {
    // K8s 原生不提供详细的资源使用指标
    // 需要集成 Prometheus/metrics-server
    // 这里返回基础信息
    return { jobId };
  }

  async listJobs(options?: { state?: JobState[]; limit?: number }): Promise<JobStatus[]> {
    const namespace = this.config.namespace!;

    try {
      const response = await this.batchApi.listNamespacedJob(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'app.kubernetes.io/managed-by=roc',
        options?.limit
      );

      let jobs = response.body.items.map((job) => ({
        jobId: job.metadata!.name!,
        state: mapK8sState(job),
        startTime: job.status?.startTime ? new Date(job.status.startTime) : undefined,
        endTime: job.status?.completionTime ? new Date(job.status.completionTime) : undefined,
      }));

      // 过滤状态
      if (options?.state) {
        jobs = jobs.filter((j) => options.state!.includes(j.state));
      }

      return jobs;
    } catch (error) {
      logger.error({ error }, 'Failed to list jobs');
      return [];
    }
  }

  private buildResourceRequests(job: JobSpec): Record<string, string> {
    const requests: Record<string, string> = {};

    if (job.resources.cpuCount) {
      requests.cpu = job.resources.cpuCount.toString();
    }
    if (job.resources.memoryGb) {
      requests.memory = `${job.resources.memoryGb}Gi`;
    }

    return requests;
  }

  private buildResourceLimits(job: JobSpec): Record<string, string> {
    const limits: Record<string, string> = {};

    if (job.resources.cpuCount) {
      limits.cpu = (job.resources.cpuCount * 2).toString();  // 允许 burst
    }
    if (job.resources.memoryGb) {
      limits.memory = `${job.resources.memoryGb * 1.2}Gi`;  // 20% 余量
    }

    return limits;
  }

  private parseTimeLimit(timeLimit: string): number {
    // 解析 HH:MM:SS 或 DD-HH:MM:SS 格式
    const parts = timeLimit.split('-');
    let days = 0;
    let hms = timeLimit;

    if (parts.length === 2) {
      days = parseInt(parts[0], 10);
      hms = parts[1];
    }

    const [hours, minutes, seconds] = hms.split(':').map(Number);
    return days * 86400 + hours * 3600 + minutes * 60 + (seconds || 0);
  }
}
