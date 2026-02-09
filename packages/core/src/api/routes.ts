/**
 * Express API 路由
 */

import { Router, Request, Response, NextFunction } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { projectService } from '../services/project/index';
import { experimentGroupService, experimentService, runService } from '../services/experiment/index';
import { clusterService } from '../services/cluster/index';
import { reportService } from '../services/report/index';
import { monitorService } from '../services/monitor/index';
import { deepResearchService } from '../services/research';
import { skillSeekersService } from '../services/integration';
import { orchestratorService } from '../services/orchestrator';
import { scheduleService } from '../services/schedule';
import { hitlService } from '../services/hitl';
import { datasetService } from '../services/dataset';
import { readingService } from '../services/reading';
import { reviewService } from '../services/review';
import { plannerAgent } from '../agents/planner-agent';
import { analysisAgent } from '../agents/analysis-agent';
import { createLogger } from '../utils/logger';
import { getConfig, updateLLMConfig, getLLMConfigSafe } from '../utils/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { existsSync } from 'fs';
import path from 'path';

const logger = createLogger('api');

// 创建路由
export const apiRouter: ExpressRouter = Router();

// 错误处理中间件
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ============ 项目 API ============

// 创建项目
const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  researchGoal: z.string().optional(),
  constraints: z.object({
    budget: z.number().optional(),
    deadline: z.string().optional(),
    resources: z.array(z.string()).optional(),
    maxConcurrentRuns: z.number().optional(),
  }).optional(),
  baselineMetrics: z.record(z.number()).optional(),
  tags: z.array(z.string()).optional(),
  ownerId: z.string(),
});

apiRouter.post('/projects', asyncHandler(async (req, res) => {
  const input = createProjectSchema.parse(req.body);
  const project = await projectService.create(input);
  res.status(201).json(project);
}));

// 获取项目列表
apiRouter.get('/projects', asyncHandler(async (req, res) => {
  const { ownerId, status, search, limit, offset } = req.query;
  const result = await projectService.list({
    ownerId: ownerId as string,
    status: status as any,
    search: search as string,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });
  res.json(result);
}));

// 获取单个项目
apiRouter.get('/projects/:id', asyncHandler(async (req, res) => {
  const project = await projectService.getById(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
}));

// 更新项目
apiRouter.patch('/projects/:id', asyncHandler(async (req, res) => {
  const project = await projectService.update(req.params.id, req.body);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
}));

// 删除项目
apiRouter.delete('/projects/:id', asyncHandler(async (req, res) => {
  const deleted = await projectService.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.status(204).send();
}));

// ============ 实验组 API ============

// 创建实验组
apiRouter.post('/experiment-groups', asyncHandler(async (req, res) => {
  const group = await experimentGroupService.create(req.body);
  res.status(201).json(group);
}));

// 获取实验组列表
apiRouter.get('/experiment-groups', asyncHandler(async (req, res) => {
  const { projectId, status, type, limit, offset } = req.query;
  const result = await experimentGroupService.list({
    projectId: projectId as string,
    status: status as any,
    type: type as any,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });
  res.json(result);
}));

// 获取单个实验组
apiRouter.get('/experiment-groups/:id', asyncHandler(async (req, res) => {
  const group = await experimentGroupService.getById(req.params.id);
  if (!group) {
    res.status(404).json({ error: 'Experiment group not found' });
    return;
  }
  res.json(group);
}));

// 更新实验组
apiRouter.patch('/experiment-groups/:id', asyncHandler(async (req, res) => {
  const group = await experimentGroupService.update(req.params.id, req.body);
  if (!group) {
    res.status(404).json({ error: 'Experiment group not found' });
    return;
  }
  res.json(group);
}));

// 审批实验组
apiRouter.post('/experiment-groups/:id/approve', asyncHandler(async (req, res) => {
  const { approverId } = req.body;
  const group = await experimentGroupService.approve(req.params.id, approverId);
  if (!group) {
    res.status(404).json({ error: 'Experiment group not found' });
    return;
  }
  res.json(group);
}));

// 删除实验组
apiRouter.delete('/experiment-groups/:id', asyncHandler(async (req, res) => {
  const deleted = await experimentGroupService.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Experiment group not found' });
    return;
  }
  res.status(204).send();
}));

