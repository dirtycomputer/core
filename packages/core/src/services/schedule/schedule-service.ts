import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { milestones, scheduleTasks } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { Milestone, MilestoneStatus, ScheduleTask, ScheduleTaskStatus } from '../../models/types';

const logger = createLogger('service:schedule');

const WORKFLOW_STEP_LABELS: Record<string, string> = {
  plan_generate: '生成研究计划',
  hitl_direction: '方向评审（人工）',
  experiments_materialize: '落地实验设计',
  runs_create_submit: '创建并提交运行',
  runs_wait_terminal: '等待运行完成',
  results_analyze: '分析实验结果',
  hitl_improvement: '改进方向评审（人工）',
  report_generate: '生成实验报告',
  paper_review: '生成审稿与复盘',
  complete: '流程收尾',
};

export interface CreateMilestoneInput {
  projectId: string;
  title: string;
  description?: string;
  dueDate?: Date;
  status?: MilestoneStatus;
  position?: number;
  owner?: string;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string;
  dueDate?: Date | null;
  status?: MilestoneStatus;
  position?: number;
  owner?: string | null;
}

export interface CreateScheduleTaskInput {
  milestoneId: string;
  workflowId?: string;
  title: string;
  description?: string;
  status?: ScheduleTaskStatus;
  assignee?: string;
  dueDate?: Date;
  dependencyTaskId?: string;
  blockingReason?: string;
  position?: number;
}

export interface UpdateScheduleTaskInput {
  title?: string;
  description?: string;
  status?: ScheduleTaskStatus;
  assignee?: string | null;
  dueDate?: Date | null;
  dependencyTaskId?: string | null;
  blockingReason?: string | null;
  position?: number;
}

export interface MilestoneWithTasks extends Milestone {
  tasks: ScheduleTask[];
}

export interface ProjectScheduleView {
  projectId: string;
  milestones: MilestoneWithTasks[];
  progress: {
    totalTasks: number;
    doneTasks: number;
    inProgressTasks: number;
    blockedTasks: number;
    completionRate: number;
  };
}

export class ScheduleService {
  private db = getDatabase();

  async createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
    const now = new Date();
    const id = generateId();

