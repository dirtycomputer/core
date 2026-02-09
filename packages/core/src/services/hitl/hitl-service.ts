import { and, desc, eq } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { humanGates } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { HitlGateStatus, HumanGate } from '../../models/types';

const logger = createLogger('service:hitl');

export interface CreateGateInput {
  workflowId: string;
  step: string;
  title: string;
  question: string;
  options: string[];
  requestedBy?: string;
}

export interface ResolveGateInput {
  status: Exclude<HitlGateStatus, 'pending'>;
  selectedOption?: string;
  comment?: string;
  resolvedBy?: string;
}

export class HitlService {
  private db = getDatabase();

  async createGate(input: CreateGateInput): Promise<HumanGate> {
    const now = new Date();
    const id = generateId();

    const [row] = await this.db
      .insert(humanGates)
      .values({
        id,
        workflowId: input.workflowId,
        step: input.step,
        title: input.title,
        question: input.question,
        options: input.options,
        status: 'pending',
        requestedBy: input.requestedBy || null,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ gateId: id, workflowId: input.workflowId, step: input.step }, 'HITL gate created');
    return this.mapGate(row);
  }

  async getById(id: string): Promise<HumanGate | null> {
    const [row] = await this.db.select().from(humanGates).where(eq(humanGates.id, id)).limit(1);
    return row ? this.mapGate(row) : null;
  }

  async getByWorkflow(workflowId: string): Promise<HumanGate[]> {
    const rows = await this.db
      .select()
      .from(humanGates)
      .where(eq(humanGates.workflowId, workflowId))
      .orderBy(desc(humanGates.createdAt));

    return rows.map((row) => this.mapGate(row));
  }

  async getLatestByStep(workflowId: string, step: string): Promise<HumanGate | null> {
    const [row] = await this.db
      .select()
      .from(humanGates)
      .where(and(eq(humanGates.workflowId, workflowId), eq(humanGates.step, step)))
      .orderBy(desc(humanGates.createdAt))
      .limit(1);

    return row ? this.mapGate(row) : null;
  }

  async getOrCreatePendingGate(input: CreateGateInput): Promise<HumanGate> {
    const existing = await this.getLatestByStep(input.workflowId, input.step);
    if (existing && existing.status === 'pending') {
      return existing;
    }
    return this.createGate(input);
  }

  async resolveGate(gateId: string, input: ResolveGateInput): Promise<HumanGate | null> {
    const [row] = await this.db
      .update(humanGates)
      .set({
        status: input.status,
        selectedOption: input.selectedOption || null,
        comment: input.comment || null,
        resolvedBy: input.resolvedBy || null,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(humanGates.id, gateId))
      .returning();

    if (!row) {
      return null;
    }

    logger.info({ gateId, status: input.status }, 'HITL gate resolved');
    return this.mapGate(row);
  }

  private mapGate(row: typeof humanGates.$inferSelect): HumanGate {
    return {
      id: row.id,
      workflowId: row.workflowId,
      step: row.step,
      title: row.title,
      question: row.question,
      options: (row.options || []) as string[],
      status: row.status as HitlGateStatus,
      selectedOption: row.selectedOption || undefined,
      comment: row.comment || undefined,
      requestedBy: row.requestedBy || undefined,
      requestedAt: row.requestedAt,
      resolvedAt: row.resolvedAt || undefined,
      resolvedBy: row.resolvedBy || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const hitlService = new HitlService();