// ============ 实验 API ============

// 创建实验
apiRouter.post('/experiments', asyncHandler(async (req, res) => {
  const experiment = await experimentService.create(req.body);
  res.status(201).json(experiment);
}));

// 批量创建实验
apiRouter.post('/experiments/batch', asyncHandler(async (req, res) => {
  const experiments = await experimentService.createBatch(req.body.experiments);
  res.status(201).json(experiments);
}));

// 获取实验列表
apiRouter.get('/experiments', asyncHandler(async (req, res) => {
  const { groupId, status, limit, offset } = req.query;
  const result = await experimentService.list({
    groupId: groupId as string,
    status: status as any,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });
  res.json(result);
}));

// 获取单个实验
apiRouter.get('/experiments/:id', asyncHandler(async (req, res) => {
  const experiment = await experimentService.getById(req.params.id);
  if (!experiment) {
    res.status(404).json({ error: 'Experiment not found' });
    return;
  }
  res.json(experiment);
}));

// 更新实验
apiRouter.patch('/experiments/:id', asyncHandler(async (req, res) => {
  const experiment = await experimentService.update(req.params.id, req.body);
  if (!experiment) {
    res.status(404).json({ error: 'Experiment not found' });
    return;
  }
  res.json(experiment);
}));

// 删除实验
apiRouter.delete('/experiments/:id', asyncHandler(async (req, res) => {
  const deleted = await experimentService.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Experiment not found' });
    return;
  }
  res.status(204).send();
}));

// ============ 运行 API ============

// 创建运行
apiRouter.post('/runs', asyncHandler(async (req, res) => {
  const run = await runService.create(req.body);
  res.status(201).json(run);
}));

// 获取运行列表
apiRouter.get('/runs', asyncHandler(async (req, res) => {
  const { experimentId, status, limit, offset } = req.query;
  const result = await runService.list({
    experimentId: experimentId as string,
    status: status as any,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  });
  res.json(result);
}));

// 获取活跃运行
apiRouter.get('/runs/active', asyncHandler(async (_req, res) => {
  const runs = await runService.getActiveRuns();
  res.json(runs);
}));

// 获取单个运行
apiRouter.get('/runs/:id', asyncHandler(async (req, res) => {
  const run = await runService.getById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
}));

// 更新运行
apiRouter.patch('/runs/:id', asyncHandler(async (req, res) => {
  const run = await runService.update(req.params.id, req.body);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
}));

// 记录指标
apiRouter.post('/runs/:id/metrics', asyncHandler(async (req, res) => {
  const { metrics, step } = req.body;
  await runService.logMetrics(req.params.id, metrics, step);
  res.status(204).send();
}));

// 获取指标时序
apiRouter.get('/runs/:id/metrics', asyncHandler(async (req, res) => {
  const { name } = req.query;
  const series = await runService.getMetricSeries(req.params.id, name as string);
  res.json(series);
}));

// 取消运行
apiRouter.post('/runs/:id/cancel', asyncHandler(async (req, res) => {
  const run = await runService.getById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }

  if (run.clusterJobId) {
    await clusterService.cancel(run.clusterJobId, run.clusterType);
  }

  await runService.updateStatus(req.params.id, 'cancelled');
  res.status(204).send();
}));

// ============ 集群 API ============

// 检测集群
apiRouter.get('/clusters/detect', asyncHandler(async (_req, res) => {
  const results = await clusterService.detectClusters();
  res.json(results);
}));

// 提交任务
apiRouter.post('/clusters/submit', asyncHandler(async (req, res) => {
  const { job, clusterType } = req.body;
  const handle = await clusterService.submit(job, clusterType);
  res.status(201).json(handle);
}));

// 获取任务状态
apiRouter.get('/clusters/:type/jobs/:jobId/status', asyncHandler(async (req, res) => {
  const status = await clusterService.status(req.params.jobId, req.params.type as any);
  res.json(status);
}));

// 获取任务日志
apiRouter.get('/clusters/:type/jobs/:jobId/logs', asyncHandler(async (req, res) => {
  const { tail } = req.query;
  const logs: string[] = [];

  for await (const entry of clusterService.logs(req.params.jobId, req.params.type as any, {
    tail: tail ? parseInt(tail as string, 10) : 100,
  })) {
    logs.push(`[${entry.timestamp.toISOString()}] ${entry.message}`);
  }

  res.json({ logs });
}));

