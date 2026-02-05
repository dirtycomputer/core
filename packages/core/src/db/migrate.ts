/**
 * 数据库迁移脚本
 */

import { sql } from 'drizzle-orm';
import { getDatabase, closeDatabase } from './connection';
import { createLogger } from '../utils/logger';

const logger = createLogger('db:migrate');

async function migrate() {
  logger.info('Starting database migration...');

  const db = getDatabase();

  try {
    // 创建枚举类型
    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE project_status AS ENUM ('planning', 'active', 'completed', 'archived');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE experiment_group_type AS ENUM ('baseline', 'improvement', 'ablation', 'exploration');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE experiment_group_status AS ENUM ('draft', 'approved', 'running', 'completed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE experiment_status AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE run_status AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'timeout');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE artifact_type AS ENUM ('checkpoint', 'log', 'metric', 'figure', 'report', 'code', 'config', 'other');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE alert_type AS ENUM ('crash', 'oom', 'metric_drift', 'no_progress', 'resource_waste', 'timeout', 'custom');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'error', 'critical');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE alert_status AS ENUM ('active', 'acknowledged', 'resolved');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE report_type AS ENUM ('experiment', 'ablation', 'comparison', 'final');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE report_status AS ENUM ('draft', 'generating', 'completed', 'failed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE approval_type AS ENUM ('plan', 'experiment', 'resource', 'report');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'researcher', 'viewer');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await db.execute(sql`
      DO $$ BEGIN
        CREATE TYPE cluster_type AS ENUM ('slurm', 'kubernetes', 'ssh');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // 创建用户表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        role user_role NOT NULL DEFAULT 'researcher',
        password_hash VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
    `);

    // 创建项目表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        research_goal TEXT NOT NULL DEFAULT '',
        constraints JSONB NOT NULL DEFAULT '{}',
        baseline_metrics JSONB NOT NULL DEFAULT '{}',
        status project_status NOT NULL DEFAULT 'planning',
        tags JSONB NOT NULL DEFAULT '[]',
        owner_id VARCHAR(36) NOT NULL REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);
      CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);
    `);

    // 创建实验组表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS experiment_groups (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type experiment_group_type NOT NULL DEFAULT 'improvement',
        hypothesis TEXT NOT NULL DEFAULT '',
        expected_impact TEXT NOT NULL DEFAULT '',
        verification_method TEXT NOT NULL DEFAULT '',
        status experiment_group_status NOT NULL DEFAULT 'draft',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        approved_at TIMESTAMP,
        approved_by VARCHAR(36) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS experiment_groups_project_idx ON experiment_groups(project_id);
      CREATE INDEX IF NOT EXISTS experiment_groups_status_idx ON experiment_groups(status);
    `);

    // 创建实验表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS experiments (
        id VARCHAR(36) PRIMARY KEY,
        group_id VARCHAR(36) NOT NULL REFERENCES experiment_groups(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        config JSONB NOT NULL DEFAULT '{}',
        variables JSONB NOT NULL DEFAULT '{}',
        control_variables JSONB NOT NULL DEFAULT '{}',
        status experiment_status NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        code_snapshot VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS experiments_group_idx ON experiments(group_id);
      CREATE INDEX IF NOT EXISTS experiments_status_idx ON experiments(status);
    `);

    // 创建运行实例表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS runs (
        id VARCHAR(36) PRIMARY KEY,
        experiment_id VARCHAR(36) NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL DEFAULT 1,
        cluster_type cluster_type NOT NULL,
        cluster_job_id VARCHAR(255),
        status run_status NOT NULL DEFAULT 'pending',
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        metrics JSONB NOT NULL DEFAULT '{}',
        final_metrics JSONB,
        checkpoint_path VARCHAR(1024),
        log_path VARCHAR(1024),
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS runs_experiment_idx ON runs(experiment_id);
      CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);
      CREATE INDEX IF NOT EXISTS runs_cluster_job_idx ON runs(cluster_job_id);
    `);

    // 创建工件表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS artifacts (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type artifact_type NOT NULL,
        name VARCHAR(255) NOT NULL,
        path VARCHAR(1024) NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        mime_type VARCHAR(127),
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts(run_id);
      CREATE INDEX IF NOT EXISTS artifacts_type_idx ON artifacts(type);
    `);

    // 创建告警表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS alerts (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type alert_type NOT NULL,
        severity alert_severity NOT NULL DEFAULT 'warning',
        status alert_status NOT NULL DEFAULT 'active',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        acknowledged_at TIMESTAMP,
        resolved_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS alerts_run_idx ON alerts(run_id);
      CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts(status);
      CREATE INDEX IF NOT EXISTS alerts_severity_idx ON alerts(severity);
    `);

    // 创建报告表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS reports (
        id VARCHAR(36) PRIMARY KEY,
        project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        type report_type NOT NULL,
        title VARCHAR(255) NOT NULL,
        status report_status NOT NULL DEFAULT 'draft',
        sections JSONB NOT NULL DEFAULT '[]',
        latex_source TEXT,
        pdf_path VARCHAR(1024),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        generated_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS reports_project_idx ON reports(project_id);
      CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);
    `);

    // 创建审批表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS approvals (
        id VARCHAR(36) PRIMARY KEY,
        type approval_type NOT NULL,
        target_id VARCHAR(36) NOT NULL,
        requester_id VARCHAR(36) NOT NULL REFERENCES users(id),
        reviewer_id VARCHAR(36) REFERENCES users(id),
        status approval_status NOT NULL DEFAULT 'pending',
        comment TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS approvals_target_idx ON approvals(target_id);
      CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals(status);
      CREATE INDEX IF NOT EXISTS approvals_requester_idx ON approvals(requester_id);
    `);

    // 创建指标时序表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS metric_series (
        id VARCHAR(36) PRIMARY KEY,
        run_id VARCHAR(36) NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        name VARCHAR(127) NOT NULL,
        step INTEGER NOT NULL,
        value JSONB NOT NULL,
        timestamp TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS metric_series_run_name_step_idx ON metric_series(run_id, name, step);
    `);

    logger.info('Database migration completed successfully');
  } catch (error) {
    logger.error('Database migration failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// 直接运行时执行迁移
migrate().catch(console.error);
