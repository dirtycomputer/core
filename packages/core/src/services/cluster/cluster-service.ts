/**
 * 集群服务
 * 统一管理集群适配器，提供自动检测和任务调度
 */

import { createLogger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import type { ClusterAdapter, ClusterDetectionResult, JobSpec, JobHandle, JobStatus, JobMetrics, LogEntry } from './types';
import { SlurmAdapter } from './slurm-adapter';
import { KubernetesAdapter } from './kubernetes-adapter';
import { SSHAdapter } from './ssh-adapter';

const logger = createLogger('service:cluster');

export class ClusterService {
  private adapters: Map<string, ClusterAdapter> = new Map();
  private defaultAdapter: ClusterAdapter | null = null;

  constructor() {
    this.initializeAdapters();
  }

  /**
   * 初始化适配器
   */
  private initializeAdapters() {
    const config = getConfig();

    // 初始化 Slurm 适配器
    const slurmAdapter = new SlurmAdapter({
      partition: config.cluster.slurm.partition,
      account: config.cluster.slurm.account,
      qos: config.cluster.slurm.qos,
    });
    this.adapters.set('slurm', slurmAdapter);

    // 初始化 Kubernetes 适配器
    const k8sAdapter = new KubernetesAdapter({
      namespace: config.cluster.kubernetes.namespace,
      configPath: config.cluster.kubernetes.configPath,
    });
    this.adapters.set('kubernetes', k8sAdapter);

    // 初始化 SSH 适配器 (如果配置了)
    if (config.cluster.ssh.host && config.cluster.ssh.username) {
      const sshAdapter = new SSHAdapter({
        host: config.cluster.ssh.host,
        port: config.cluster.ssh.port,
        username: config.cluster.ssh.username,
        privateKeyPath: config.cluster.ssh.privateKeyPath,
      });
      this.adapters.set('ssh', sshAdapter);
    }
  }

  /**
   * 检测可用的集群类型
   */
  async detectClusters(): Promise<ClusterDetectionResult[]> {
    const results: ClusterDetectionResult[] = [];

    for (const [type, adapter] of this.adapters) {
      try {
        const available = await adapter.isAvailable();
        results.push({
          type: type as 'slurm' | 'kubernetes' | 'ssh',
          available,
        });
        logger.info({ type, available }, 'Cluster detection result');
      } catch (error) {
        results.push({
          type: type as 'slurm' | 'kubernetes' | 'ssh',
          available: false,
        });
        logger.warn({ type, error }, 'Cluster detection failed');
      }
    }

    return results;
  }

  /**
   * 自动选择最佳集群
   */
  async autoSelectCluster(): Promise<ClusterAdapter | null> {
    const config = getConfig();

    // 优先使用配置的默认类型
    const preferredType = config.cluster.defaultType;
    const preferredAdapter = this.adapters.get(preferredType);

    if (preferredAdapter && await preferredAdapter.isAvailable()) {
      this.defaultAdapter = preferredAdapter;
      logger.info({ type: preferredType }, 'Using preferred cluster type');
      return preferredAdapter;
    }

    // 按优先级尝试其他类型
    const priority = ['slurm', 'kubernetes', 'ssh'];

    for (const type of priority) {
      const adapter = this.adapters.get(type);
      if (adapter && await adapter.isAvailable()) {
        this.defaultAdapter = adapter;
        logger.info({ type }, 'Auto-selected cluster type');
        return adapter;
      }
    }

    logger.warn('No available cluster found');
    return null;
  }

  /**
   * 获取指定类型的适配器
   */
  getAdapter(type: 'slurm' | 'kubernetes' | 'ssh'): ClusterAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * 获取默认适配器
   */
  async getDefaultAdapter(): Promise<ClusterAdapter | null> {
    if (this.defaultAdapter) {
      return this.defaultAdapter;
    }
    return this.autoSelectCluster();
  }

  /**
   * 提交任务
   */
  async submit(job: JobSpec, clusterType?: 'slurm' | 'kubernetes' | 'ssh'): Promise<JobHandle> {
    let adapter: ClusterAdapter | null | undefined;

    if (clusterType) {
      adapter = this.adapters.get(clusterType);
      if (!adapter) {
        throw new Error(`Cluster type '${clusterType}' not configured`);
      }
    } else {
      adapter = await this.getDefaultAdapter();
    }

    if (!adapter) {
      throw new Error('No available cluster');
    }

    return adapter.submit(job);
  }

  /**
   * 获取任务状态
   */
  async status(jobId: string, clusterType: 'slurm' | 'kubernetes' | 'ssh'): Promise<JobStatus> {
    const adapter = this.adapters.get(clusterType);
    if (!adapter) {
      throw new Error(`Cluster type '${clusterType}' not configured`);
    }
    return adapter.status(jobId);
  }

  /**
   * 取消任务
   */
  async cancel(jobId: string, clusterType: 'slurm' | 'kubernetes' | 'ssh'): Promise<void> {
    const adapter = this.adapters.get(clusterType);
    if (!adapter) {
      throw new Error(`Cluster type '${clusterType}' not configured`);
    }
    return adapter.cancel(jobId);
  }

  /**
   * 获取任务日志
   */
  async *logs(
    jobId: string,
    clusterType: 'slurm' | 'kubernetes' | 'ssh',
    options?: { follow?: boolean; tail?: number }
  ): AsyncIterable<LogEntry> {
    const adapter = this.adapters.get(clusterType);
    if (!adapter) {
      throw new Error(`Cluster type '${clusterType}' not configured`);
    }
    yield* adapter.logs(jobId, options);
  }

  /**
   * 获取任务指标
   */
  async metrics(jobId: string, clusterType: 'slurm' | 'kubernetes' | 'ssh'): Promise<JobMetrics> {
    const adapter = this.adapters.get(clusterType);
    if (!adapter) {
      throw new Error(`Cluster type '${clusterType}' not configured`);
    }
    return adapter.metrics(jobId);
  }

  /**
   * 列出任务
   */
  async listJobs(clusterType: 'slurm' | 'kubernetes' | 'ssh'): Promise<JobStatus[]> {
    const adapter = this.adapters.get(clusterType);
    if (!adapter) {
      throw new Error(`Cluster type '${clusterType}' not configured`);
    }
    return adapter.listJobs();
  }
}

// 单例导出
export const clusterService = new ClusterService();
