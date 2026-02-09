/**
 * WebSocket 服务
 * 提供实时日志流和状态更新
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { createLogger } from '../utils/logger';
import { monitorService } from '../services/monitor/index';
import { clusterService } from '../services/cluster/index';
import { runService } from '../services/experiment/index';
import { orchestratorService } from '../services/orchestrator/index';

const logger = createLogger('websocket');

interface WSClient {
  ws: WebSocket;
  subscriptions: Set<string>;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private clientIdCounter = 0;

  /**
   * 初始化 WebSocket 服务
   */
  init(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const clientId = `client_${++this.clientIdCounter}`;
      this.clients.set(clientId, { ws, subscriptions: new Set() });

      logger.info({ clientId }, 'WebSocket client connected');

      ws.on('message', (data) => {
        this.handleMessage(clientId, data.toString());
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        logger.info({ clientId }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error({ clientId, error }, 'WebSocket error');
      });

      // 发送欢迎消息
      this.send(clientId, { type: 'connected', clientId });
    });

    // 监听监控服务事件
    this.setupMonitorListeners();

    logger.info('WebSocket service initialized');
  }

  /**
   * 设置监控服务监听器
   */
  private setupMonitorListeners() {
    monitorService.on('statusChange', (data) => {
      this.broadcast({
        type: 'run:statusChange',
        data,
      });
    });

    monitorService.on('alert', (alert) => {
      this.broadcast({
        type: 'alert:new',
        data: alert,
      });
    });

    orchestratorService.on('workflowEvent', (event) => {
      this.broadcast({
        type: 'workflow:event',
        data: event,
      });
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleMessage(clientId: string, message: string) {
    try {
      const msg = JSON.parse(message);
      const client = this.clients.get(clientId);

      if (!client) return;

      switch (msg.type) {
        case 'subscribe:run':
          client.subscriptions.add(`run:${msg.runId}`);
          this.send(clientId, { type: 'subscribed', channel: `run:${msg.runId}` });
          break;

        case 'unsubscribe:run':
          client.subscriptions.delete(`run:${msg.runId}`);
          this.send(clientId, { type: 'unsubscribed', channel: `run:${msg.runId}` });
          break;

        case 'subscribe:logs':
          await this.streamLogs(clientId, msg.runId);
          break;

        case 'ping':
          this.send(clientId, { type: 'pong', timestamp: Date.now() });
          break;

        default:
          logger.warn({ clientId, type: msg.type }, 'Unknown message type');
      }
    } catch (error) {
      logger.error({ clientId, error }, 'Failed to handle message');
    }
  }

  /**
   * 流式传输日志
   */
  private async streamLogs(clientId: string, runId: string) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const run = await runService.getById(runId);
    if (!run || !run.clusterJobId) {
      this.send(clientId, { type: 'error', message: 'Run not found or no cluster job' });
      return;
    }

    try {
      for await (const entry of clusterService.logs(run.clusterJobId, run.clusterType, { follow: true })) {
        if (!this.clients.has(clientId)) {
          break;  // 客户端已断开
        }

        this.send(clientId, {
          type: 'log',
          runId,
          data: entry,
        });
      }
    } catch (error) {
      logger.error({ clientId, runId, error }, 'Failed to stream logs');
    }
  }

  /**
   * 发送消息给指定客户端
   */
  private send(clientId: string, data: unknown) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  /**
   * 广播消息给所有客户端
   */
  broadcast(data: unknown) {
    const message = JSON.stringify(data);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  /**
   * 发送消息给订阅了特定频道的客户端
   */
  broadcastToChannel(channel: string, data: unknown) {
    const message = JSON.stringify(data);
    for (const [, client] of this.clients) {
      if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  /**
   * 关闭服务
   */
  close() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
    logger.info('WebSocket service closed');
  }
}

// 单例导出
export const wsService = new WebSocketService();
