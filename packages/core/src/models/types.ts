/**
 * 核心数据模型定义
 * Research Orchestration Cockpit
 */

// ============ 项目 (Project) ============
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived';

export interface ProjectConstraints {
  budget?: number;           // GPU小时预算
  deadline?: Date | string;  // 截止日期
  resources?: string[];      // 可用资源列表
  maxConcurrentRuns?: number; // 最大并发运行数
}

export interface Project {
  id: string;
  name: string;
  description: string;
  researchGoal: string;
  constraints: ProjectConstraints;
  baselineMetrics: Record<string, number>;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  tags?: string[];
}

// ============ 实验组 (ExperimentGroup) ============
export type ExperimentGroupType = 'baseline' | 'improvement' | 'ablation' | 'exploration';
export type ExperimentGroupStatus = 'draft' | 'approved' | 'running' | 'completed' | 'cancelled';

export interface ExperimentGroup {
  id: string;
  projectId: string;
  name: string;
  type: ExperimentGroupType;
  hypothesis: string;
  expectedImpact: string;
  verificationMethod: string;
  status: ExperimentGroupStatus;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
}

// ============ 实验 (Experiment) ============
export type ExperimentStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExperimentConfig {
  // 模型配置
  model: {
    name: string;
    architecture?: string;
    pretrained?: string;
  };
  // 数据配置
  data: {
    dataset: string;
    trainSplit?: string;
    valSplit?: string;
    testSplit?: string;
    preprocessing?: Record<string, unknown>;
  };
  // 训练配置
  training: {
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    optimizer?: string;
    scheduler?: string;
    warmupSteps?: number;
    gradientAccumulation?: number;
    mixedPrecision?: boolean;
  };
  // 资源配置
  resources: {
    gpuType?: string;
    gpuCount?: number;
    cpuCount?: number;
    memoryGb?: number;
    timeLimit?: string;  // e.g., "24:00:00"
  };
  // 其他配置
  extra?: Record<string, unknown>;
}

export interface Experiment {
  id: string;
  groupId: string;
  name: string;
  description?: string;
  config: ExperimentConfig;
  variables: Record<string, unknown>;       // 实验变量（本实验特有）
  controlVariables: Record<string, unknown>; // 控制变量（与对照组相同）
  status: ExperimentStatus;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  codeSnapshot?: string;  // Git commit hash 或代码快照路径
}

// ============ 运行实例 (Run) ============
export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface RunMetrics {
  // 训练指标
  trainLoss?: number;
  valLoss?: number;
  testLoss?: number;
  // 性能指标
  accuracy?: number;
  f1Score?: number;
  precision?: number;
  recall?: number;
  // 其他自定义指标
  [key: string]: number | undefined;
}

export interface Run {
  id: string;
  experimentId: string;
  attempt: number;
  clusterType: 'slurm' | 'kubernetes' | 'ssh';
  clusterJobId?: string;
  status: RunStatus;
  startTime?: Date;
  endTime?: Date;
  metrics: RunMetrics;
  finalMetrics?: RunMetrics;
  checkpointPath?: string;
  logPath?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============ 工件 (Artifact) ============
export type ArtifactType = 'checkpoint' | 'log' | 'metric' | 'figure' | 'report' | 'code' | 'config' | 'other';

export interface Artifact {
  id: string;
  runId: string;
  type: ArtifactType;
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ============ 告警 (Alert) ============
export type AlertType = 'crash' | 'oom' | 'metric_drift' | 'no_progress' | 'resource_waste' | 'timeout' | 'custom';
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  runId: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

// ============ 报告 (Report) ============
export type ReportType = 'experiment' | 'ablation' | 'comparison' | 'final';
export type ReportStatus = 'draft' | 'generating' | 'completed' | 'failed';

export interface ReportSection {
  title: string;
  content: string;
  figures?: string[];
  tables?: string[];
}

export interface Report {
  id: string;
  projectId: string;
  type: ReportType;
  title: string;
  status: ReportStatus;
  sections: ReportSection[];
  latexSource?: string;
  pdfPath?: string;
  createdAt: Date;
  updatedAt: Date;
  generatedAt?: Date;
}

// ============ 审批 (Approval) ============
export type ApprovalType = 'plan' | 'experiment' | 'resource' | 'report';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Approval {
  id: string;
  type: ApprovalType;
  targetId: string;  // 关联的项目/实验组/实验ID
  requesterId: string;
  reviewerId?: string;
  status: ApprovalStatus;
  comment?: string;
  createdAt: Date;
  reviewedAt?: Date;
}

// ============ 用户 (User) ============
export type UserRole = 'admin' | 'researcher' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  lastLoginAt?: Date;
}
