/**
 * 追踪适配器接口
 */

export interface TrackingAdapter {
  readonly name: string;

  /**
   * 初始化追踪
   */
  init(projectName: string, experimentName: string): Promise<string>;  // 返回 run ID

  /**
   * 记录参数
   */
  logParams(runId: string, params: Record<string, unknown>): Promise<void>;

  /**
   * 记录指标
   */
  logMetrics(runId: string, metrics: Record<string, number>, step?: number): Promise<void>;

  /**
   * 记录工件
   */
  logArtifact(runId: string, localPath: string, artifactPath?: string): Promise<void>;

  /**
   * 获取运行 URL
   */
  getRunUrl(runId: string): string;

  /**
   * 结束运行
   */
  endRun(runId: string, status: 'completed' | 'failed'): Promise<void>;

  /**
   * 检查是否可用
   */
  isAvailable(): Promise<boolean>;
}
