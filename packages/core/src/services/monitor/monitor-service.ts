/**
 * 监控服务
 * 监控运行状态、检测异常、发送告警
 */

import { EventEmitter } from 'events';
import { eq, and } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { alerts } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import { clusterService } from '../cluster/cluster-service';
import { runService } from '../experiment/run-service';
import type { Run, RunStatus, Alert, AlertType, AlertSeverity } from '../../models/types';

const logger = createLogger('service:monitor');

export interface AlertRule {
  type: AlertType;
  condition: (run: Run, metrics: Record<string, number[]>) => boolean;
  severity: AlertSeverity;
  message: (run: Run) => string;
}

export interface MonitorConfig {
  pollIntervalMs?: number;
  maxConsecutiveFailures?: number;
  metricsWindowSize?: number;
}

export class MonitorService extends EventEmitter {
  private db = getDatabase();
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private config: Required<MonitorConfig>;
  private metricsHistory: Map<string, Record<string, number[]>> = new Map();
  private alertRules: AlertRule[] = [];

  constructor(config: MonitorConfig = {}) {
    super();
    this.config = {
      pollIntervalMs: config.pollIntervalMs || 30000,  // 30 秒
      maxConsecutiveFailures: config.maxConsecutiveFailures || 3,
      metricsWindowSize: config.metricsWindowSize || 100,
    };

    this.initializeDefaultRules();
  }

  /**
   * 初始化默认告警规则
   */
  private initializeDefaultRules() {
    // OOM 检测
    this.alertRules.push({
      type: 'oom',
      condition: (run: Run) => {
        return run.errorMessage?.toLowerCase().includes('out of memory') ||
               run.errorMessage?.toLowerCase().includes('oom') ||
               run.errorMessage?.toLowerCase().includes('cuda out of memory') || false;
      },
      severity: 'error',
      message: (run: Run) => `Run ${run.id} terminated due to out of memory error`,
    });

    // 崩溃检测
    this.alertRules.push({
      type: 'crash',
      condition: (run: Run) => {
        return run.status === 'failed' && !run.errorMessage?.toLowerCase().includes('out of memory');
      },
      severity: 'error',
      message: (run: Run) => `Run ${run.id} crashed: ${run.errorMessage || 'Unknown error'}`,
    });

    // 不收敛检测 (loss 持续上升)
    this.alertRules.push({
      type: 'no_progress',
      condition: (_run: Run, metrics: Record<string, number[]>) => {
        const lossHistory = metrics['loss'] || metrics['train_loss'] || [];
        if (lossHistory.length < 10) return false;

        // 检查最近 10 个点是否持续上升
        const recent = lossHistory.slice(-10);
        let increasing = 0;
        for (let i = 1; i < recent.length; i++) {
          if (recent[i] > recent[i - 1]) increasing++;
        }
        return increasing >= 8;  // 80% 的点在上升
      },
      severity: 'warning',
      message: (run: Run) => `Run ${run.id} shows no progress - loss is consistently increasing`,
    });

    // 超时检测
    this.alertRules.push({
      type: 'timeout',
      condition: (run: Run) => run.status === 'timeout',
      severity: 'warning',
      message: (run: Run) => `Run ${run.id} exceeded time limit`,
    });
  }

  /**
   * 添加自定义告警规则
   */
  addAlertRule(rule: AlertRule) {
    this.alertRules.push(rule);
  }

