/**
 * Drizzle ORM Schema 定义
 * PostgreSQL 数据库表结构
 */

import { pgTable, varchar, text, timestamp, jsonb, integer, pgEnum, index, uniqueIndex, boolean } from 'drizzle-orm/pg-core';

// ============ 枚举类型 ============
export const projectStatusEnum = pgEnum('project_status', ['planning', 'active', 'completed', 'archived']);
export const experimentGroupTypeEnum = pgEnum('experiment_group_type', ['baseline', 'improvement', 'ablation', 'exploration']);
export const experimentGroupStatusEnum = pgEnum('experiment_group_status', ['draft', 'approved', 'running', 'completed', 'cancelled']);
export const experimentStatusEnum = pgEnum('experiment_status', ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled']);
export const runStatusEnum = pgEnum('run_status', ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'timeout']);
export const artifactTypeEnum = pgEnum('artifact_type', ['checkpoint', 'log', 'metric', 'figure', 'report', 'code', 'config', 'other']);
export const alertTypeEnum = pgEnum('alert_type', ['crash', 'oom', 'metric_drift', 'no_progress', 'resource_waste', 'timeout', 'custom']);
export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'error', 'critical']);
export const alertStatusEnum = pgEnum('alert_status', ['active', 'acknowledged', 'resolved']);
export const reportTypeEnum = pgEnum('report_type', ['experiment', 'ablation', 'comparison', 'final']);
export const reportStatusEnum = pgEnum('report_status', ['draft', 'generating', 'completed', 'failed']);
export const approvalTypeEnum = pgEnum('approval_type', ['plan', 'experiment', 'resource', 'report']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'rejected']);
export const userRoleEnum = pgEnum('user_role', ['admin', 'researcher', 'viewer']);
export const clusterTypeEnum = pgEnum('cluster_type', ['slurm', 'kubernetes', 'ssh']);
export const workflowStatusEnum = pgEnum('workflow_status', ['pending', 'running', 'waiting_human', 'completed', 'failed', 'cancelled']);
export const workflowTaskStatusEnum = pgEnum('workflow_task_status', ['pending', 'leased', 'running', 'completed', 'failed', 'cancelled']);
export const workflowEventLevelEnum = pgEnum('workflow_event_level', ['info', 'warning', 'error']);
export const milestoneStatusEnum = pgEnum('milestone_status', ['pending', 'in_progress', 'completed', 'blocked']);
export const scheduleTaskStatusEnum = pgEnum('schedule_task_status', ['todo', 'in_progress', 'waiting_review', 'done', 'blocked']);
export const hitlGateStatusEnum = pgEnum('hitl_gate_status', ['pending', 'approved', 'rejected', 'changes_requested', 'timeout']);
export const datasetStatusEnum = pgEnum('dataset_status', ['discovered', 'curated', 'ready', 'archived']);
export const paperStatusEnum = pgEnum('paper_status', ['discovered', 'downloaded', 'archived']);

// ============ 用户表 ============
export const users = pgTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull().default('researcher'),
  passwordHash: varchar('password_hash', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
}));

// ============ 项目表 ============
export const projects = pgTable('projects', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  researchGoal: text('research_goal').notNull().default(''),
  constraints: jsonb('constraints').notNull().default({}),
  baselineMetrics: jsonb('baseline_metrics').notNull().default({}),
  status: projectStatusEnum('status').notNull().default('planning'),
  tags: jsonb('tags').notNull().default([]),
  ownerId: varchar('owner_id', { length: 36 }).notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('projects_owner_idx').on(table.ownerId),
  statusIdx: index('projects_status_idx').on(table.status),
}));

// ============ 实验组表 ============
export const experimentGroups = pgTable('experiment_groups', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  type: experimentGroupTypeEnum('type').notNull().default('improvement'),
  hypothesis: text('hypothesis').notNull().default(''),
  expectedImpact: text('expected_impact').notNull().default(''),
  verificationMethod: text('verification_method').notNull().default(''),
  status: experimentGroupStatusEnum('status').notNull().default('draft'),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  approvedAt: timestamp('approved_at'),
  approvedBy: varchar('approved_by', { length: 36 }).references(() => users.id),
}, (table) => ({
  projectIdx: index('experiment_groups_project_idx').on(table.projectId),
  statusIdx: index('experiment_groups_status_idx').on(table.status),
}));

