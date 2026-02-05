/**
 * 数据库连接配置
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../models/schema';

const { Pool } = pg;

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
}

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDefaultConfig(): DatabaseConfig {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'roc',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  };
}

export function initDatabase(config?: Partial<DatabaseConfig>) {
  const finalConfig = { ...getDefaultConfig(), ...config };

  pool = new Pool({
    host: finalConfig.host,
    port: finalConfig.port,
    database: finalConfig.database,
    user: finalConfig.user,
    password: finalConfig.password,
    ssl: finalConfig.ssl ? { rejectUnauthorized: false } : undefined,
    max: finalConfig.maxConnections,
  });

  db = drizzle(pool, { schema });

  return db;
}

export function getDatabase() {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

export function getPool() {
  if (!pool) {
    initDatabase();
  }
  return pool!;
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export { schema };