    const [row] = await this.db
      .insert(milestones)
      .values({
        id,
        projectId: input.projectId,
        title: input.title,
        description: input.description || '',
        dueDate: input.dueDate || null,
        status: input.status || 'pending',
        position: input.position ?? 0,
        owner: input.owner || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ milestoneId: id, projectId: input.projectId }, 'Milestone created');
    return this.mapMilestone(row);
  }

  async updateMilestone(id: string, input: UpdateMilestoneInput): Promise<Milestone | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.status !== undefined) patch.status = input.status;
    if (input.position !== undefined) patch.position = input.position;
    if (input.owner !== undefined) patch.owner = input.owner;

    const [row] = await this.db.update(milestones).set(patch).where(eq(milestones.id, id)).returning();
    return row ? this.mapMilestone(row) : null;
  }

  async listMilestones(projectId: string): Promise<MilestoneWithTasks[]> {
    const milestoneRows = await this.db
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.position), asc(milestones.createdAt));

    if (milestoneRows.length === 0) {
      return [];
    }

    const milestoneIds = milestoneRows.map((m) => m.id);
    const taskRows = await this.db
      .select()
      .from(scheduleTasks)
      .where(inArray(scheduleTasks.milestoneId, milestoneIds))
      .orderBy(asc(scheduleTasks.position), asc(scheduleTasks.createdAt));

    const taskMap = new Map<string, ScheduleTask[]>();
    for (const row of taskRows) {
      const list = taskMap.get(row.milestoneId) || [];
      list.push(this.mapTask(row));
      taskMap.set(row.milestoneId, list);
    }

    return milestoneRows.map((m) => ({
      ...this.mapMilestone(m),
      tasks: taskMap.get(m.id) || [],
    }));
  }

  async getProjectSchedule(projectId: string): Promise<ProjectScheduleView> {
    const milestonesWithTasks = await this.listMilestones(projectId);
    const allTasks = milestonesWithTasks.flatMap((m) => m.tasks);
    const doneTasks = allTasks.filter((t) => t.status === 'done').length;
    const inProgressTasks = allTasks.filter((t) => t.status === 'in_progress' || t.status === 'waiting_review').length;
    const blockedTasks = allTasks.filter((t) => t.status === 'blocked').length;
    const totalTasks = allTasks.length;

    return {
      projectId,
      milestones: milestonesWithTasks,
      progress: {
        totalTasks,
        doneTasks,
        inProgressTasks,
        blockedTasks,
        completionRate: totalTasks === 0 ? 0 : Number(((doneTasks / totalTasks) * 100).toFixed(1)),
      },
    };
  }

  async createTask(input: CreateScheduleTaskInput): Promise<ScheduleTask> {
    const now = new Date();
    const id = generateId();

    const [row] = await this.db
      .insert(scheduleTasks)
      .values({
        id,
        milestoneId: input.milestoneId,
        workflowId: input.workflowId || null,
        title: input.title,
        description: input.description || '',
        status: input.status || 'todo',
        assignee: input.assignee || null,
        dueDate: input.dueDate || null,
        dependencyTaskId: input.dependencyTaskId || null,
        blockingReason: input.blockingReason || null,
        position: input.position ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapTask(row);
  }

  async updateTask(id: string, input: UpdateScheduleTaskInput): Promise<ScheduleTask | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.assignee !== undefined) patch.assignee = input.assignee;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.dependencyTaskId !== undefined) patch.dependencyTaskId = input.dependencyTaskId;
    if (input.blockingReason !== undefined) patch.blockingReason = input.blockingReason;
    if (input.position !== undefined) patch.position = input.position;

    const [row] = await this.db.update(scheduleTasks).set(patch).where(eq(scheduleTasks.id, id)).returning();
    return row ? this.mapTask(row) : null;
  }

  async ensureWorkflowSchedule(projectId: string, workflowId: string, stepOrder: string[]): Promise<void> {
    const existingTasks = await this.db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.workflowId, workflowId));

    if (existingTasks.length > 0) {
      return;
    }

    const milestone = await this.createMilestone({
      projectId,
      title: '自动编排研究流程',
      description: `Workflow ${workflowId} 的端到端执行计划`,
      status: 'in_progress',
      position: 999,
    });

    for (let i = 0; i < stepOrder.length; i++) {
      const step = stepOrder[i];
      await this.createTask({
        milestoneId: milestone.id,
        workflowId,
        title: WORKFLOW_STEP_LABELS[step] || step,
        description: `step:${step}`,
        status: i === 0 ? 'in_progress' : 'todo',
        position: i,
      });
    }
  }

  async markWorkflowStep(workflowId: string, step: string, status: ScheduleTaskStatus, blockingReason?: string): Promise<void> {
    const [task] = await this.db
      .select()
      .from(scheduleTasks)
      .where(and(eq(scheduleTasks.workflowId, workflowId), eq(scheduleTasks.description, `step:${step}`)))
      .limit(1);

    if (!task) {
      return;
    }

    await this.updateTask(task.id, {
      status,
      blockingReason: blockingReason || null,
    });

    // 如果某个步骤完成，自动将下一个 todo 步骤置为 in_progress
    if (status === 'done') {
      const next = await this.db
        .select()
        .from(scheduleTasks)
        .where(and(eq(scheduleTasks.workflowId, workflowId), eq(scheduleTasks.status, 'todo')))
        .orderBy(asc(scheduleTasks.position))
        .limit(1);

      if (next[0]) {
        await this.updateTask(next[0].id, { status: 'in_progress' });
      }
    }

    // 回写里程碑状态
    const [currentTask] = await this.db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, task.id))
      .limit(1);

    if (!currentTask) {
      return;
    }

    const allTasks = await this.db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.milestoneId, currentTask.milestoneId));

    const milestoneStatus: MilestoneStatus = allTasks.every((t) => t.status === 'done')
      ? 'completed'
      : allTasks.some((t) => t.status === 'blocked')
        ? 'blocked'
        : allTasks.some((t) => t.status === 'in_progress' || t.status === 'waiting_review')
          ? 'in_progress'
          : 'pending';

    await this.db
      .update(milestones)
      .set({ status: milestoneStatus, updatedAt: new Date() })
      .where(eq(milestones.id, currentTask.milestoneId));
  }

  private mapMilestone(row: typeof milestones.$inferSelect): Milestone {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      description: row.description,
      dueDate: row.dueDate || undefined,
      status: row.status as MilestoneStatus,
      position: row.position,
      owner: row.owner || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapTask(row: typeof scheduleTasks.$inferSelect): ScheduleTask {
    return {
      id: row.id,
      milestoneId: row.milestoneId,
      workflowId: row.workflowId || undefined,
      title: row.title,
      description: row.description,
      status: row.status as ScheduleTaskStatus,
      assignee: row.assignee || undefined,
      dueDate: row.dueDate || undefined,
      dependencyTaskId: row.dependencyTaskId || undefined,
      blockingReason: row.blockingReason || undefined,
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const scheduleService = new ScheduleService();
