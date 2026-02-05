/**
 * TensorBoard 追踪适配器
 * 通过写入 TensorBoard 日志文件实现追踪
 */

import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../utils/logger';
import type { TrackingAdapter } from './types';

const logger = createLogger('tracking:tensorboard');

export interface TensorBoardConfig {
  logDir: string;
}

export class TensorBoardAdapter implements TrackingAdapter {
  readonly name = 'tensorboard';
  private config: TensorBoardConfig;
  private runDirs: Map<string, string> = new Map();

  constructor(config: TensorBoardConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // TensorBoard 适配器总是可用的（只需要文件系统）
    return true;
  }

  async init(projectName: string, experimentName: string): Promise<string> {
    const runId = `${experimentName}_${Date.now()}`;
    const runDir = join(this.config.logDir, projectName, runId);

    await mkdir(runDir, { recursive: true });
    this.runDirs.set(runId, runDir);

    logger.info({ runId, runDir }, 'TensorBoard run initialized');

    return runId;
  }

  async logParams(runId: string, params: Record<string, unknown>): Promise<void> {
    const runDir = this.runDirs.get(runId);
    if (!runDir) {
      logger.warn({ runId }, 'Run not found');
      return;
    }

    // 将参数写入 hparams 文件
    const hparamsPath = join(runDir, 'hparams.json');
    await writeFile(hparamsPath, JSON.stringify(params, null, 2));

    logger.info({ runId, paramsCount: Object.keys(params).length }, 'Params logged to TensorBoard');
  }

  async logMetrics(runId: string, metrics: Record<string, number>, step?: number): Promise<void> {
    const runDir = this.runDirs.get(runId);
    if (!runDir) {
      logger.warn({ runId }, 'Run not found');
      return;
    }

    // 将指标追加到 CSV 文件（简化实现）
    // 实际的 TensorBoard 使用 protobuf 格式的事件文件
    const metricsPath = join(runDir, 'metrics.csv');

    const timestamp = Date.now();
    const line = `${timestamp},${step || 0},${JSON.stringify(metrics)}\n`;

    await appendFile(metricsPath, line);

    // 同时写入 JSON 格式便于读取
    const jsonPath = join(runDir, 'metrics.jsonl');
    const jsonLine = JSON.stringify({ timestamp, step: step || 0, ...metrics }) + '\n';
    await appendFile(jsonPath, jsonLine);
  }

  async logArtifact(runId: string, localPath: string, artifactPath?: string): Promise<void> {
    const runDir = this.runDirs.get(runId);
    if (!runDir) {
      logger.warn({ runId }, 'Run not found');
      return;
    }

    // 记录工件路径
    const artifactsPath = join(runDir, 'artifacts.json');
    const artifact = { localPath, artifactPath, timestamp: Date.now() };

    await appendFile(artifactsPath, JSON.stringify(artifact) + '\n');

    logger.info({ runId, localPath }, 'Artifact logged to TensorBoard');
  }

  getRunUrl(runId: string): string {
    const runDir = this.runDirs.get(runId);
    if (!runDir) {
      return '';
    }
    // TensorBoard 本地 URL
    return `http://localhost:6006/#scalars&runFilter=${runId}`;
  }

  async endRun(runId: string, status: 'completed' | 'failed'): Promise<void> {
    const runDir = this.runDirs.get(runId);
    if (!runDir) {
      return;
    }

    // 写入运行状态
    const statusPath = join(runDir, 'status.json');
    await writeFile(statusPath, JSON.stringify({
      status,
      endTime: Date.now(),
    }));

    logger.info({ runId, status }, 'TensorBoard run ended');
  }
}
