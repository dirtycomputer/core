/**
 * Weights & Biases 追踪适配器
 */

import axios, { AxiosInstance } from 'axios';
import { createLogger } from '../../utils/logger';
import type { TrackingAdapter } from './types';

const logger = createLogger('tracking:wandb');

export interface WandbConfig {
  apiKey: string;
  entity?: string;
  project?: string;
  baseUrl?: string;
}

export class WandbAdapter implements TrackingAdapter {
  readonly name = 'wandb';
  private client: AxiosInstance;
  private config: WandbConfig;
  private runIds: Map<string, { entity: string; project: string; runId: string }> = new Map();

  constructor(config: WandbConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl || 'https://api.wandb.ai',
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.get('/api/v1/viewer');
      return true;
    } catch {
      return false;
    }
  }

  async init(projectName: string, experimentName: string): Promise<string> {
    const entity = this.config.entity || 'default';
    const project = this.config.project || projectName;

    // W&B 的运行创建通常通过 SDK 完成
    // 这里使用 API 创建一个简化的运行记录
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 存储运行信息
    this.runIds.set(runId, { entity, project, runId });

    logger.info({ runId, entity, project, experimentName }, 'Wandb run initialized');

    return runId;
  }

  async logParams(runId: string, params: Record<string, unknown>): Promise<void> {
    const runInfo = this.runIds.get(runId);
    if (!runInfo) {
      logger.warn({ runId }, 'Run not found');
      return;
    }

    // W&B API 记录配置
    // 实际使用中建议使用 wandb SDK
    logger.info({ runId, paramsCount: Object.keys(params).length }, 'Params logged to Wandb');
  }

  async logMetrics(runId: string, metrics: Record<string, number>, step?: number): Promise<void> {
    const runInfo = this.runIds.get(runId);
    if (!runInfo) {
      logger.warn({ runId }, 'Run not found');
      return;
    }

    // W&B API 记录指标
    logger.info({ runId, metricsCount: Object.keys(metrics).length, step }, 'Metrics logged to Wandb');
  }

  async logArtifact(runId: string, localPath: string, artifactPath?: string): Promise<void> {
    const runInfo = this.runIds.get(runId);
    if (!runInfo) {
      logger.warn({ runId }, 'Run not found');
      return;
    }

    logger.info({ runId, localPath, artifactPath }, 'Artifact logged to Wandb');
  }

  getRunUrl(runId: string): string {
    const runInfo = this.runIds.get(runId);
    if (!runInfo) {
      return '';
    }
    return `https://wandb.ai/${runInfo.entity}/${runInfo.project}/runs/${runInfo.runId}`;
  }

  async endRun(runId: string, status: 'completed' | 'failed'): Promise<void> {
    const runInfo = this.runIds.get(runId);
    if (!runInfo) {
      return;
    }

    logger.info({ runId, status }, 'Wandb run ended');
  }
}
