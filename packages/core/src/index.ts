/**
 * Research Orchestration Cockpit - 主入口
 */

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { apiRouter } from './api/routes';
import { wsService } from './api/websocket';
import { initDatabase } from './db/connection';
import { loadConfig, getConfig } from './utils/config';
import { createLogger } from './utils/logger';
import { monitorService } from './services/monitor/index';
import { orchestratorService } from './services/orchestrator/index';

const logger = createLogger('main');

async function main() {
  // 加载配置
  loadConfig();
  const config = getConfig();

  logger.info('Starting Research Orchestration Cockpit...');

  // 初始化数据库
  initDatabase();
  logger.info('Database initialized');

  // 创建 Express 应用
  const app = express();

  // 中间件
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // API 路由
  app.use('/api', apiRouter);

  // 静态文件 (用于 UI)
  app.use(express.static('public'));

  // 创建 HTTP 服务器
  const server = createServer(app);

  // 初始化 WebSocket
  wsService.init(server);

  // 启动监控服务
  monitorService.start();
  logger.info('Monitor service started');

  // 启动自动编排服务
  orchestratorService.start();
  logger.info('Orchestrator service started');

  // 启动服务器
  const port = config.server.port;
  const host = config.server.host;

  server.listen(port, host, () => {
    logger.info({ port, host }, `Server listening on http://${host}:${port}`);
    logger.info(`API available at http://${host}:${port}/api`);
    logger.info(`WebSocket available at ws://${host}:${port}/ws`);
  });

  // 优雅关闭
  const shutdown = async () => {
    logger.info('Shutting down...');

    monitorService.stop();
    orchestratorService.stop();
    wsService.close();

    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // 强制退出超时
    setTimeout(() => {
      logger.warn('Forced shutdown');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
});