// ============ AI 计划 API ============

// 生成研究计划
apiRouter.post('/ai/plan', asyncHandler(async (req, res) => {
  const plan = await plannerAgent.generatePlan(req.body);
  res.json(plan);
}));

// 生成消融计划
apiRouter.post('/ai/ablation-plan', asyncHandler(async (req, res) => {
  const { baseExperiment, components } = req.body;
  const plans = await plannerAgent.generateAblationPlan(baseExperiment, components);
  res.json(plans);
}));

// 生成超参搜索矩阵
apiRouter.post('/ai/hyperparameter-grid', asyncHandler(async (req, res) => {
  const { baseConfig, searchSpace } = req.body;
  const experiments = await plannerAgent.generateHyperparameterGrid(baseConfig, searchSpace);
  res.json(experiments);
}));

// 分析实验结果
apiRouter.post('/ai/analyze', asyncHandler(async (req, res) => {
  const analysis = await analysisAgent.analyzeResults(req.body);
  res.json(analysis);
}));

// 深度研究
apiRouter.post('/ai/deep-research', asyncHandler(async (req, res) => {
  const { query, maxResults, topic } = req.body || {};

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  const result = await deepResearchService.run({
    query,
    maxResults: typeof maxResults === 'number' ? maxResults : undefined,
    topic: ['general', 'news', 'finance'].includes(topic) ? topic : undefined,
  });

  res.json(result);
}));

// ============ 报告 API ============

// 生成报告
apiRouter.post('/reports', asyncHandler(async (req, res) => {
  const report = await reportService.generate(req.body);
  res.status(201).json(report);
}));

// 获取报告列表
apiRouter.get('/reports', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  const reports = await reportService.listByProject(projectId as string);
  res.json(reports);
}));

// 获取单个报告
apiRouter.get('/reports/:id', asyncHandler(async (req, res) => {
  const report = await reportService.getById(req.params.id);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(report);
}));

