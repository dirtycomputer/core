/**
 * Slurm 集群适配器
 * 通过 sbatch/squeue/scancel 等命令与 Slurm 交互
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
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

const execAsync = promisify(exec);
const logger = createLogger('cluster:slurm');

// Slurm 状态到通用状态的映射
const SLURM_STATE_MAP: Record<string, JobState> = {
  'PENDING': 'pending',
  'CONFIGURING': 'pending',
  'RUNNING': 'running',
  'COMPLETING': 'running',
  'COMPLETED': 'completed',
  'FAILED': 'failed',
  'TIMEOUT': 'timeout',
  'CANCELLED': 'cancelled',
  'CANCELLED+': 'cancelled',
  'NODE_FAIL': 'failed',
  'PREEMPTED': 'cancelled',
  'SUSPENDED': 'pending',
  'OUT_OF_MEMORY': 'failed',
};

export interface SlurmConfig {
  partition?: string;
  account?: string;
  qos?: string;
  scriptDir?: string;
}

export class SlurmAdapter implements ClusterAdapter {
  readonly type = 'slurm' as const;
  private config: SlurmConfig;

  constructor(config: SlurmConfig = {}) {
    this.config = {
      partition: config.partition || process.env.SLURM_PARTITION || 'gpu',
      account: config.account || process.env.SLURM_ACCOUNT,
      qos: config.qos || process.env.SLURM_QOS,
      scriptDir: config.scriptDir || '/tmp/roc-slurm-scripts',
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('which sbatch && sinfo --version');
      return stdout.includes('sbatch') && stdout.includes('slurm');
    } catch {
      return false;
    }
  }

  async submit(job: JobSpec): Promise<JobHandle> {
    // 确保脚本目录存在
    await mkdir(this.config.scriptDir!, { recursive: true });

    // 生成 Slurm 脚本
    const scriptContent = this.generateScript(job);
    const scriptPath = join(this.config.scriptDir!, `job_${generateShortId()}.sh`);

    await writeFile(scriptPath, scriptContent, { mode: 0o755 });

    try {
      // 提交任务
      const { stdout } = await execAsync(`sbatch --parsable "${scriptPath}"`, {
        cwd: job.workDir,
        env: { ...process.env, ...job.env },
      });

      const jobId = stdout.trim().split(';')[0];  // 处理可能的 cluster;jobid 格式

      logger.info({ jobId, name: job.name }, 'Slurm job submitted');

      return {
        jobId,
        clusterType: 'slurm',
        submittedAt: new Date(),
      };
    } finally {
      // 清理脚本文件 (可选，保留用于调试)
      // await unlink(scriptPath);
    }
  }

  async status(jobId: string): Promise<JobStatus> {
    try {
      // 首先尝试 squeue (运行中的任务)
      const { stdout: squeueOut } = await execAsync(
        `squeue -j ${jobId} -o "%T|%N|%S|%e|%r" --noheader 2>/dev/null || true`
      );

      if (squeueOut.trim()) {
        const [state, nodeName, startTime, endTime, reason] = squeueOut.trim().split('|');
        return {
          jobId,
          state: SLURM_STATE_MAP[state] || 'unknown',
          nodeName: nodeName !== '(null)' ? nodeName : undefined,
          startTime: startTime && startTime !== 'N/A' ? new Date(startTime) : undefined,
          endTime: endTime && endTime !== 'N/A' ? new Date(endTime) : undefined,
          reason: reason !== '(null)' ? reason : undefined,
        };
      }

      // 如果 squeue 没有结果，尝试 sacct (已完成的任务)
      const { stdout: sacctOut } = await execAsync(
        `sacct -j ${jobId} -o "State,NodeList,Start,End,ExitCode" --noheader --parsable2 2>/dev/null | head -1`
      );

      if (sacctOut.trim()) {
        const [state, nodeName, startTime, endTime, exitCode] = sacctOut.trim().split('|');
        const exitCodeNum = exitCode ? parseInt(exitCode.split(':')[0], 10) : undefined;
        return {
          jobId,
          state: SLURM_STATE_MAP[state] || 'unknown',
          nodeName: nodeName !== '' ? nodeName : undefined,
          startTime: startTime && startTime !== 'Unknown' ? new Date(startTime) : undefined,
          endTime: endTime && endTime !== 'Unknown' ? new Date(endTime) : undefined,
          exitCode: exitCodeNum,
        };
      }

      return { jobId, state: 'unknown' };
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to get job status');
      return { jobId, state: 'unknown' };
    }
  }

  async cancel(jobId: string): Promise<void> {
    try {
      await execAsync(`scancel ${jobId}`);
      logger.info({ jobId }, 'Slurm job cancelled');
    } catch (error) {
      logger.error({ jobId, error }, 'Failed to cancel job');
      throw error;
    }
  }

  async *logs(jobId: string, options?: { follow?: boolean; tail?: number }): AsyncIterable<LogEntry> {
    // 获取任务的输出文件路径
    const { stdout } = await execAsync(
      `scontrol show job ${jobId} | grep -E "StdOut|StdErr" || true`
    );

    const stdoutMatch = stdout.match(/StdOut=(\S+)/);
    const stderrMatch = stdout.match(/StdErr=(\S+)/);

    const stdoutPath = stdoutMatch?.[1];
    const stderrPath = stderrMatch?.[1];

    if (!stdoutPath && !stderrPath) {
      return;
    }

    // 使用 tail 读取日志
    const tailArgs = options?.follow ? ['-f'] : [];
    if (options?.tail) {
      tailArgs.push('-n', options.tail.toString());
    }

    if (stdoutPath) {
      const tailProcess = spawn('tail', [...tailArgs, stdoutPath]);

      for await (const chunk of tailProcess.stdout) {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          yield {
            timestamp: new Date(),
            stream: 'stdout',
            message: line,
          };
        }
      }
    }
  }

  async metrics(jobId: string): Promise<JobMetrics> {
    try {
      const { stdout } = await execAsync(
        `sacct -j ${jobId} -o "CPUTime,MaxRSS,Elapsed" --noheader --parsable2 2>/dev/null | head -1`
      );

      if (!stdout.trim()) {
        return { jobId };
      }

      const [cpuTime, maxRss, elapsed] = stdout.trim().split('|');

      return {
        jobId,
        cpuTime: this.parseTime(cpuTime),
        wallTime: this.parseTime(elapsed),
        memoryUsage: maxRss ? parseInt(maxRss, 10) / 1024 : undefined,  // KB to MB
      };
    } catch {
      return { jobId };
    }
  }

  async listJobs(options?: { state?: JobState[]; limit?: number }): Promise<JobStatus[]> {
    try {
      let cmd = 'squeue -u $USER -o "%i|%T|%N|%S|%e|%r" --noheader';

      if (options?.state) {
        const slurmStates = options.state
          .map((s) => Object.entries(SLURM_STATE_MAP).find(([, v]) => v === s)?.[0])
          .filter(Boolean);
        if (slurmStates.length > 0) {
          cmd += ` -t ${slurmStates.join(',')}`;
        }
      }

      const { stdout } = await execAsync(cmd);

      const jobs = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [jobId, state, nodeName, startTime, endTime, reason] = line.split('|');
          return {
            jobId,
            state: SLURM_STATE_MAP[state] || 'unknown',
            nodeName: nodeName !== '(null)' ? nodeName : undefined,
            startTime: startTime && startTime !== 'N/A' ? new Date(startTime) : undefined,
            endTime: endTime && endTime !== 'N/A' ? new Date(endTime) : undefined,
            reason: reason !== '(null)' ? reason : undefined,
          } as JobStatus;
        });

      return options?.limit ? jobs.slice(0, options.limit) : jobs;
    } catch {
      return [];
    }
  }

  /**
   * 生成 Slurm 脚本
   */
  private generateScript(job: JobSpec): string {
    const lines: string[] = ['#!/bin/bash'];

    // SBATCH 指令
    lines.push(`#SBATCH --job-name=${job.name}`);
    lines.push(`#SBATCH --output=${job.workDir}/slurm-%j.out`);
    lines.push(`#SBATCH --error=${job.workDir}/slurm-%j.err`);

    const partition = job.partition || this.config.partition;
    if (partition) {
      lines.push(`#SBATCH --partition=${partition}`);
    }

    const account = job.account || this.config.account;
    if (account) {
      lines.push(`#SBATCH --account=${account}`);
    }

    const qos = job.qos || this.config.qos;
    if (qos) {
      lines.push(`#SBATCH --qos=${qos}`);
    }

    // 资源配置
    if (job.resources.gpuCount) {
      const gpuSpec = job.resources.gpuType
        ? `${job.resources.gpuType}:${job.resources.gpuCount}`
        : job.resources.gpuCount.toString();
      lines.push(`#SBATCH --gres=gpu:${gpuSpec}`);
    }

    if (job.resources.cpuCount) {
      lines.push(`#SBATCH --cpus-per-task=${job.resources.cpuCount}`);
    }

    if (job.resources.memoryGb) {
      lines.push(`#SBATCH --mem=${job.resources.memoryGb}G`);
    }

    if (job.resources.timeLimit) {
      lines.push(`#SBATCH --time=${job.resources.timeLimit}`);
    }

    // 依赖
    if (job.dependencies && job.dependencies.length > 0) {
      lines.push(`#SBATCH --dependency=afterok:${job.dependencies.join(':')}`);
    }

    lines.push('');

    // 环境变量
    if (job.env) {
      for (const [key, value] of Object.entries(job.env)) {
        lines.push(`export ${key}="${value}"`);
      }
      lines.push('');
    }

    // 工作目录
    lines.push(`cd "${job.workDir}"`);
    lines.push('');

    // 主脚本
    lines.push(job.script);

    return lines.join('\n');
  }

  /**
   * 解析时间字符串 (DD-HH:MM:SS 或 HH:MM:SS)
   */
  private parseTime(timeStr: string): number | undefined {
    if (!timeStr) return undefined;

    const parts = timeStr.split('-');
    let days = 0;
    let hms = timeStr;

    if (parts.length === 2) {
      days = parseInt(parts[0], 10);
      hms = parts[1];
    }

    const [hours, minutes, seconds] = hms.split(':').map(Number);
    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }
}
