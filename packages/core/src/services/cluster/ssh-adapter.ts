/**
 * SSH 集群适配器
 * 通过 SSH 直接在远程机器上执行任务
 */

import { Client, ConnectConfig } from 'ssh2';
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
import { readFile } from 'fs/promises';

const logger = createLogger('cluster:ssh');

export interface SSHConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKey?: string;
}

interface SSHJob {
  id: string;
  pid?: number;
  state: JobState;
  startTime?: Date;
  endTime?: Date;
  logPath: string;
  pidFile: string;
}

export class SSHAdapter implements ClusterAdapter {
  readonly type = 'ssh' as const;
  private config: SSHConfig;
  private jobs: Map<string, SSHJob> = new Map();

  constructor(config: SSHConfig) {
    this.config = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      privateKeyPath: config.privateKeyPath,
      privateKey: config.privateKey,
    };
  }

  private async getConnection(): Promise<Client> {
    const conn = new Client();

    const connectConfig: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
    };

    if (this.config.password) {
      connectConfig.password = this.config.password;
    } else if (this.config.privateKey) {
      connectConfig.privateKey = this.config.privateKey;
    } else if (this.config.privateKeyPath) {
      connectConfig.privateKey = await readFile(this.config.privateKeyPath, 'utf-8');
    }

    return new Promise((resolve, reject) => {
      conn.on('ready', () => resolve(conn));
      conn.on('error', reject);
      conn.connect(connectConfig);
    });
  }

  private async execCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const conn = await this.getConnection();

    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          conn.end();
          resolve({ stdout, stderr, code });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const conn = await this.getConnection();
      conn.end();
      return true;
    } catch {
      return false;
    }
  }

  async submit(job: JobSpec): Promise<JobHandle> {
    const jobId = `ssh-${generateShortId()}`;
    const logPath = `${job.workDir}/${jobId}.log`;
    const pidFile = `${job.workDir}/${jobId}.pid`;
    const scriptPath = `${job.workDir}/${jobId}.sh`;

    // 创建脚本
    const scriptContent = this.generateScript(job, logPath, pidFile);

    // 写入脚本并执行
    const writeCmd = `cat > "${scriptPath}" << 'ROCEOF'\n${scriptContent}\nROCEOF\nchmod +x "${scriptPath}"`;
    await this.execCommand(writeCmd);

    // 后台执行
    const execCmd = `cd "${job.workDir}" && nohup "${scriptPath}" > /dev/null 2>&1 &`;
    await this.execCommand(execCmd);

    // 等待 PID 文件生成
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 读取 PID
    const { stdout: pidStr } = await this.execCommand(`cat "${pidFile}" 2>/dev/null || echo ""`);
    const pid = pidStr.trim() ? parseInt(pidStr.trim(), 10) : undefined;

    const sshJob: SSHJob = {
      id: jobId,
      pid,
      state: 'running',
      startTime: new Date(),
      logPath,
      pidFile,
    };

    this.jobs.set(jobId, sshJob);

    logger.info({ jobId, pid }, 'SSH job submitted');

    return {
      jobId,
      clusterType: 'ssh',
      submittedAt: new Date(),
    };
  }

  async status(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { jobId, state: 'unknown' };
    }

    if (!job.pid) {
      return { jobId, state: job.state };
    }

    // 检查进程是否还在运行
    const { code } = await this.execCommand(`ps -p ${job.pid} > /dev/null 2>&1`);

    if (code === 0) {
      // 进程还在运行
      return {
        jobId,
        state: 'running',
        startTime: job.startTime,
      };
    }

    // 进程已结束，检查退出码
    const { stdout: exitCodeStr } = await this.execCommand(
      `cat "${job.logPath}.exit" 2>/dev/null || echo ""`
    );

    const exitCode = exitCodeStr.trim() ? parseInt(exitCodeStr.trim(), 10) : undefined;
    const state: JobState = exitCode === 0 ? 'completed' : 'failed';

    job.state = state;
    job.endTime = new Date();

    return {
      jobId,
      state,
      startTime: job.startTime,
      endTime: job.endTime,
      exitCode,
    };
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !job.pid) {
      return;
    }

    await this.execCommand(`kill -TERM ${job.pid} 2>/dev/null || true`);
    job.state = 'cancelled';
    job.endTime = new Date();

    logger.info({ jobId }, 'SSH job cancelled');
  }

  async *logs(jobId: string, options?: { follow?: boolean; tail?: number }): AsyncIterable<LogEntry> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    const tailArgs = options?.tail ? `-n ${options.tail}` : '';

    if (options?.follow) {
      // 流式日志 - 简化实现，定期轮询
      let lastSize = 0;
      while (true) {
        const { stdout } = await this.execCommand(
          `tail -c +${lastSize + 1} "${job.logPath}" 2>/dev/null || true`
        );

        if (stdout) {
          lastSize += stdout.length;
          const lines = stdout.split('\n').filter(Boolean);
          for (const line of lines) {
            yield {
              timestamp: new Date(),
              stream: 'stdout',
              message: line,
            };
          }
        }

        // 检查任务是否结束
        const status = await this.status(jobId);
        if (!['running', 'pending'].includes(status.state)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      const { stdout } = await this.execCommand(
        `tail ${tailArgs} "${job.logPath}" 2>/dev/null || true`
      );

      const lines = stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        yield {
          timestamp: new Date(),
          stream: 'stdout',
          message: line,
        };
      }
    }
  }

  async metrics(jobId: string): Promise<JobMetrics> {
    const job = this.jobs.get(jobId);
    if (!job || !job.pid) {
      return { jobId };
    }

    try {
      const { stdout } = await this.execCommand(
        `ps -p ${job.pid} -o %cpu,%mem --no-headers 2>/dev/null || echo ""`
      );

      if (stdout.trim()) {
        const [cpu, mem] = stdout.trim().split(/\s+/).map(parseFloat);
        return {
          jobId,
          cpuUsage: cpu,
          memoryUsage: mem,
        };
      }
    } catch {
      // ignore
    }

    return { jobId };
  }

  async listJobs(options?: { state?: JobState[]; limit?: number }): Promise<JobStatus[]> {
    let jobs = Array.from(this.jobs.values()).map((job) => ({
      jobId: job.id,
      state: job.state,
      startTime: job.startTime,
      endTime: job.endTime,
    }));

    if (options?.state) {
      jobs = jobs.filter((j) => options.state!.includes(j.state));
    }

    if (options?.limit) {
      jobs = jobs.slice(0, options.limit);
    }

    return jobs;
  }

  private generateScript(job: JobSpec, logPath: string, pidFile: string): string {
    const lines: string[] = ['#!/bin/bash'];

    // 记录 PID
    lines.push(`echo $$ > "${pidFile}"`);

    // 环境变量
    if (job.env) {
      for (const [key, value] of Object.entries(job.env)) {
        lines.push(`export ${key}="${value}"`);
      }
    }

    // 工作目录
    lines.push(`cd "${job.workDir}"`);

    // 主脚本，重定向输出
    lines.push(`(`);
    lines.push(job.script);
    lines.push(`) > "${logPath}" 2>&1`);

    // 记录退出码
    lines.push(`echo $? > "${logPath}.exit"`);

    return lines.join('\n');
  }
}