// ============ 实验表 ============
export const experiments = pgTable('experiments', {
  id: varchar('id', { length: 36 }).primaryKey(),
  groupId: varchar('group_id', { length: 36 }).notNull().references(() => experimentGroups.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default({}),
  variables: jsonb('variables').notNull().default({}),
  controlVariables: jsonb('control_variables').notNull().default({}),
  status: experimentStatusEnum('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  codeSnapshot: varchar('code_snapshot', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  groupIdx: index('experiments_group_idx').on(table.groupId),
  statusIdx: index('experiments_status_idx').on(table.status),
}));

// ============ 运行实例表 ============
export const runs = pgTable('runs', {
  id: varchar('id', { length: 36 }).primaryKey(),
  experimentId: varchar('experiment_id', { length: 36 }).notNull().references(() => experiments.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull().default(1),
  clusterType: clusterTypeEnum('cluster_type').notNull(),
  clusterJobId: varchar('cluster_job_id', { length: 255 }),
  status: runStatusEnum('status').notNull().default('pending'),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  metrics: jsonb('metrics').notNull().default({}),
  finalMetrics: jsonb('final_metrics'),
  checkpointPath: varchar('checkpoint_path', { length: 1024 }),
  logPath: varchar('log_path', { length: 1024 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  experimentIdx: index('runs_experiment_idx').on(table.experimentId),
  statusIdx: index('runs_status_idx').on(table.status),
  clusterJobIdx: index('runs_cluster_job_idx').on(table.clusterJobId),
}));

// ============ 工件表 ============
export const artifacts = pgTable('artifacts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  runId: varchar('run_id', { length: 36 }).notNull().references(() => runs.id, { onDelete: 'cascade' }),
  type: artifactTypeEnum('type').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  path: varchar('path', { length: 1024 }).notNull(),
  size: integer('size').notNull().default(0),
  mimeType: varchar('mime_type', { length: 127 }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  runIdx: index('artifacts_run_idx').on(table.runId),
  typeIdx: index('artifacts_type_idx').on(table.type),
}));

// ============ 告警表 ============
export const alerts = pgTable('alerts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  runId: varchar('run_id', { length: 36 }).notNull().references(() => runs.id, { onDelete: 'cascade' }),
  type: alertTypeEnum('type').notNull(),
  severity: alertSeverityEnum('severity').notNull().default('warning'),
  status: alertStatusEnum('status').notNull().default('active'),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at'),
  resolvedAt: timestamp('resolved_at'),
}, (table) => ({
  runIdx: index('alerts_run_idx').on(table.runId),
  statusIdx: index('alerts_status_idx').on(table.status),
  severityIdx: index('alerts_severity_idx').on(table.severity),
}));

// ============ 报告表 ============
export const reports = pgTable('reports', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: reportTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  status: reportStatusEnum('status').notNull().default('draft'),
  sections: jsonb('sections').notNull().default([]),
  latexSource: text('latex_source'),
  pdfPath: varchar('pdf_path', { length: 1024 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  generatedAt: timestamp('generated_at'),
}, (table) => ({
  projectIdx: index('reports_project_idx').on(table.projectId),
  statusIdx: index('reports_status_idx').on(table.status),
}));

// ============ 审批表 ============
export const approvals = pgTable('approvals', {
  id: varchar('id', { length: 36 }).primaryKey(),
  type: approvalTypeEnum('type').notNull(),
  targetId: varchar('target_id', { length: 36 }).notNull(),
  requesterId: varchar('requester_id', { length: 36 }).notNull().references(() => users.id),
  reviewerId: varchar('reviewer_id', { length: 36 }).references(() => users.id),
  status: approvalStatusEnum('status').notNull().default('pending'),
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
}, (table) => ({
  targetIdx: index('approvals_target_idx').on(table.targetId),
  statusIdx: index('approvals_status_idx').on(table.status),
  requesterIdx: index('approvals_requester_idx').on(table.requesterId),
}));

// ============ 指标时序表 (用于存储训练过程中的指标) ============
export const metricSeries = pgTable('metric_series', {
  id: varchar('id', { length: 36 }).primaryKey(),
  runId: varchar('run_id', { length: 36 }).notNull().references(() => runs.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 127 }).notNull(),
  step: integer('step').notNull(),
  value: jsonb('value').notNull(),  // 支持数值或复杂结构
  timestamp: timestamp('timestamp').notNull().defaultNow(),
}, (table) => ({
  runNameStepIdx: index('metric_series_run_name_step_idx').on(table.runId, table.name, table.step),
}));

// ============ 工作流实例表 ============
export const workflowInstances = pgTable('workflow_instances', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  status: workflowStatusEnum('status').notNull().default('pending'),
  currentStep: varchar('current_step', { length: 127 }).notNull().default('plan_generate'),
  context: jsonb('context').notNull().default({}),
  errorMessage: text('error_message'),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('workflow_instances_project_idx').on(table.projectId),
  statusIdx: index('workflow_instances_status_idx').on(table.status),
}));

// ============ 工作流任务表 ============
export const workflowTasks = pgTable('workflow_tasks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  workflowId: varchar('workflow_id', { length: 36 }).notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  step: varchar('step', { length: 127 }).notNull(),
  status: workflowTaskStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload').notNull().default({}),
  result: jsonb('result'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAfter: timestamp('run_after').notNull().defaultNow(),
  leaseUntil: timestamp('lease_until'),
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workflowIdx: index('workflow_tasks_workflow_idx').on(table.workflowId),
  statusRunAfterIdx: index('workflow_tasks_status_run_after_idx').on(table.status, table.runAfter),
  leaseIdx: index('workflow_tasks_lease_idx').on(table.leaseUntil),
  idempotencyIdx: uniqueIndex('workflow_tasks_idempotency_idx').on(table.idempotencyKey),
}));

