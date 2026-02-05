/**
 * 配置管理
 */

import { z } from 'zod';

// 配置 Schema
const configSchema = z.object({
  // 服务器配置
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }).default({}),

  // 数据库配置
  database: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(5432),
    name: z.string().default('roc'),
    user: z.string().default('postgres'),
    password: z.string().default('postgres'),
    ssl: z.boolean().default(false),
    maxConnections: z.number().default(10),
  }).default({}),

  // Redis 配置
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
  }).default({}),

  // LLM 配置
  llm: z.object({
    provider: z.enum(['openai', 'anthropic']).default('openai'),
    apiKey: z.string().optional(),
    model: z.string().default('gpt-4'),
    maxTokens: z.number().default(4096),
    temperature: z.number().default(0.7),
  }).default({}),

  // 集群配置
  cluster: z.object({
    defaultType: z.enum(['slurm', 'kubernetes', 'ssh']).default('slurm'),
    slurm: z.object({
      partition: z.string().default('gpu'),
      account: z.string().optional(),
      qos: z.string().optional(),
    }).default({}),
    kubernetes: z.object({
      namespace: z.string().default('default'),
      configPath: z.string().optional(),
    }).default({}),
    ssh: z.object({
      host: z.string().optional(),
      port: z.number().default(22),
      username: z.string().optional(),
      privateKeyPath: z.string().optional(),
    }).default({}),
  }).default({}),

  // 存储配置
  storage: z.object({
    type: z.enum(['local', 's3', 'minio']).default('local'),
    basePath: z.string().default('./artifacts'),
    s3: z.object({
      bucket: z.string().optional(),
      region: z.string().default('us-east-1'),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
      endpoint: z.string().optional(),
    }).default({}),
  }).default({}),

  // 追踪集成配置
  tracking: z.object({
    mlflow: z.object({
      enabled: z.boolean().default(false),
      trackingUri: z.string().default('http://localhost:5000'),
    }).default({}),
    wandb: z.object({
      enabled: z.boolean().default(false),
      project: z.string().optional(),
      entity: z.string().optional(),
    }).default({}),
    tensorboard: z.object({
      enabled: z.boolean().default(false),
      logDir: z.string().default('./tensorboard_logs'),
    }).default({}),
  }).default({}),

  // memU 配置
  memu: z.object({
    enabled: z.boolean().default(false),
    host: z.string().default('localhost'),
    port: z.number().default(50051),
    useTls: z.boolean().default(false),
  }).default({}),
});

export type Config = z.infer<typeof configSchema>;

let config: Config | null = null;

/**
 * 从环境变量加载配置
 */
export function loadConfig(): Config {
  const rawConfig = {
    server: {
      port: parseInt(process.env.SERVER_PORT || '3000', 10),
      host: process.env.SERVER_HOST || '0.0.0.0',
    },
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      name: process.env.DB_NAME || 'roc',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ssl: process.env.DB_SSL === 'true',
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
    },
    llm: {
      provider: (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'anthropic',
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
      model: process.env.LLM_MODEL || 'gpt-4',
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '4096', 10),
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
    },
    cluster: {
      defaultType: (process.env.CLUSTER_TYPE || 'slurm') as 'slurm' | 'kubernetes' | 'ssh',
      slurm: {
        partition: process.env.SLURM_PARTITION || 'gpu',
        account: process.env.SLURM_ACCOUNT || undefined,
        qos: process.env.SLURM_QOS || undefined,
      },
      kubernetes: {
        namespace: process.env.K8S_NAMESPACE || 'default',
        configPath: process.env.KUBECONFIG || undefined,
      },
      ssh: {
        host: process.env.SSH_HOST || undefined,
        port: parseInt(process.env.SSH_PORT || '22', 10),
        username: process.env.SSH_USERNAME || undefined,
        privateKeyPath: process.env.SSH_PRIVATE_KEY_PATH || undefined,
      },
    },
    storage: {
      type: (process.env.STORAGE_TYPE || 'local') as 'local' | 's3' | 'minio',
      basePath: process.env.STORAGE_BASE_PATH || './artifacts',
      s3: {
        bucket: process.env.S3_BUCKET || undefined,
        region: process.env.S3_REGION || 'us-east-1',
        accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
        endpoint: process.env.S3_ENDPOINT || undefined,
      },
    },
    tracking: {
      mlflow: {
        enabled: process.env.MLFLOW_ENABLED === 'true',
        trackingUri: process.env.MLFLOW_TRACKING_URI || 'http://localhost:5000',
      },
      wandb: {
        enabled: process.env.WANDB_ENABLED === 'true',
        project: process.env.WANDB_PROJECT || undefined,
        entity: process.env.WANDB_ENTITY || undefined,
      },
      tensorboard: {
        enabled: process.env.TENSORBOARD_ENABLED === 'true',
        logDir: process.env.TENSORBOARD_LOG_DIR || './tensorboard_logs',
      },
    },
    memu: {
      enabled: process.env.MEMU_ENABLED === 'true',
      host: process.env.MEMU_HOST || 'localhost',
      port: parseInt(process.env.MEMU_PORT || '50051', 10),
      useTls: process.env.MEMU_USE_TLS === 'true',
    },
  };

  config = configSchema.parse(rawConfig);
  return config;
}

/**
 * 获取配置
 */
export function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

/**
 * 重置配置 (用于测试)
 */
export function resetConfig() {
  config = null;
}
