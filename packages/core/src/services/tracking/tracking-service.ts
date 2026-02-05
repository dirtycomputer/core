/**
 * 聚合追踪服务
 * 同时推送到多个追踪系统
 */

import { createLogger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import type { TrackingAdapter } from './types';
import { MLflowAdapter } from './mlflow-adapter';
import { WandbAdapter } from './wandb-adapter';
import { TensorBoardAdapter } from './tensorboard-adapter';

const logger = createLogger('service:tracking');

interface RunMapping {
  projectName: string;
  experimentName: string;
  adapterRunIds: Map<string, string>;  // adapter name -> run ID
}

export class TrackingService {
  private adapters: TrackingAdapter[] = [];
  private runMappings: Map<string, RunMapping> = new Map();  // internal run ID -> mapping

  constructor() {
    this.initializeAdapters();
  }

  /**
   * 初始化追踪适配器
   */
  private initializeAdapters() {
    const config = getConfig();

    if (config.tracking.mlflow.enabled) {
      this.adapters.push(new MLflowAdapter({
        trackingUri: config.tracking.mlflow.trackingUri,
      }));
      logger.info('MLflow adapter initialized');
    }

    if (config.tracking.wandb.enabled && process.env.WANDB_API_KEY) {
      this.adapters.push(new WandbAdapter({
        apiKey: process.env.WANDB_API_KEY,
        entity: config.tracking.wandb.entity,
        project: config.tracking.wandb.project,
      }));
      logger.info('Wandb adapter initialized');
    }

    if (config.tracking.tensorboard.enabled) {
      this.adapters.push(new TensorBoardAdapter({
        logDir: config.tracking.tensorboard.logDir,
      }));
      logger.info('TensorBoard adapter initialized');
    }
  }

  /**
   * 获取可用的追踪器
   */
  async getAvailableAdapters(): Promise<TrackingAdapter[]> {
    const available: TrackingAdapter[] = [];

    for (const adapter of this.adapters) {
      if (await adapter.isAvailable()) {
        available.push(adapter);
      }
    }

    return available;
  }

  /**
   * 初始化追踪运行
   */
  async initRun(internalRunId: string, projectName: string, experimentName: string): Promise<void> {
    const adapterRunIds = new Map<string, string>();

    for (const adapter of this.adapters) {
      try {
        if (await adapter.isAvailable()) {
          const runId = await adapter.init(projectName, experimentName);
          adapterRunIds.set(adapter.name, runId);
          logger.info({ adapter: adapter.name, runId }, 'Tracking run initialized');
        }
      } catch (error) {
        logger.error({ adapter: adapter.name, error }, 'Failed to initialize tracking run');
      }
    }

    this.runMappings.set(internalRunId, {
      projectName,
      experimentName,
      adapterRunIds,
    });
  }

  /**
   * 记录参数
   */
  async logParams(internalRunId: string, params: Record<string, unknown>): Promise<void> {
    const mapping = this.runMappings.get(internalRunId);
    if (!mapping) {
      logger.warn({ internalRunId }, 'Run mapping not found');
      return;
    }

    for (const adapter of this.adapters) {
      const runId = mapping.adapterRunIds.get(adapter.name);
      if (runId) {
        try {
          await adapter.logParams(runId, params);
        } catch (error) {
          logger.error({ adapter: adapter.name, error }, 'Failed to log params');
        }
      }
    }
  }

  /**
   * 记录指标
   */
  async logMetrics(internalRunId: string, metrics: Record<string, number>, step?: number): Promise<void> {
    const mapping = this.runMappings.get(internalRunId);
    if (!mapping) {
      logger.warn({ internalRunId }, 'Run mapping not found');
      return;
    }

    for (const adapter of this.adapters) {
      const runId = mapping.adapterRunIds.get(adapter.name);
      if (runId) {
        try {
          await adapter.logMetrics(runId, metrics, step);
        } catch (error) {
          logger.error({ adapter: adapter.name, error }, 'Failed to log metrics');
        }
      }
    }
  }

  /**
   * 记录工件
   */
  async logArtifact(internalRunId: string, localPath: string, artifactPath?: string): Promise<void> {
    const mapping = this.runMappings.get(internalRunId);
    if (!mapping) {
      logger.warn({ internalRunId }, 'Run mapping not found');
      return;
    }

    for (const adapter of this.adapters) {
      const runId = mapping.adapterRunIds.get(adapter.name);
      if (runId) {
        try {
          await adapter.logArtifact(runId, localPath, artifactPath);
        } catch (error) {
          logger.error({ adapter: adapter.name, error }, 'Failed to log artifact');
        }
      }
    }
  }

  /**
   * 获取运行 URL
   */
  getRunUrls(internalRunId: string): Record<string, string> {
    const mapping = this.runMappings.get(internalRunId);
    if (!mapping) {
      return {};
    }

    const urls: Record<string, string> = {};

    for (const adapter of this.adapters) {
      const runId = mapping.adapterRunIds.get(adapter.name);
      if (runId) {
        urls[adapter.name] = adapter.getRunUrl(runId);
      }
    }

    return urls;
  }

  /**
   * 结束运行
   */
  async endRun(internalRunId: string, status: 'completed' | 'failed'): Promise<void> {
    const mapping = this.runMappings.get(internalRunId);
    if (!mapping) {
      logger.warn({ internalRunId }, 'Run mapping not found');
      return;
    }

    for (const adapter of this.adapters) {
      const runId = mapping.adapterRunIds.get(adapter.name);
      if (runId) {
        try {
          await adapter.endRun(runId, status);
        } catch (error) {
          logger.error({ adapter: adapter.name, error }, 'Failed to end run');
        }
      }
    }

    // 清理映射
    this.runMappings.delete(internalRunId);
  }
}

// 单例导出
export const trackingService = new TrackingService();