// 在 Overleaf 中打开报告
apiRouter.get('/reports/:id/overleaf', asyncHandler(async (req, res) => {
  const report = await reportService.getById(req.params.id);
  if (!report) {
    res.status(404).send('Report not found');
    return;
  }

  if (!report.latexSource) {
    res.status(400).send('LaTeX source is empty');
    return;
  }

  const reportTitle = (report.title || 'report').replace(/[^\w\-]+/g, '_');
  const snipName = `${reportTitle}.tex`;
  const escapedLatex = escapeHtml(report.latexSource);
  const escapedSnipName = escapeHtml(snipName);

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Open in Overleaf</title>
  </head>
  <body>
    <form id="overleaf-form" action="https://www.overleaf.com/docs" method="post">
      <input type="hidden" name="snip_name" value="${escapedSnipName}" />
      <textarea name="snip" style="display:none;">${escapedLatex}</textarea>
    </form>
    <script>
      document.getElementById('overleaf-form').submit();
    </script>
    <p>If not redirected, <button onclick="document.getElementById('overleaf-form').submit()">click here</button>.</p>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// 删除报告
apiRouter.delete('/reports/:id', asyncHandler(async (req, res) => {
  const deleted = await reportService.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.status(204).send();
}));

// ============ 监控 API ============

// 获取活跃告警
apiRouter.get('/alerts/active', asyncHandler(async (_req, res) => {
  const alerts = await monitorService.getActiveAlerts();
  res.json(alerts);
}));

// 获取运行告警
apiRouter.get('/runs/:id/alerts', asyncHandler(async (req, res) => {
  const alerts = await monitorService.getAlertsByRun(req.params.id);
  res.json(alerts);
}));

// 确认告警
apiRouter.post('/alerts/:id/acknowledge', asyncHandler(async (req, res) => {
  await monitorService.acknowledgeAlert(req.params.id);
  res.status(204).send();
}));

// 解决告警
apiRouter.post('/alerts/:id/resolve', asyncHandler(async (req, res) => {
  await monitorService.resolveAlert(req.params.id);
  res.status(204).send();
}));

// ============ 健康检查 ============

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ 集成 API ============

apiRouter.get('/integrations/skill-seekers/status', asyncHandler(async (_req, res) => {
  const status = await skillSeekersService.getStatus();
  res.json(status);
}));

const skillSeekersSyncSchema = z.object({
  branch: z.string().optional(),
});

apiRouter.post('/integrations/skill-seekers/sync', asyncHandler(async (req, res) => {
  const input = skillSeekersSyncSchema.parse(req.body || {});
  const status = await skillSeekersService.syncRepo(input.branch);
  res.json(status);
}));

apiRouter.get('/integrations/skill-seekers/configs', asyncHandler(async (_req, res) => {
  const configs = await skillSeekersService.listConfigs();
  res.json({ total: configs.length, data: configs });
}));

const skillSeekersBuildSchema = z.object({
  force: z.boolean().optional(),
});

apiRouter.post('/integrations/skill-seekers/build-image', asyncHandler(async (req, res) => {
  const input = skillSeekersBuildSchema.parse(req.body || {});
  const result = await skillSeekersService.buildImage(!!input.force);
  res.json(result);
}));

const skillSeekersRunSchema = z.object({
  configPath: z.string().min(1),
  maxPages: z.number().int().positive().max(2000).optional(),
  buildImage: z.boolean().optional(),
  verbose: z.boolean().optional(),
});

apiRouter.post('/integrations/skill-seekers/run-scrape', asyncHandler(async (req, res) => {
  const input = skillSeekersRunSchema.parse(req.body || {});
  const result = await skillSeekersService.runScrape(input);
  res.json(result);
}));

// ============ 自动工作流 API ============

const createWorkflowSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().optional(),
  requestedBy: z.string().optional(),
  decisionMode: z.enum(['human_in_loop', 'autonomous']).optional(),
  clusterType: z.enum(['slurm', 'kubernetes', 'ssh']).optional(),
  maxExperiments: z.number().int().positive().max(200).optional(),
  plotEngine: z.enum(['auto', 'matplotlib', 'seaborn', 'echarts', 'r', 'pdfkit']).optional(),
});

apiRouter.post('/workflows/auto', asyncHandler(async (req, res) => {
  const input = createWorkflowSchema.parse(req.body || {});
  const workflow = await orchestratorService.createAutoWorkflow(input);
  res.status(201).json(workflow);
}));

apiRouter.get('/workflows', asyncHandler(async (req, res) => {
  const { projectId, status } = req.query;
  const workflows = await orchestratorService.listWorkflows({
    projectId: projectId as string | undefined,
    status: status as any,
  });
  res.json(workflows);
}));

apiRouter.get('/workflows/:id', asyncHandler(async (req, res) => {
  const workflow = await orchestratorService.getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json(workflow);
}));

apiRouter.get('/workflows/:id/events', asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const events = await orchestratorService.getWorkflowEvents(
    req.params.id,
    limit ? parseInt(limit as string, 10) : 200
  );
  res.json(events);
}));

apiRouter.post('/workflows/:id/cancel', asyncHandler(async (req, res) => {
  const workflow = await orchestratorService.cancelWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json(workflow);
}));

apiRouter.post('/workflows/:id/resume', asyncHandler(async (req, res) => {
  const workflow = await orchestratorService.resumeWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json(workflow);
}));

apiRouter.get('/workflows/:id/gates', asyncHandler(async (req, res) => {
  const gates = await hitlService.getByWorkflow(req.params.id);
  res.json(gates);
}));

const resolveGateSchema = z.object({
  status: z.enum(['approved', 'rejected', 'changes_requested', 'timeout']),
  selectedOption: z.string().optional(),
  comment: z.string().optional(),
  resolvedBy: z.string().optional(),
});

apiRouter.post('/workflows/:id/gates/:gateId/resolve', asyncHandler(async (req, res) => {
  const input = resolveGateSchema.parse(req.body || {});
  const gate = await hitlService.getById(req.params.gateId);
  if (!gate || gate.workflowId !== req.params.id) {
    res.status(404).json({ error: 'Gate not found' });
    return;
  }

  const updated = await hitlService.resolveGate(req.params.gateId, input);
  res.json(updated);
}));

