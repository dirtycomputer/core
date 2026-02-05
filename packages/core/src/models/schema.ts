/**
 * Drizzle ORM Schema 定义
 * PostgreSQL 数据库表结构
 */

import { pgTable, varchar, text, timestamp, jsonb, integer, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core';

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
