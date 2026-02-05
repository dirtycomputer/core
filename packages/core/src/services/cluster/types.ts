/**
 * 集群适配器统一接口
 */

export interface JobSpec {
  name: string;
  script: string;
  workDir: string;
  env?: Record<string, string>;
  resources: {
    gpuType?: string;
    gpuCount?: number;
    cpuCount?: number;
    memoryGb?: number;
    timeLimit?: string;  // e.g., "24:00:00"
  };
  // Slurm 特定
  partition?: string;
  account?: string;
  qos?: string;
  // Kubernetes 特定
  namespace?: string;
  image?: string;
  imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
  // 通用
  priority?: number;
  dependencies?: string[];  // 依赖的任务 ID
}

export interface JobHandle {
  jobId: string;
  clusterType: 'slurm' | 'kubernetes' | 'ssh';
  submittedAt: Date;
}

export type JobState =
  | 'pending'    // 等待调度
  | 'queued'     // 已入队
  | 'running'    // 运行中
  | 'completed'  // 成功完成
  | 'failed'     // 失败
  | 'cancelled'  // 已取消
  | 'timeout'    // 超时
  | 'unknown';   // 未知状态

export interface JobStatus {
  jobId: string;
  state: JobState;
  nodeName?: string;
  startTime?: Date;
  endTime?: Date;
  exitCode?: number;
  reason?: string;
}

export interface JobMetrics {
  jobId: string;
  cpuUsage?: number;      // 百分比
  memoryUsage?: number;   // 百分比
  gpuUsage?: number;      // 百分比
  gpuMemory?: number;     // 百分比
  wallTime?: number;      // 秒
  cpuTime?: number;       // 秒
}

export interface LogEntry {
  timestamp: Date;
  stream: 'stdout' | 'stderr';
  message: string;
}

/**
 * 集群适配器接口
 */
export interface ClusterAdapter {
  /**
   * 适配器类型
   */
  readonly type: 'slurm' | 'kubernetes' | 'ssh';

  /**
   * 检查集群是否可用
   */
  isAvailable(): Promise<boolean>;

  /**
   * 提交任务
   */
  submit(job: JobSpec): Promise<JobHandle>;

  /**
   * 获取任务状态
   */
  status(jobId: string): Promise<JobStatus>;

  /**
   * 取消任务
   */
  cancel(jobId: string): Promise<void>;

  /**
   * 获取任务日志
   */
  logs(jobId: string, options?: { follow?: boolean; tail?: number }): AsyncIterable<LogEntry>;

  /**
   * 获取任务资源使用指标
   */
  metrics(jobId: string): Promise<JobMetrics>;

  /**
   * 列出当前用户的任务
   */
  listJobs(options?: { state?: JobState[]; limit?: number }): Promise<JobStatus[]>;
}

/**
 * 集群类型检测结果
 */
export interface ClusterDetectionResult {
  type: 'slurm' | 'kubernetes' | 'ssh' | 'none';
  available: boolean;
  version?: string;
  info?: Record<string, unknown>;
}