// ============ 日程管理 API ============

apiRouter.get('/projects/:id/schedule', asyncHandler(async (req, res) => {
  const schedule = await scheduleService.getProjectSchedule(req.params.id);
  res.json(schedule);
}));

const createMilestoneSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
  position: z.number().int().optional(),
  owner: z.string().optional(),
});

apiRouter.post('/projects/:id/milestones', asyncHandler(async (req, res) => {
  const input = createMilestoneSchema.parse(req.body || {});
  const milestone = await scheduleService.createMilestone({
    projectId: req.params.id,
    title: input.title,
    description: input.description,
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    status: input.status,
    position: input.position,
    owner: input.owner,
  });
  res.status(201).json(milestone);
}));

const updateMilestoneSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
  position: z.number().int().optional(),
  owner: z.string().nullable().optional(),
});

apiRouter.patch('/milestones/:id', asyncHandler(async (req, res) => {
  const input = updateMilestoneSchema.parse(req.body || {});
  const updated = await scheduleService.updateMilestone(req.params.id, {
    ...input,
    dueDate: input.dueDate === undefined ? undefined : (input.dueDate ? new Date(input.dueDate) : null),
  });
  if (!updated) {
    res.status(404).json({ error: 'Milestone not found' });
    return;
  }
  res.json(updated);
}));

const createScheduleTaskSchema = z.object({
  workflowId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'waiting_review', 'done', 'blocked']).optional(),
  assignee: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  dependencyTaskId: z.string().optional(),
  blockingReason: z.string().optional(),
  position: z.number().int().optional(),
});

apiRouter.post('/milestones/:id/tasks', asyncHandler(async (req, res) => {
  const input = createScheduleTaskSchema.parse(req.body || {});
  const task = await scheduleService.createTask({
    milestoneId: req.params.id,
    workflowId: input.workflowId,
    title: input.title,
    description: input.description,
    status: input.status,
    assignee: input.assignee,
    dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    dependencyTaskId: input.dependencyTaskId,
    blockingReason: input.blockingReason,
    position: input.position,
  });
  res.status(201).json(task);
}));

const updateScheduleTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'waiting_review', 'done', 'blocked']).optional(),
  assignee: z.string().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  dependencyTaskId: z.string().nullable().optional(),
  blockingReason: z.string().nullable().optional(),
  position: z.number().int().optional(),
});

apiRouter.patch('/schedule-tasks/:id', asyncHandler(async (req, res) => {
  const input = updateScheduleTaskSchema.parse(req.body || {});
  const updated = await scheduleService.updateTask(req.params.id, {
    ...input,
    dueDate: input.dueDate === undefined ? undefined : (input.dueDate ? new Date(input.dueDate) : null),
  });
  if (!updated) {
    res.status(404).json({ error: 'Schedule task not found' });
    return;
  }
  res.json(updated);
}));

// ============ 数据集 API ============

const datasetSearchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(50).optional(),
});

apiRouter.post('/datasets/search', asyncHandler(async (req, res) => {
  const input = datasetSearchSchema.parse(req.body || {});
  const result = await datasetService.search(input.query, input.maxResults || 10);
  res.json(result);
}));

apiRouter.get('/datasets', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const result = await datasetService.list(projectId as string | undefined);
  res.json(result);
}));

const createDatasetSchema = z.object({
  projectId: z.string().optional(),
  name: z.string().min(1),
  source: z.string().optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['discovered', 'curated', 'ready', 'archived']).optional(),
});

apiRouter.post('/datasets', asyncHandler(async (req, res) => {
  const input = createDatasetSchema.parse(req.body || {});
  const existing = await datasetService.findByName(input.projectId, input.name);
  if (existing) {
    res.json(existing);
    return;
  }
  const created = await datasetService.create(input);
  res.status(201).json(created);
}));

apiRouter.get('/datasets/:id', asyncHandler(async (req, res) => {
  const dataset = await datasetService.getById(req.params.id);
  if (!dataset) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  res.json(dataset);
}));

const updateDatasetSchema = z.object({
  name: z.string().optional(),
  source: z.string().optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['discovered', 'curated', 'ready', 'archived']).optional(),
});

