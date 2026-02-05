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
import { plannerAgent } from '../agents/planner-agent';
import { analysisAgent } from '../agents/analysis-agent';
import { createLogger } from '../utils/logger';

const logger = createLogger('api');

// 创建路由
export const apiRouter: ExpressRouter = Router();

// 错误处理中间件
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

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

// 错误处理
apiRouter.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, path: req.path, method: req.method }, 'API error');

  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.errors });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
});
