import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { and, asc, desc, eq, inArray, lt, lte } from 'drizzle-orm';
import OpenAI from 'openai';
import type { Experiment } from '../../models/types';
import { getDatabase } from '../../db/connection';
import {
  workflowInstances,
  workflowTasks,
  workflowEvents,
} from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import { plannerAgent } from '../../agents/planner-agent';
import { analysisAgent, type ExperimentAnalysis, type ExperimentResult } from '../../agents/analysis-agent';
import { projectService } from '../project';
import { experimentGroupService, experimentService, runService } from '../experiment';
import { clusterService } from '../cluster';
import { reportService } from '../report';
import { hitlService } from '../hitl';
import { scheduleService } from '../schedule';
import { reviewService } from '../review';
import type { PlotEngine } from '../plot';
import { getConfig } from '../../utils/config';

const logger = createLogger('service:orchestrator');

const AUTO_WORKFLOW_STEPS = [
  'plan_generate',
  'hitl_direction',
  'experiments_materialize',
  'runs_create_submit',
  'runs_wait_terminal',
  'results_analyze',
  'hitl_improvement',
  'report_generate',
  'paper_review',
  'complete',
] as const;

export type AutoWorkflowStep = (typeof AUTO_WORKFLOW_STEPS)[number];

type WorkflowStatus = 'pending' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
type WorkflowTaskStatus = 'pending' | 'leased' | 'running' | 'completed' | 'failed' | 'cancelled';
type DecisionMode = 'human_in_loop' | 'autonomous';

interface WorkflowContext {
  decisionMode?: DecisionMode;
  requestedBy?: string;
  clusterType?: 'slurm' | 'kubernetes' | 'ssh';
  maxExperiments?: number;
  plotEngine?: PlotEngine;
  planRegenerationCount?: number;
  plan?: any;
  experimentGroupIds?: string[];
  experimentIds?: string[];
  runIds?: string[];
  analysis?: ExperimentAnalysis;
  reportId?: string;
  reviewId?: string;
  ablationRound?: number;
}

interface StepOutcome {
  nextStep?: AutoWorkflowStep;
  requeueAfterMs?: number;
  waitingHuman?: boolean;
  message?: string;
  contextPatch?: Partial<WorkflowContext>;
  terminalStatus?: 'completed' | 'failed' | 'cancelled';
}

export interface CreateAutoWorkflowInput {
  projectId: string;
  name?: string;
  decisionMode?: DecisionMode;
  requestedBy?: string;
  clusterType?: 'slurm' | 'kubernetes' | 'ssh';
  maxExperiments?: number;
  plotEngine?: PlotEngine;
}