apiRouter.patch('/datasets/:id', asyncHandler(async (req, res) => {
  const input = updateDatasetSchema.parse(req.body || {});
  const updated = await datasetService.update(req.params.id, input);
  if (!updated) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  res.json(updated);
}));

apiRouter.get('/datasets/:id/versions', asyncHandler(async (req, res) => {
  const versions = await datasetService.listVersions(req.params.id);
  res.json(versions);
}));

const constructDatasetSchema = z.object({
  version: z.string().min(1),
  splitInfo: z.record(z.unknown()).optional(),
  buildRecipe: z.record(z.unknown()).optional(),
  syntheticRows: z.array(z.record(z.unknown())).optional(),
});

apiRouter.post('/datasets/:id/construct', asyncHandler(async (req, res) => {
  const input = constructDatasetSchema.parse(req.body || {});
  const version = await datasetService.construct(req.params.id, input);
  res.status(201).json(version);
}));

// ============ 阅读代理 / 论文库 API ============

const paperSearchSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(50).optional(),
});

apiRouter.post('/reading/search', asyncHandler(async (req, res) => {
  const input = paperSearchSchema.parse(req.body || {});
  const result = await readingService.search(input.query, input.maxResults || 10);
  res.json(result);
}));

apiRouter.get('/reading/papers', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  const papers = await readingService.list(projectId as string | undefined);
  res.json(papers);
}));

const createPaperSchema = z.object({
  projectId: z.string().optional(),
  title: z.string().min(1),
  authors: z.array(z.string()).optional(),
  venue: z.string().optional(),
  year: z.number().int().optional(),
  doi: z.string().optional(),
  url: z.string().optional(),
  pdfUrl: z.string().optional(),
  abstract: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['discovered', 'downloaded', 'archived']).optional(),
});

apiRouter.post('/reading/papers', asyncHandler(async (req, res) => {
  const input = createPaperSchema.parse(req.body || {});
  const existing = await readingService.findByTitle(input.projectId, input.title);
  if (existing) {
    res.json(existing);
    return;
  }
  const created = await readingService.create(input);
  res.status(201).json(created);
}));

apiRouter.get('/reading/papers/:id', asyncHandler(async (req, res) => {
  const paper = await readingService.getById(req.params.id);
  if (!paper) {
    res.status(404).json({ error: 'Paper not found' });
    return;
  }
  res.json(paper);
}));

const updatePaperSchema = z.object({
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  venue: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  doi: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  pdfUrl: z.string().nullable().optional(),
  abstract: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['discovered', 'downloaded', 'archived']).optional(),
  localPdfPath: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

apiRouter.patch('/reading/papers/:id', asyncHandler(async (req, res) => {
  const input = updatePaperSchema.parse(req.body || {});
  const updated = await readingService.update(req.params.id, input);
  if (!updated) {
    res.status(404).json({ error: 'Paper not found' });
    return;
  }
  res.json(updated);
}));

apiRouter.delete('/reading/papers/:id', asyncHandler(async (req, res) => {
  const deleted = await readingService.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Paper not found' });
    return;
  }
  res.status(204).send();
}));

apiRouter.post('/reading/papers/:id/download', asyncHandler(async (req, res) => {
  const updated = await readingService.downloadPdf(req.params.id);
  res.json(updated);
}));

apiRouter.get('/reading/papers/:id/pdf', asyncHandler(async (req, res) => {
  const paper = await readingService.getById(req.params.id);
  if (!paper) {
    res.status(404).send('Paper not found');
    return;
  }

  if (!paper.localPdfPath) {
    res.status(400).send('PDF not downloaded yet');
    return;
  }

  const absolutePath = path.isAbsolute(paper.localPdfPath)
    ? paper.localPdfPath
    : path.resolve(process.cwd(), paper.localPdfPath);

  if (!existsSync(absolutePath)) {
    res.status(404).send('PDF file missing on disk');
    return;
  }

  res.sendFile(absolutePath);
}));

apiRouter.post('/reading/papers/:id/summarize', asyncHandler(async (req, res) => {
  const summary = await readingService.summarize(req.params.id);
  res.json({ summary });
}));

// ============ 审稿与复盘 API ============

const generateReviewSchema = z.object({
  projectId: z.string().min(1),
  workflowId: z.string().optional(),
  reportId: z.string().optional(),
  title: z.string().optional(),
});

