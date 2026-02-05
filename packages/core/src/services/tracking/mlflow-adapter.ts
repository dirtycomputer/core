/**
 * MLflow 追踪适配器
 */

import axios, { AxiosInstance } from 'axios';
import { createLogger } from '../../utils/logger';
import type { TrackingAdapter } from './types';

const logger = createLogger('tracking:mlflow');

export interface MLflowConfig {
  trackingUri: string;
  artifactLocation?: string;
}

export class MLflowAdapter implements TrackingAdapter {
  readonly name = 'mlflow';
  private client: AxiosInstance;
  private config: MLflowConfig;
  private experimentIds: Map<string, string> = new Map();

  constructor(config: MLflowConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.trackingUri,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.get('/api/2.0/mlflow/experiments/list');
      return true;
    } catch {
      return false;
    }
  }

  async init(projectName: string, experimentName: string): Promise<string> {
    const fullName = `${projectName}/${experimentName}`;

    // 获取或创建实验
    let experimentId = this.experimentIds.get(fullName);

    if (!experimentId) {
      try {
        // 尝试获取现有实验
        const getResponse = await this.client.get('/api/2.0/mlflow/experiments/get-by-name', {
          params: { experiment_name: fullName },
        });
        experimentId = getResponse.data.experiment.experiment_id;
      } catch {
        // 创建新实验
        const createResponse = await this.client.post('/api/2.0/mlflow/experiments/create', {
          name: fullName,
          artifact_location: this.config.artifactLocation,
        });
        experimentId = createResponse.data.experiment_id;
      }
      this.experimentIds.set(fullName, experimentId!);
    }

    // 创建运行
    const runResponse = await this.client.post('/api/2.0/mlflow/runs/create', {
      experiment_id: experimentId,
      start_time: Date.now(),
    });

    const runId = runResponse.data.run.info.run_id;
    logger.info({ runId, experimentId, experimentName: fullName }, 'MLflow run created');

    return runId;
  }

  async logParams(runId: string, params: Record<string, unknown>): Promise<void> {
    const paramsList = Object.entries(params).map(([key, value]) => ({
      key,
      value: String(value),
    }));

    await this.client.post('/api/2.0/mlflow/runs/log-batch', {
      run_id: runId,
      params: paramsList,
    });
  }

  async logMetrics(runId: string, metrics: Record<string, number>, step?: number): Promise<void> {
    const timestamp = Date.now();
    const metricsList = Object.entries(metrics).map(([key, value]) => ({
      key,
      value,
      timestamp,
      step: step || 0,
    }));

    await this.client.post('/api/2.0/mlflow/runs/log-batch', {
      run_id: runId,
      metrics: metricsList,
    });
  }

  async logArtifact(runId: string, localPath: string, artifactPath?: string): Promise<void> {
    // MLflow 的工件上传需要通过文件系统或 S3
    // 这里简化处理，记录路径
    logger.info({ runId, localPath, artifactPath }, 'Artifact logged (path only)');
  }

  getRunUrl(runId: string): string {
    return `${this.config.trackingUri}/#/experiments/0/runs/${runId}`;
  }

  async endRun(runId: string, status: 'completed' | 'failed'): Promise<void> {
    const mlflowStatus = status === 'completed' ? 'FINISHED' : 'FAILED';

    await this.client.post('/api/2.0/mlflow/runs/update', {
      run_id: runId,
      status: mlflowStatus,
      end_time: Date.now(),
    });

    logger.info({ runId, status }, 'MLflow run ended');
  }
}