  /**
   * 启动监控
   */
  start() {
    if (this.isRunning) {
      logger.warn('Monitor service is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ pollIntervalMs: this.config.pollIntervalMs }, 'Monitor service started');

    this.poll();
    this.pollInterval = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  /**
   * 停止监控
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    logger.info('Monitor service stopped');
  }

  /**
   * 轮询检查
   */
  private async poll() {
    try {
      // 获取所有活跃的运行
      const activeRuns = await runService.getActiveRuns();

      for (const run of activeRuns) {
        await this.checkRun(run);
      }
    } catch (error) {
      logger.error({ error }, 'Monitor poll failed');
    }
  }

  /**
   * 检查单个运行
   */
  private async checkRun(run: Run) {
    try {
      // 从集群获取最新状态
      const clusterStatus = await clusterService.status(run.clusterJobId!, run.clusterType);

      // 更新运行状态
      const newStatus = this.mapClusterStateToRunStatus(clusterStatus.state);
      if (newStatus !== run.status) {
        await runService.updateStatus(run.id, newStatus);
        run.status = newStatus;

        this.emit('statusChange', { runId: run.id, oldStatus: run.status, newStatus });
        logger.info({ runId: run.id, oldStatus: run.status, newStatus }, 'Run status changed');
      }

      // 获取指标历史
      const metricsHistory = this.metricsHistory.get(run.id) || {};

      // 更新指标历史
      if (run.metrics) {
        for (const [key, value] of Object.entries(run.metrics)) {
          if (typeof value === 'number') {
            if (!metricsHistory[key]) {
              metricsHistory[key] = [];
            }
            metricsHistory[key].push(value);
            // 保持窗口大小
            if (metricsHistory[key].length > this.config.metricsWindowSize) {
              metricsHistory[key].shift();
            }
          }
        }
        this.metricsHistory.set(run.id, metricsHistory);
      }

      // 检查告警规则
      for (const rule of this.alertRules) {
        if (rule.condition(run, metricsHistory)) {
          await this.createAlert(run, rule);
        }
      }
    } catch (error) {
      logger.error({ runId: run.id, error }, 'Failed to check run');
    }
  }

  /**
   * 创建告警
   */
  private async createAlert(run: Run, rule: AlertRule) {
    // 检查是否已存在相同类型的活跃告警
    const existingAlerts = await this.db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.runId, run.id),
          eq(alerts.type, rule.type),
          eq(alerts.status, 'active')
        )
      );

    if (existingAlerts.length > 0) {
      return;  // 已存在活跃告警，不重复创建
    }

    const id = generateId();
    const message = rule.message(run);

    await this.db.insert(alerts).values({
      id,
      runId: run.id,
      type: rule.type,
      severity: rule.severity,
      status: 'active',
      title: `${rule.type.toUpperCase()}: ${run.id}`,
      message,
      createdAt: new Date(),
    });

    const alert: Alert = {
      id,
      runId: run.id,
      type: rule.type,
      severity: rule.severity,
      status: 'active',
      title: `${rule.type.toUpperCase()}: ${run.id}`,
      message,
      createdAt: new Date(),
    };

    this.emit('alert', alert);
    logger.warn({ alertId: id, runId: run.id, type: rule.type }, 'Alert created');
  }

  /**
   * 确认告警
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    await this.db
      .update(alerts)
      .set({
        status: 'acknowledged',
        acknowledgedAt: new Date(),
      })
      .where(eq(alerts.id, alertId));

    logger.info({ alertId }, 'Alert acknowledged');
  }

  /**
   * 解决告警
   */
  async resolveAlert(alertId: string): Promise<void> {
    await this.db
      .update(alerts)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
      })
      .where(eq(alerts.id, alertId));

    logger.info({ alertId }, 'Alert resolved');
  }

  /**
   * 获取运行的告警
   */
  async getAlertsByRun(runId: string): Promise<Alert[]> {
    const results = await this.db
      .select()
      .from(alerts)
      .where(eq(alerts.runId, runId));

    return results.map((r) => ({
      id: r.id,
      runId: r.runId,
      type: r.type as AlertType,
      severity: r.severity as AlertSeverity,
      status: r.status as 'active' | 'acknowledged' | 'resolved',
      title: r.title,
      message: r.message,
      metadata: r.metadata as Record<string, unknown> | undefined,
      createdAt: r.createdAt,
      acknowledgedAt: r.acknowledgedAt || undefined,
      resolvedAt: r.resolvedAt || undefined,
    }));
  }

  /**
   * 获取活跃告警
   */
  async getActiveAlerts(): Promise<Alert[]> {
    const results = await this.db
      .select()
      .from(alerts)
      .where(eq(alerts.status, 'active'));

    return results.map((r) => ({
      id: r.id,
      runId: r.runId,
      type: r.type as AlertType,
      severity: r.severity as AlertSeverity,
      status: 'active' as const,
      title: r.title,
      message: r.message,
      metadata: r.metadata as Record<string, unknown> | undefined,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 映射集群状态到运行状态
   */
  private mapClusterStateToRunStatus(state: string): RunStatus {
    const mapping: Record<string, RunStatus> = {
      pending: 'pending',
      queued: 'queued',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
      timeout: 'timeout',
      unknown: 'pending',
    };
    return mapping[state] || 'pending';
  }
}

// 单例导出
export const monitorService = new MonitorService();