apiRouter.post('/reviews/generate', asyncHandler(async (req, res) => {
  const input = generateReviewSchema.parse(req.body || {});
  const review = await reviewService.generate(input);
  res.status(201).json(review);
}));

apiRouter.get('/reviews', asyncHandler(async (req, res) => {
  const { projectId } = req.query;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  const reviews = await reviewService.listByProject(projectId as string);
  res.json(reviews);
}));

apiRouter.get('/reviews/:id', asyncHandler(async (req, res) => {
  const review = await reviewService.getById(req.params.id);
  if (!review) {
    res.status(404).json({ error: 'Review not found' });
    return;
  }
  res.json(review);
}));

// ============ 设置 API ============

// 获取 LLM 配置
apiRouter.get('/settings/llm', asyncHandler(async (_req, res) => {
  const config = getLLMConfigSafe();
  res.json(config);
}));

// 更新 LLM 配置
const updateLLMConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
  apiKey: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
});

apiRouter.put('/settings/llm', asyncHandler(async (req, res) => {
  const input = updateLLMConfigSchema.parse(req.body);
  const updated = updateLLMConfig(input);

  // 重置 agents 以使用新配置
  plannerAgent.resetInitialization();
  analysisAgent.resetInitialization();

  res.json({
    provider: updated.provider,
    baseUrl: updated.baseUrl || '',
    model: updated.model,
    maxTokens: updated.maxTokens,
    temperature: updated.temperature,
    hasApiKey: !!updated.apiKey,
    hasTavilyApiKey: !!updated.tavilyApiKey,
  });
}));

// 测试 LLM 连接
apiRouter.post('/settings/llm/test', asyncHandler(async (_req, res) => {
  const config = getConfig();

  if (!config.llm.apiKey) {
    res.status(400).json({ success: false, error: 'API Key 未配置' });
    return;
  }

  try {
    if (config.llm.provider === 'openai') {
      const openai = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || undefined,
      });
      await openai.chat.completions.create({
        model: config.llm.model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5,
      });
    } else if (config.llm.provider === 'anthropic') {
      const anthropic = new Anthropic({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || undefined,
      });
      await anthropic.completions.create({
        model: config.llm.model,
        max_tokens_to_sample: 5,
        prompt: `${Anthropic.HUMAN_PROMPT} Hello${Anthropic.AI_PROMPT}`,
      });
    }

    res.json({ success: true, message: 'API 连接成功' });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message || 'API 连接失败'
    });
  }
}));

// 测试 Tavily 连接
apiRouter.post('/settings/tavily/test', asyncHandler(async (_req, res) => {
  const config = getConfig();
  const tavilyApiKey = config.llm.tavilyApiKey || process.env.TAVILY_API_KEY;

  if (!tavilyApiKey) {
    res.status(400).json({ success: false, error: 'Tavily API Key 未配置' });
    return;
  }

  try {
    const response = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: tavilyApiKey,
        query: 'latest AI research',
        max_results: 1,
      },
      {
        timeout: 10000,
      }
    );

    if (!Array.isArray(response.data?.results)) {
      res.status(400).json({ success: false, error: 'Tavily 返回格式异常' });
      return;
    }

    res.json({ success: true, message: 'Tavily API 连接成功' });
  } catch (error: any) {
    const status = error?.response?.status;
    const detail = error?.response?.data?.error || error?.response?.data?.message || error?.message;
    res.status(400).json({
      success: false,
      error: status ? `Tavily API 连接失败 (${status}): ${detail}` : (detail || 'Tavily API 连接失败'),
    });
  }
}));

// 错误处理
apiRouter.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, path: req.path, method: req.method }, 'API error');

  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.errors });
    return;
  }

  if (err.message === 'No LLM provider configured') {
    res.status(400).json({
      error: 'LLM 未配置，请先到设置页填写 API Key',
      code: 'LLM_NOT_CONFIGURED',
    });
    return;
  }

  if (req.path.startsWith('/integrations/skill-seekers')) {
    res.status(400).json({
      error: err.message || 'Skill Seekers integration error',
      code: 'SKILL_SEEKERS_ERROR',
    });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});