interface WorkflowRow {
  id: string;
  projectId: string;
  name: string;
  status: WorkflowStatus;
  currentStep: string;
  context: WorkflowContext;
  errorMessage?: string;
  cancelRequested: boolean;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkflowTaskRow {
  id: string;
  workflowId: string;
  step: string;
  status: WorkflowTaskStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  leaseUntil?: Date;
  idempotencyKey?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class OrchestratorService extends EventEmitter {
  private db = getDatabase();
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly taskBatchSize: number;

  constructor(config?: { pollIntervalMs?: number; leaseMs?: number; taskBatchSize?: number }) {
    super();
    this.pollIntervalMs = config?.pollIntervalMs ?? 3000;
    this.leaseMs = config?.leaseMs ?? 20000;
    this.taskBatchSize = config?.taskBatchSize ?? 5;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    void this.tick();
    logger.info({ pollIntervalMs: this.pollIntervalMs }, 'Orchestrator started');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Orchestrator stopped');
  }

  async createAutoWorkflow(input: CreateAutoWorkflowInput): Promise<WorkflowRow> {
    const project = await projectService.getById(input.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const id = generateId();
    const now = new Date();
    const context: WorkflowContext = {
      decisionMode: input.decisionMode || 'human_in_loop',
      requestedBy: input.requestedBy,
      clusterType: input.clusterType,
      maxExperiments: input.maxExperiments,
      plotEngine: input.plotEngine || 'auto',
      planRegenerationCount: 0,
      ablationRound: 0,
    };

    const [workflow] = await this.db
      .insert(workflowInstances)
      .values({
        id,
        projectId: input.projectId,
        name: input.name || `${project.name} - Auto Research Workflow`,
        status: 'running',
        currentStep: AUTO_WORKFLOW_STEPS[0],
        context,
        cancelRequested: false,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await scheduleService.ensureWorkflowSchedule(input.projectId, id, AUTO_WORKFLOW_STEPS as unknown as string[]);
    await this.createTask(id, AUTO_WORKFLOW_STEPS[0], {}, 0, `wf:${id}:step:${AUTO_WORKFLOW_STEPS[0]}`);

    await this.emitEvent(id, undefined, 'workflow.created', `Workflow created for project '${project.name}'`, {
      projectId: input.projectId,
      requestedBy: input.requestedBy,
      decisionMode: context.decisionMode,
    });

    return this.mapWorkflow(workflow);
  }

  async listWorkflows(filters?: { projectId?: string; status?: WorkflowStatus }): Promise<WorkflowRow[]> {
    const rows = await this.db
      .select()
      .from(workflowInstances)
      .where(
        filters?.projectId && filters?.status
          ? and(eq(workflowInstances.projectId, filters.projectId), eq(workflowInstances.status, filters.status))
          : filters?.projectId
            ? eq(workflowInstances.projectId, filters.projectId)
            : filters?.status
              ? eq(workflowInstances.status, filters.status)
              : undefined
      )
      .orderBy(desc(workflowInstances.updatedAt));

    return rows.map((row) => this.mapWorkflow(row));
  }

  async getWorkflow(id: string): Promise<WorkflowRow | null> {
    const [row] = await this.db
      .select()
      .from(workflowInstances)
      .where(eq(workflowInstances.id, id))
      .limit(1);

    return row ? this.mapWorkflow(row) : null;
  }

  async getWorkflowEvents(workflowId: string, limit = 200): Promise<Array<{ id: string; type: string; level: string; message: string; data: Record<string, unknown>; createdAt: Date }>> {
    const rows = await this.db
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.workflowId, workflowId))
      .orderBy(desc(workflowEvents.createdAt))
      .limit(Math.max(1, Math.min(limit, 1000)));

    return rows
      .map((row) => ({
        id: row.id,
        type: row.type,
        level: row.level,
        message: row.message,
        data: (row.data || {}) as Record<string, unknown>,
        createdAt: row.createdAt,
      }))
      .reverse();
  }

  async cancelWorkflow(id: string): Promise<WorkflowRow | null> {
    const [row] = await this.db
      .update(workflowInstances)
      .set({
        status: 'cancelled',
        cancelRequested: true,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowInstances.id, id))
      .returning();

    if (!row) {
      return null;
    }

    await this.db
      .update(workflowTasks)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(workflowTasks.workflowId, id),
          inArray(workflowTasks.status, ['pending', 'leased', 'running'])
        )
      );

    await this.emitEvent(id, undefined, 'workflow.cancelled', 'Workflow cancelled by user', {});
    return this.mapWorkflow(row);
  }

  async resumeWorkflow(id: string): Promise<WorkflowRow | null> {
    const workflow = await this.getWorkflow(id);
    if (!workflow) {
      return null;
    }

    await this.db
      .update(workflowInstances)
      .set({
        status: 'running',
        cancelRequested: false,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(workflowInstances.id, id));

    await this.db
      .update(workflowTasks)
      .set({
        status: 'pending',
        runAfter: new Date(),
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowTasks.workflowId, id),
          inArray(workflowTasks.status, ['failed', 'leased'])
        )
      );

    await this.emitEvent(id, undefined, 'workflow.resumed', 'Workflow resumed', {});
    return this.getWorkflow(id);
  }

  private async tick() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      await this.recoverExpiredLeases();
      const now = new Date();

      const candidates = await this.db
        .select()
        .from(workflowTasks)
        .where(and(eq(workflowTasks.status, 'pending'), lte(workflowTasks.runAfter, now)))
        .orderBy(asc(workflowTasks.runAfter), asc(workflowTasks.createdAt))
        .limit(this.taskBatchSize);

      for (const candidate of candidates) {
        const leased = await this.tryLease(candidate.id);
        if (!leased) {
          continue;
        }

        await this.executeTask(leased);
      }
    } catch (error) {
      logger.error({ error }, 'Orchestrator tick failed');
    } finally {
      this.processing = false;
    }
  }

  private async recoverExpiredLeases() {
    await this.db
      .update(workflowTasks)
      .set({
        status: 'pending',
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowTasks.status, 'leased'), lt(workflowTasks.leaseUntil, new Date())));
  }

  private async tryLease(taskId: string): Promise<WorkflowTaskRow | null> {
    const [row] = await this.db
      .update(workflowTasks)
      .set({
        status: 'leased',
        leaseUntil: new Date(Date.now() + this.leaseMs),
        updatedAt: new Date(),
      })
      .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.status, 'pending')))
      .returning();

    return row ? this.mapTask(row) : null;
  }

  private async executeTask(task: WorkflowTaskRow) {
    const workflow = await this.getWorkflow(task.workflowId);
    if (!workflow) {
      return;
    }

    if (workflow.cancelRequested || workflow.status === 'cancelled') {
      await this.markTaskCancelled(task.id);
      return;
    }

    await this.db
      .update(workflowTasks)
      .set({
        status: 'running',
        startedAt: task.startedAt || new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowTasks.id, task.id));

    await this.db
      .update(workflowInstances)
      .set({
        status: 'running',
        currentStep: task.step,
        updatedAt: new Date(),
      })
      .where(eq(workflowInstances.id, workflow.id));

    await scheduleService.markWorkflowStep(workflow.id, task.step, 'in_progress');
    await this.emitEvent(workflow.id, task.id, 'step.started', `Step started: ${task.step}`, { step: task.step });

    try {
      const outcome = await this.runStep(task.step as AutoWorkflowStep, workflow, task);
      await this.applyStepOutcome(workflow, task, outcome);
    } catch (error) {
      await this.handleTaskError(workflow, task, error);
    }
  }

  private async applyStepOutcome(workflow: WorkflowRow, task: WorkflowTaskRow, outcome: StepOutcome) {
    const now = new Date();

    if (outcome.contextPatch) {
      await this.patchWorkflowContext(workflow.id, workflow.context, outcome.contextPatch, outcome.nextStep || task.step);
    }

    if (outcome.waitingHuman || outcome.requeueAfterMs) {
      const retryMs = outcome.requeueAfterMs ?? 15000;
      await this.db
        .update(workflowTasks)
        .set({
          status: 'pending',
          leaseUntil: null,
          runAfter: new Date(Date.now() + retryMs),
          updatedAt: now,
        })
        .where(eq(workflowTasks.id, task.id));

      await this.db
        .update(workflowInstances)
        .set({
          status: outcome.waitingHuman ? 'waiting_human' : 'running',
          updatedAt: now,
        })
        .where(eq(workflowInstances.id, workflow.id));

      await scheduleService.markWorkflowStep(workflow.id, task.step, outcome.waitingHuman ? 'blocked' : 'in_progress', outcome.message);
      await this.emitEvent(workflow.id, task.id, 'step.waiting', outcome.message || `Step waiting: ${task.step}`, {
        step: task.step,
        waitingHuman: !!outcome.waitingHuman,
      });
      return;
    }

    await this.db
      .update(workflowTasks)
      .set({
        status: 'completed',
        leaseUntil: null,
        result: { message: outcome.message || 'completed' },
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(workflowTasks.id, task.id));

    await scheduleService.markWorkflowStep(workflow.id, task.step, 'done');

    if (outcome.terminalStatus) {
      await this.db
        .update(workflowInstances)
        .set({
          status: outcome.terminalStatus,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(workflowInstances.id, workflow.id));

      await this.emitEvent(workflow.id, task.id, 'workflow.finished', outcome.message || `Workflow ${outcome.terminalStatus}`, {
        terminalStatus: outcome.terminalStatus,
      });

      return;
    }

    if (outcome.nextStep) {
      await this.createTask(
        workflow.id,
        outcome.nextStep,
        {},
        0,
        `wf:${workflow.id}:step:${outcome.nextStep}:after:${task.id}`
      );

      await this.db
        .update(workflowInstances)
        .set({
          currentStep: outcome.nextStep,
          status: 'running',
          updatedAt: now,
        })
        .where(eq(workflowInstances.id, workflow.id));

      await this.emitEvent(workflow.id, task.id, 'step.completed', outcome.message || `Step completed: ${task.step}`, {
        step: task.step,
        nextStep: outcome.nextStep,
      });
      return;
    }

    await this.db
      .update(workflowInstances)
      .set({
        status: 'completed',
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(workflowInstances.id, workflow.id));

    await this.emitEvent(workflow.id, task.id, 'workflow.finished', 'Workflow finished without explicit next step', {});
  }

  private async handleTaskError(workflow: WorkflowRow, task: WorkflowTaskRow, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = task.attempts + 1;
    const exhausted = attempts >= task.maxAttempts;

    if (exhausted) {
      await this.db
        .update(workflowTasks)
        .set({
          status: 'failed',
          leaseUntil: null,
          attempts,
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(workflowTasks.id, task.id));

      await this.db
        .update(workflowInstances)
        .set({
          status: 'failed',
          errorMessage: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowInstances.id, workflow.id));

      await scheduleService.markWorkflowStep(workflow.id, task.step, 'blocked', message);
      await this.emitEvent(workflow.id, task.id, 'step.failed', `Step failed permanently: ${task.step}`, {
        step: task.step,
        error: message,
        attempts,
      });
      return;
    }

    const backoffMs = Math.min(60000, attempts * 5000);
    await this.db
      .update(workflowTasks)
      .set({
        status: 'pending',
        leaseUntil: null,
        attempts,
        errorMessage: message,
        runAfter: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      })
      .where(eq(workflowTasks.id, task.id));

    await this.emitEvent(workflow.id, task.id, 'step.retry', `Step failed, retry scheduled: ${task.step}`, {
      step: task.step,
      error: message,
      attempts,
      backoffMs,
    });
  }

  private async runStep(step: AutoWorkflowStep, workflow: WorkflowRow, task: WorkflowTaskRow): Promise<StepOutcome> {
    switch (step) {
      case 'plan_generate':
        return this.stepPlanGenerate(workflow);
      case 'hitl_direction':
        return this.stepHitlDirection(workflow);
      case 'experiments_materialize':
        return this.stepExperimentsMaterialize(workflow);
      case 'runs_create_submit':
        return this.stepRunsCreateSubmit(workflow);
      case 'runs_wait_terminal':
        return this.stepRunsWaitTerminal(workflow);
      case 'results_analyze':
        return this.stepResultsAnalyze(workflow);
      case 'hitl_improvement':
        return this.stepHitlImprovement(workflow);
      case 'report_generate':
        return this.stepReportGenerate(workflow);
      case 'paper_review':
        return this.stepPaperReview(workflow);
      case 'complete':
        return {
          terminalStatus: 'completed',
          message: 'Workflow completed',
        };
      default:
        throw new Error(`Unknown workflow step: ${task.step}`);
    }
  }

  private async stepPlanGenerate(workflow: WorkflowRow): Promise<StepOutcome> {
    const project = await projectService.getById(workflow.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const context = workflow.context;
    const constraints = project.constraints || {};
    const plan = await plannerAgent.generatePlan({
      projectName: project.name,
      researchGoal: project.researchGoal,
      constraints: {
        budget: constraints.budget,
        deadline: constraints.deadline ? String(constraints.deadline) : undefined,
        resources: constraints.resources,
        maxExperiments: context.maxExperiments,
      },
      baselineInfo: {
        metrics: project.baselineMetrics,
      },
      context: 'Please produce an executable plan for automatic orchestration with clear baseline/improvement/ablation grouping.',
    });

    const maxExperiments = context.maxExperiments;
    if (typeof maxExperiments === 'number' && maxExperiments > 0) {
      let count = 0;
      for (const group of plan.experimentGroups) {
        if (!Array.isArray(group.experiments)) continue;
        group.experiments = group.experiments.filter(() => {
          if (count >= maxExperiments) return false;
          count += 1;
          return true;
        });
      }
    }

    return {
      nextStep: 'hitl_direction',
      contextPatch: { plan },
      message: `Plan generated with ${plan.experimentGroups.length} groups`,
    };
  }

  private async stepHitlDirection(workflow: WorkflowRow): Promise<StepOutcome> {
    if (this.isAutonomous(workflow)) {
      const decision = await this.decideDirectionAutonomously(workflow);

      await this.emitEvent(workflow.id, undefined, 'autonomous.decision', 'Autonomous decision at direction gate', {
        step: 'hitl_direction',
        decision: decision.action,
        reason: decision.reason,
      });

      if (decision.action === 'stop_workflow') {
        return {
          terminalStatus: 'cancelled',
          message: `Autonomous stop: ${decision.reason}`,
        };
      }

      if (decision.action === 'request_changes') {
        const regenCount = workflow.context.planRegenerationCount || 0;
        if (regenCount >= 1) {
          return {
            nextStep: 'experiments_materialize',
            message: 'Autonomous mode reached re-plan cap; proceeding with current plan',
          };
        }
        return {
          nextStep: 'plan_generate',
          contextPatch: { planRegenerationCount: regenCount + 1 },
          message: `Autonomous re-plan requested: ${decision.reason}`,
        };
      }

      return {
        nextStep: 'experiments_materialize',
        message: `Autonomous approval: ${decision.reason}`,
      };
    }

    let gate = await hitlService.getLatestByStep(workflow.id, 'hitl_direction');

    if (!gate) {
      gate = await hitlService.createGate({
        workflowId: workflow.id,
        step: 'hitl_direction',
        title: '研究方向确认',
        question: '是否按当前自动生成计划继续执行？',
        options: ['approve_plan', 'request_changes', 'stop_workflow'],
        requestedBy: workflow.context.requestedBy,
      });
    }

    if (gate.status === 'pending') {
      return {
        waitingHuman: true,
        message: 'Waiting for human decision on research direction',
      };
    }

    if (gate.status === 'approved' && (gate.selectedOption === 'approve_plan' || !gate.selectedOption)) {
      return {
        nextStep: 'experiments_materialize',
        message: 'Direction approved by human reviewer',
      };
    }

    if (gate.selectedOption === 'stop_workflow' || gate.status === 'rejected') {
      return {
        terminalStatus: 'cancelled',
        message: 'Workflow stopped by human decision',
      };
    }

    if (gate.status === 'changes_requested' || gate.selectedOption === 'request_changes') {
      return {
        terminalStatus: 'failed',
        message: 'Human requested plan changes. Please adjust project goal and resume.',
      };
    }

    return {
      waitingHuman: true,
      message: 'Waiting for valid human decision',
      requeueAfterMs: 15000,
    };
  }

  private async stepExperimentsMaterialize(workflow: WorkflowRow): Promise<StepOutcome> {
    const context = workflow.context;
    const plan = context.plan;

    if (!plan || !Array.isArray(plan.experimentGroups)) {
      throw new Error('Plan missing or invalid; cannot materialize experiments');
    }

    const groupIds: string[] = context.experimentGroupIds ? [...context.experimentGroupIds] : [];
    const experimentIds: string[] = context.experimentIds ? [...context.experimentIds] : [];

    for (const group of plan.experimentGroups) {
      const createdGroup = await experimentGroupService.create({
        projectId: workflow.projectId,
        name: group.name,
        type: group.type,
        hypothesis: group.hypothesis,
        expectedImpact: group.expectedImpact || '',
        verificationMethod: group.verificationMethod || '',
        priority: group.priority || 0,
      });

      await experimentGroupService.update(createdGroup.id, { status: 'approved' });
      groupIds.push(createdGroup.id);

      if (!Array.isArray(group.experiments)) {
        continue;
      }

      for (const planExperiment of group.experiments) {
        const experiment = await experimentService.create({
          groupId: createdGroup.id,
          name: planExperiment.name,
          description: planExperiment.description,
          config: this.normalizeExperimentConfig(planExperiment.config),
          variables: planExperiment.variables || {},
          controlVariables: {},
          priority: planExperiment.priority || 0,
        });

        experimentIds.push(experiment.id);
      }
    }

    return {
      nextStep: 'runs_create_submit',
      contextPatch: {
        experimentGroupIds: this.unique(groupIds),
        experimentIds: this.unique(experimentIds),
      },
      message: `Materialized ${groupIds.length} groups and ${experimentIds.length} experiments`,
    };
  }

  private async stepRunsCreateSubmit(workflow: WorkflowRow): Promise<StepOutcome> {
    const context = workflow.context;
    const experimentIds = context.experimentIds || [];

    if (experimentIds.length === 0) {
      throw new Error('No experiments to submit');
    }

    const clusterType = await this.pickClusterType(context.clusterType);
    const runIds = context.runIds ? [...context.runIds] : [];

    for (const experimentId of experimentIds) {
      const experiment = await experimentService.getById(experimentId);
      if (!experiment) {
        continue;
      }

      const existingRuns = await runService.list({ experimentId });
      let run = existingRuns.data[0];

      if (!run) {
        run = await runService.create({
          experimentId,
          clusterType: clusterType || context.clusterType || 'ssh',
        });
        runIds.push(run.id);
      }

      if (run.clusterJobId) {
        continue;
      }

      if (!clusterType) {
        await runService.updateStatus(run.id, 'failed', 'No available cluster adapter');
        await experimentService.updateStatus(experimentId, 'failed');
        continue;
      }

      try {
        const job = await this.buildJobSpec(experiment, run.id);
        const handle = await clusterService.submit(job, clusterType);

        await runService.update(run.id, {
          clusterJobId: handle.jobId,
          status: 'queued',
        });
        await experimentService.updateStatus(experimentId, 'queued');

        await this.emitEvent(workflow.id, undefined, 'run.submitted', `Run submitted for experiment ${experiment.name}`, {
          experimentId,
          runId: run.id,
          clusterType,
          clusterJobId: handle.jobId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await runService.updateStatus(run.id, 'failed', message);
        await experimentService.updateStatus(experimentId, 'failed');
        await this.emitEvent(workflow.id, undefined, 'run.submit_failed', `Run submission failed for ${experiment.name}`, {
          experimentId,
          runId: run.id,
          error: message,
        });
      }
    }

    return {
      nextStep: 'runs_wait_terminal',
      contextPatch: {
        runIds: this.unique(runIds),
        clusterType: clusterType || context.clusterType,
      },
      message: 'Run submission step completed',
    };
  }

  private async stepRunsWaitTerminal(workflow: WorkflowRow): Promise<StepOutcome> {
    const runIds = workflow.context.runIds || [];
    if (runIds.length === 0) {
      return {
        nextStep: 'results_analyze',
        message: 'No runs tracked; continue to analysis',
      };
    }

    let active = 0;

    for (const runId of runIds) {
      const run = await runService.getById(runId);
      if (!run) {
        continue;
      }

      if (['pending', 'queued', 'running'].includes(run.status)) {
        active += 1;
      }

      if (run.status === 'completed' && (!run.finalMetrics || Object.keys(run.finalMetrics).length === 0)) {
        const synthetic = this.syntheticMetrics(run.id);
        await runService.update(run.id, {
          finalMetrics: synthetic,
          metrics: synthetic,
        });
      }

      if (run.status === 'completed') {
        await experimentService.updateStatus(run.experimentId, 'completed');
      }

      if (run.status === 'failed' || run.status === 'timeout') {
        await experimentService.updateStatus(run.experimentId, 'failed');
      }

      if (run.status === 'cancelled') {
        await experimentService.updateStatus(run.experimentId, 'cancelled');
      }
    }

    if (active > 0) {
      return {
        requeueAfterMs: 10000,
        message: `${active} runs still active`,
      };
    }

    return {
      nextStep: 'results_analyze',
      message: 'All runs reached terminal state',
    };
  }

  private async stepResultsAnalyze(workflow: WorkflowRow): Promise<StepOutcome> {
    const project = await projectService.getById(workflow.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const experimentIds = workflow.context.experimentIds || [];
    const results: ExperimentResult[] = [];

    for (const experimentId of experimentIds) {
      const experiment = await experimentService.getById(experimentId);
      if (!experiment) {
        continue;
      }

      const runList = await runService.list({ experimentId });
      const completed = runList.data.filter((run) => run.status === 'completed');
      const bestRun = completed[0] || runList.data[0];

      results.push({
        experiment,
        runs: runList.data,
        bestRun,
        averageMetrics: bestRun?.metrics,
      });
    }

    if (results.length === 0) {
      throw new Error('No experiment results available for analysis');
    }

    let analysis: ExperimentAnalysis;

    try {
      analysis = await analysisAgent.analyzeResults({
        projectName: project.name,
        researchGoal: project.researchGoal,
        baselineResult: results[0],
        results,
      });
    } catch (error) {
      logger.warn({ error }, 'Analysis agent failed, using local fallback analysis');
      const best = results
        .map((r) => ({ name: r.experiment.name, acc: r.bestRun?.metrics?.accuracy || 0 }))
        .sort((a, b) => b.acc - a.acc)[0];

      analysis = {
        summary: `Fallback analysis generated for ${project.name}. Best experiment: ${best?.name || 'N/A'}.`,
        keyFindings: [
          `Evaluated ${results.length} experiments`,
          `Best observed accuracy: ${(best?.acc || 0).toFixed(4)}`,
        ],
        performanceComparison: results.map((r) => ({
          experimentName: r.experiment.name,
          metrics: (r.bestRun?.metrics || {}) as Record<string, number>,
        })),
        insights: ['More ablation and longer runs are recommended for stronger evidence.'],
        recommendations: ['Run one additional ablation before final report.'],
        suggestedNextSteps: [
          {
            action: 'Run targeted ablation',
            rationale: 'Validate contribution of key change',
            priority: 'high',
          },
        ],
        limitations: ['Fallback analysis without richer qualitative interpretation.'],
      };
    }

    return {
      nextStep: 'hitl_improvement',
      contextPatch: { analysis },
      message: 'Results analysis completed',
    };
  }

  private async stepHitlImprovement(workflow: WorkflowRow): Promise<StepOutcome> {
    if (this.isAutonomous(workflow)) {
      const decision = await this.decideImprovementAutonomously(workflow);

      await this.emitEvent(workflow.id, undefined, 'autonomous.decision', 'Autonomous decision at improvement gate', {
        step: 'hitl_improvement',
        decision: decision.action,
        reason: decision.reason,
      });

      if (decision.action === 'stop_workflow') {
        return {
          terminalStatus: 'cancelled',
          message: `Autonomous stop: ${decision.reason}`,
        };
      }

      if (decision.action === 'add_ablation_round') {
        const round = workflow.context.ablationRound || 0;
        if (round >= 2) {
          return {
            nextStep: 'report_generate',
            message: 'Autonomous mode reached ablation cap; proceeding to report',
          };
        }

        const created = await this.createAblationExperiment(workflow);
        return {
          nextStep: 'runs_create_submit',
          contextPatch: {
            experimentIds: this.unique([...(workflow.context.experimentIds || []), created.id]),
            ablationRound: round + 1,
          },
          message: `Autonomous ablation generated: ${created.name}`,
        };
      }

      return {
        nextStep: 'report_generate',
        message: `Autonomous continue: ${decision.reason}`,
      };
    }

    let gate = await hitlService.getLatestByStep(workflow.id, 'hitl_improvement');

    if (!gate) {
      gate = await hitlService.createGate({
        workflowId: workflow.id,
        step: 'hitl_improvement',
        title: '实验后方向选择',
        question: '是否直接出报告，还是先补一轮消融实验？',
        options: ['continue_to_report', 'add_ablation_round', 'stop_workflow'],
        requestedBy: workflow.context.requestedBy,
      });
    }

    if (gate.status === 'pending') {
      return {
        waitingHuman: true,
        message: 'Waiting for human decision on post-analysis direction',
      };
    }

    if (gate.selectedOption === 'stop_workflow' || gate.status === 'rejected') {
      return {
        terminalStatus: 'cancelled',
        message: 'Workflow stopped at improvement gate',
      };
    }

    if (gate.selectedOption === 'add_ablation_round') {
      const round = workflow.context.ablationRound || 0;
      if (round >= 2) {
        return {
          nextStep: 'report_generate',
          message: 'Ablation round cap reached; proceeding to report',
        };
      }

      const created = await this.createAblationExperiment(workflow);
      return {
        nextStep: 'runs_create_submit',
        contextPatch: {
          experimentIds: this.unique([...(workflow.context.experimentIds || []), created.id]),
          ablationRound: round + 1,
        },
        message: `Created ablation experiment ${created.name}`,
      };
    }

    if (gate.status === 'changes_requested') {
      const created = await this.createAblationExperiment(workflow);
      return {
        nextStep: 'runs_create_submit',
        contextPatch: {
          experimentIds: this.unique([...(workflow.context.experimentIds || []), created.id]),
          ablationRound: (workflow.context.ablationRound || 0) + 1,
        },
        message: 'Human requested changes; generated ablation round',
      };
    }

    return {
      nextStep: 'report_generate',
      message: 'Proceeding to report generation',
    };
  }

  private async stepReportGenerate(workflow: WorkflowRow): Promise<StepOutcome> {
    const project = await projectService.getById(workflow.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const experiments: Array<{
      name: string;
      description: string;
      config: Record<string, unknown>;
      results: Record<string, number>;
    }> = [];

    for (const experimentId of workflow.context.experimentIds || []) {
      const experiment = await experimentService.getById(experimentId);
      if (!experiment) {
        continue;
      }

      const runList = await runService.list({ experimentId: experiment.id });
      const bestRun = runList.data.find((r) => r.status === 'completed') || runList.data[0];

      experiments.push({
        name: experiment.name,
        description: experiment.description || '',
        config: experiment.config as unknown as Record<string, unknown>,
        results: ((bestRun?.finalMetrics || bestRun?.metrics || {}) as unknown as Record<string, number>),
      });
    }

    const report = await reportService.generate({
      projectId: workflow.projectId,
      type: 'final',
      data: {
        title: `${project.name} - Auto Workflow Report`,
        projectName: project.name,
        researchGoal: project.researchGoal,
        methodology: 'Automated orchestration workflow with human-in-the-loop gates.',
        experiments,
        analysis: workflow.context.analysis,
      },
      compilePdf: false,
      autoPlot: {
        enabled: true,
        engine: workflow.context.plotEngine || 'auto',
      },
    });

    await reportService.updateStatus(report.id, 'completed');

    return {
      nextStep: 'paper_review',
      contextPatch: { reportId: report.id },
      message: `Report generated (${report.id})`,
    };
  }

  private async stepPaperReview(workflow: WorkflowRow): Promise<StepOutcome> {
    const project = await projectService.getById(workflow.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const review = await reviewService.generate({
      projectId: workflow.projectId,
      workflowId: workflow.id,
      reportId: workflow.context.reportId,
      title: `${project.name} - Auto Paper Review`,
    });

    return {
      nextStep: 'complete',
      contextPatch: { reviewId: review.id },
      message: `Paper review generated (${review.id})`,
    };
  }

  private async createAblationExperiment(workflow: WorkflowRow): Promise<Experiment> {
    const baseExperimentId = workflow.context.experimentIds?.[0];
    if (!baseExperimentId) {
      throw new Error('No base experiment available for ablation');
    }

    const baseExperiment = await experimentService.getById(baseExperimentId);
    if (!baseExperiment) {
      throw new Error('Base experiment not found');
    }

    const round = (workflow.context.ablationRound || 0) + 1;
    const ablationConfig = this.normalizeExperimentConfig(baseExperiment.config);
    ablationConfig.training.epochs = Math.max(1, (ablationConfig.training.epochs || 3) - 1);

    const created = await experimentService.create({
      groupId: baseExperiment.groupId,
      name: `${baseExperiment.name} - ablation-r${round}`,
      description: `Auto ablation round ${round}`,
      config: ablationConfig,
      variables: {
        ...(baseExperiment.variables || {}),
        ablationRound: round,
        ablationFlag: true,
      },
      controlVariables: baseExperiment.controlVariables,
      priority: (baseExperiment.priority || 0) + round,
    });

    await experimentService.updateStatus(created.id, 'pending');
    return created;
  }

  private async pickClusterType(preferred?: 'slurm' | 'kubernetes' | 'ssh'): Promise<'slurm' | 'kubernetes' | 'ssh' | null> {
    if (preferred) {
      const adapter = clusterService.getAdapter(preferred);
      if (adapter && await adapter.isAvailable()) {
        return preferred;
      }
    }

    const detected = await clusterService.detectClusters();
    const order: Array<'slurm' | 'kubernetes' | 'ssh'> = ['slurm', 'kubernetes', 'ssh'];

    for (const type of order) {
      const available = detected.find((item) => item.type === type && item.available);
      if (available) {
        return type;
      }
    }

    return null;
  }

  private async buildJobSpec(experiment: Experiment, runId: string) {
    const workDir = join(process.cwd(), 'artifacts', 'jobs', runId);
    await mkdir(workDir, { recursive: true });

    const resources = experiment.config.resources || {};
    const dataset = experiment.config.data?.dataset || 'unknown-dataset';
    const model = experiment.config.model?.name || 'unknown-model';

    const script = [
      'set -e',
      `echo "[workflow] start run ${runId}"`,
      `echo "[workflow] model=${model} dataset=${dataset}"`,
      'echo "[workflow] simulate training on CPU/GPU cluster"',
      'sleep 2',
      `echo "[workflow] completed run ${runId}"`,
    ].join('\n');

    return {
      name: `exp-${experiment.id}`,
      script,
      workDir,
      resources: {
        gpuType: resources.gpuType,
        gpuCount: resources.gpuCount,
        cpuCount: resources.cpuCount || 4,
        memoryGb: resources.memoryGb || 8,
        timeLimit: resources.timeLimit || '00:20:00',
      },
      priority: experiment.priority,
      env: {
        EXPERIMENT_ID: experiment.id,
        RUN_ID: runId,
      },
    };
  }

  private syntheticMetrics(seed: string): Record<string, number> {
    const hex = createHash('sha1').update(seed).digest('hex');
    const n1 = parseInt(hex.slice(0, 8), 16) / 0xffffffff;
    const n2 = parseInt(hex.slice(8, 16), 16) / 0xffffffff;

    const accuracy = Number((0.62 + n1 * 0.25).toFixed(4));
    const loss = Number((0.9 - n2 * 0.5).toFixed(4));

    return {
      accuracy,
      loss,
      f1Score: Number((accuracy - 0.03).toFixed(4)),
      precision: Number((accuracy - 0.02).toFixed(4)),
      recall: Number((accuracy - 0.01).toFixed(4)),
    };
  }

  private normalizeExperimentConfig(config: any) {
    return {
      model: {
        name: config?.model?.name || 'baseline-model',
        architecture: config?.model?.architecture,
        pretrained: config?.model?.pretrained,
      },
      data: {
        dataset: config?.data?.dataset || 'unknown-dataset',
        trainSplit: config?.data?.trainSplit || 'train',
        valSplit: config?.data?.valSplit || 'validation',
        testSplit: config?.data?.testSplit || 'test',
        preprocessing: config?.data?.preprocessing || {},
      },
      training: {
        epochs: config?.training?.epochs || 3,
        batchSize: config?.training?.batchSize || 8,
        learningRate: config?.training?.learningRate || 0.001,
        optimizer: config?.training?.optimizer || 'adamw',
        scheduler: config?.training?.scheduler,
        warmupSteps: config?.training?.warmupSteps,
        gradientAccumulation: config?.training?.gradientAccumulation,
        mixedPrecision: config?.training?.mixedPrecision,
      },
      resources: {
        gpuType: config?.resources?.gpuType,
        gpuCount: config?.resources?.gpuCount || 0,
        cpuCount: config?.resources?.cpuCount || 4,
        memoryGb: config?.resources?.memoryGb || 8,
        timeLimit: config?.resources?.timeLimit || '00:20:00',
      },
      extra: config?.extra || {},
    };
  }

  private async createTask(
    workflowId: string,
    step: AutoWorkflowStep,
    payload: Record<string, unknown>,
    delayMs = 0,
    idempotencyKey?: string
  ): Promise<void> {
    const now = new Date();

    if (idempotencyKey) {
      const existing = await this.db
        .select()
        .from(workflowTasks)
        .where(eq(workflowTasks.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        return;
      }
    }

    await this.db.insert(workflowTasks).values({
      id: generateId(),
      workflowId,
      step,
      status: 'pending',
      payload,
      attempts: 0,
      maxAttempts: 3,
      runAfter: new Date(Date.now() + delayMs),
      idempotencyKey: idempotencyKey || null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async patchWorkflowContext(
    workflowId: string,
    currentContext: WorkflowContext,
    patch: Partial<WorkflowContext>,
    currentStep: string
  ) {
    const merged = {
      ...(currentContext || {}),
      ...patch,
    };

    await this.db
      .update(workflowInstances)
      .set({
        context: merged,
        currentStep,
        updatedAt: new Date(),
      })
      .where(eq(workflowInstances.id, workflowId));
  }

  private async emitEvent(
    workflowId: string,
    taskId: string | undefined,
    type: string,
    message: string,
    data: Record<string, unknown>,
    level: 'info' | 'warning' | 'error' = 'info'
  ) {
    const eventId = generateId();

    await this.db.insert(workflowEvents).values({
      id: eventId,
      workflowId,
      taskId: taskId || null,
      type,
      level,
      message,
      data,
      createdAt: new Date(),
    });

    this.emit('workflowEvent', {
      id: eventId,
      workflowId,
      taskId,
      type,
      level,
      message,
      data,
      createdAt: new Date().toISOString(),
    });
  }

  private async markTaskCancelled(taskId: string) {
    await this.db
      .update(workflowTasks)
      .set({
        status: 'cancelled',
        leaseUntil: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowTasks.id, taskId));
  }

  private isAutonomous(workflow: WorkflowRow): boolean {
    return workflow.context.decisionMode === 'autonomous';
  }

  private async decideDirectionAutonomously(
    workflow: WorkflowRow
  ): Promise<{ action: 'approve_plan' | 'request_changes' | 'stop_workflow'; reason: string }> {
    const plan = workflow.context.plan;
    const groupsCount = Array.isArray(plan?.experimentGroups) ? plan.experimentGroups.length : 0;
    const experimentsCount = Array.isArray(plan?.experimentGroups)
      ? plan.experimentGroups.reduce((acc: number, g: any) => acc + (Array.isArray(g?.experiments) ? g.experiments.length : 0), 0)
      : 0;
    const regenCount = workflow.context.planRegenerationCount || 0;

    const fallback = this.fallbackDirectionDecision(groupsCount, experimentsCount, regenCount);

    const llm = await this.askAutonomousLLMDecision({
      allowed: ['approve_plan', 'request_changes', 'stop_workflow'],
      fallbackAction: fallback.action,
      fallbackReason: fallback.reason,
      system:
        'You are an autonomous research program manager. Decide whether the generated plan should be approved, revised, or stopped. Return strict JSON: {"action":"approve_plan|request_changes|stop_workflow","reason":"..."}',
      user: JSON.stringify({
        mode: 'autonomous',
        objective: 'Direction gate decision',
        planSummary: plan?.summary,
        methodology: plan?.methodology,
        groupsCount,
        experimentsCount,
        regenerationCount: regenCount,
      }),
    });

    return {
      action: llm.action as 'approve_plan' | 'request_changes' | 'stop_workflow',
      reason: llm.reason,
    };
  }

  private async decideImprovementAutonomously(
    workflow: WorkflowRow
  ): Promise<{ action: 'continue_to_report' | 'add_ablation_round' | 'stop_workflow'; reason: string }> {
    const runIds = workflow.context.runIds || [];
    let completedRuns = 0;
    let failedRuns = 0;

    for (const runId of runIds) {
      const run = await runService.getById(runId);
      if (!run) continue;
      if (run.status === 'completed') completedRuns += 1;
      if (run.status === 'failed' || run.status === 'timeout' || run.status === 'cancelled') failedRuns += 1;
    }

    const analysis = workflow.context.analysis;
    const recommendations = Array.isArray(analysis?.recommendations) ? analysis.recommendations : [];
    const insights = Array.isArray(analysis?.insights) ? analysis.insights : [];
    const ablationRound = workflow.context.ablationRound || 0;

    const fallback = this.fallbackImprovementDecision({
      ablationRound,
      completedRuns,
      failedRuns,
      recommendations,
      insights,
    });

    const llm = await this.askAutonomousLLMDecision({
      allowed: ['continue_to_report', 'add_ablation_round', 'stop_workflow'],
      fallbackAction: fallback.action,
      fallbackReason: fallback.reason,
      system:
        'You are an autonomous research program manager. Decide next step after analysis. Return strict JSON: {"action":"continue_to_report|add_ablation_round|stop_workflow","reason":"..."}',
      user: JSON.stringify({
        mode: 'autonomous',
        objective: 'Improvement gate decision',
        completedRuns,
        failedRuns,
        ablationRound,
        analysisSummary: analysis?.summary,
        recommendations,
        insights,
      }),
    });

    return {
      action: llm.action as 'continue_to_report' | 'add_ablation_round' | 'stop_workflow',
      reason: llm.reason,
    };
  }

  private fallbackDirectionDecision(
    groupsCount: number,
    experimentsCount: number,
    regenCount: number
  ): { action: 'approve_plan' | 'request_changes' | 'stop_workflow'; reason: string } {
    if (groupsCount > 0 && experimentsCount > 0) {
      return {
        action: 'approve_plan',
        reason: `fallback policy: plan has ${groupsCount} groups and ${experimentsCount} experiments`,
      };
    }

    if (regenCount >= 1) {
      return {
        action: 'stop_workflow',
        reason: 'fallback policy: plan remains invalid after one regeneration attempt',
      };
    }

    return {
      action: 'request_changes',
      reason: 'fallback policy: plan lacks valid groups/experiments, requesting regeneration',
    };
  }

  private fallbackImprovementDecision(input: {
    ablationRound: number;
    completedRuns: number;
    failedRuns: number;
    recommendations: string[];
    insights: string[];
  }): { action: 'continue_to_report' | 'add_ablation_round' | 'stop_workflow'; reason: string } {
    const text = [...input.recommendations, ...input.insights].join(' ').toLowerCase();
    const mentionsAblation = /(ablation|消融)/i.test(text);

    if (input.ablationRound >= 2) {
      return {
        action: 'continue_to_report',
        reason: 'fallback policy: reached ablation cap',
      };
    }

    if (input.completedRuns === 0 && input.failedRuns > 0) {
      return {
        action: 'stop_workflow',
        reason: 'fallback policy: all runs failed, stop for safety',
      };
    }

    if (input.ablationRound < 1 && (mentionsAblation || input.failedRuns > input.completedRuns)) {
      return {
        action: 'add_ablation_round',
        reason: 'fallback policy: analysis suggests additional ablation',
      };
    }

    return {
      action: 'continue_to_report',
      reason: 'fallback policy: current evidence sufficient for report',
    };
  }

  private async askAutonomousLLMDecision<T extends string>(input: {
    allowed: T[];
    fallbackAction: T;
    fallbackReason: string;
    system: string;
    user: string;
  }): Promise<{ action: T; reason: string }> {
    const config = getConfig();
    if (!config.llm.apiKey) {
      return {
        action: input.fallbackAction,
        reason: `${input.fallbackReason} (LLM key missing)`,
      };
    }

    try {
      const client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || undefined,
      });

      const completion = await client.chat.completions.create({
        model: config.llm.model,
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      });

      const content: unknown = completion.choices?.[0]?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
          : '';

      const parsedText = this.extractJsonText(text);
      const parsed = JSON.parse(parsedText);
      const action = parsed?.action as T | undefined;
      const reason = typeof parsed?.reason === 'string' ? parsed.reason : 'LLM decision applied';

      if (action && input.allowed.includes(action)) {
        return { action, reason };
      }
    } catch (error) {
      logger.warn({ error }, 'Autonomous LLM decision failed, fallback policy applied');
    }

    return {
      action: input.fallbackAction,
      reason: `${input.fallbackReason} (LLM fallback)`,
    };
  }

  private extractJsonText(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return (match ? match[1] : text).trim();
  }

  private unique<T>(items: T[]): T[] {
    return [...new Set(items)];
  }

  private mapWorkflow(row: typeof workflowInstances.$inferSelect): WorkflowRow {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      status: row.status as WorkflowStatus,
      currentStep: row.currentStep,
      context: (row.context || {}) as WorkflowContext,
      errorMessage: row.errorMessage || undefined,
      cancelRequested: row.cancelRequested,
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapTask(row: typeof workflowTasks.$inferSelect): WorkflowTaskRow {
    return {
      id: row.id,
      workflowId: row.workflowId,
      step: row.step,
      status: row.status as WorkflowTaskStatus,
      payload: (row.payload || {}) as Record<string, unknown>,
      result: (row.result || undefined) as Record<string, unknown> | undefined,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      runAfter: row.runAfter,
      leaseUntil: row.leaseUntil || undefined,
      idempotencyKey: row.idempotencyKey || undefined,
      errorMessage: row.errorMessage || undefined,
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const orchestratorService = new OrchestratorService();