// ============ 工作流事件表 ============
export const workflowEvents = pgTable('workflow_events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  workflowId: varchar('workflow_id', { length: 36 }).notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  taskId: varchar('task_id', { length: 36 }).references(() => workflowTasks.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 127 }).notNull(),
  level: workflowEventLevelEnum('level').notNull().default('info'),
  message: text('message').notNull(),
  data: jsonb('data').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  workflowIdx: index('workflow_events_workflow_idx').on(table.workflowId),
  typeIdx: index('workflow_events_type_idx').on(table.type),
}));

// ============ 项目里程碑表 ============
export const milestones = pgTable('milestones', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  dueDate: timestamp('due_date'),
  status: milestoneStatusEnum('status').notNull().default('pending'),
  position: integer('position').notNull().default(0),
  owner: varchar('owner', { length: 127 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('milestones_project_idx').on(table.projectId),
  statusIdx: index('milestones_status_idx').on(table.status),
}));

// ============ 日程任务表 ============
export const scheduleTasks = pgTable('schedule_tasks', {
  id: varchar('id', { length: 36 }).primaryKey(),
  milestoneId: varchar('milestone_id', { length: 36 }).notNull().references(() => milestones.id, { onDelete: 'cascade' }),
  workflowId: varchar('workflow_id', { length: 36 }).references(() => workflowInstances.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  status: scheduleTaskStatusEnum('status').notNull().default('todo'),
  assignee: varchar('assignee', { length: 127 }),
  dueDate: timestamp('due_date'),
  dependencyTaskId: varchar('dependency_task_id', { length: 36 }),
  blockingReason: text('blocking_reason'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  milestoneIdx: index('schedule_tasks_milestone_idx').on(table.milestoneId),
  workflowIdx: index('schedule_tasks_workflow_idx').on(table.workflowId),
  statusIdx: index('schedule_tasks_status_idx').on(table.status),
}));

// ============ 人类介入闸门表 ============
export const humanGates = pgTable('human_gates', {
  id: varchar('id', { length: 36 }).primaryKey(),
  workflowId: varchar('workflow_id', { length: 36 }).notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  step: varchar('step', { length: 127 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  question: text('question').notNull(),
  options: jsonb('options').notNull().default([]),
  status: hitlGateStatusEnum('status').notNull().default('pending'),
  selectedOption: text('selected_option'),
  comment: text('comment'),
  requestedBy: varchar('requested_by', { length: 127 }),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: varchar('resolved_by', { length: 127 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  workflowIdx: index('human_gates_workflow_idx').on(table.workflowId),
  statusIdx: index('human_gates_status_idx').on(table.status),
}));

// ============ 数据集表 ============
export const datasets = pgTable('datasets', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).references(() => projects.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  source: varchar('source', { length: 255 }).notNull().default(''),
  description: text('description').notNull().default(''),
  license: varchar('license', { length: 255 }).notNull().default(''),
  homepage: varchar('homepage', { length: 1024 }),
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  status: datasetStatusEnum('status').notNull().default('discovered'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('datasets_project_idx').on(table.projectId),
  statusIdx: index('datasets_status_idx').on(table.status),
}));

// ============ 数据集版本表 ============
export const datasetVersions = pgTable('dataset_versions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  datasetId: varchar('dataset_id', { length: 36 }).notNull().references(() => datasets.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 127 }).notNull(),
  splitInfo: jsonb('split_info').notNull().default({}),
  filePath: varchar('file_path', { length: 1024 }),
  checksum: varchar('checksum', { length: 255 }),
  sizeBytes: integer('size_bytes').notNull().default(0),
  buildRecipe: jsonb('build_recipe').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  datasetIdx: index('dataset_versions_dataset_idx').on(table.datasetId),
  datasetVersionIdx: uniqueIndex('dataset_versions_dataset_version_idx').on(table.datasetId, table.version),
}));

// ============ 论文库表 ============
export const papers = pgTable('papers', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  authors: jsonb('authors').notNull().default([]),
  venue: varchar('venue', { length: 255 }),
  year: integer('year'),
  doi: varchar('doi', { length: 255 }),
  url: varchar('url', { length: 1024 }),
  pdfUrl: varchar('pdf_url', { length: 1024 }),
  localPdfPath: varchar('local_pdf_path', { length: 1024 }),
  abstract: text('abstract'),
  tags: jsonb('tags').notNull().default([]),
  notes: text('notes'),
  status: paperStatusEnum('status').notNull().default('discovered'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('papers_project_idx').on(table.projectId),
  statusIdx: index('papers_status_idx').on(table.status),
}));

// ============ 审稿与复盘表 ============
export const researchReviews = pgTable('research_reviews', {
  id: varchar('id', { length: 36 }).primaryKey(),
  projectId: varchar('project_id', { length: 36 }).notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workflowId: varchar('workflow_id', { length: 36 }).references(() => workflowInstances.id, { onDelete: 'set null' }),
  reportId: varchar('report_id', { length: 36 }).references(() => reports.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }).notNull(),
  review: jsonb('review').notNull().default({}),
  retrospective: jsonb('retrospective').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('research_reviews_project_idx').on(table.projectId),
  workflowIdx: index('research_reviews_workflow_idx').on(table.workflowId),
}));
