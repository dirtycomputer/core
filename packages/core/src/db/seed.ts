/**
 * 数据库种子数据
 */

import { getDatabase, closeDatabase } from './connection';
import { users, projects, experimentGroups, experiments } from '../models/schema';
import { generateId } from '../utils/id';
import { createLogger } from '../utils/logger';

const logger = createLogger('db:seed');

async function seed() {
  logger.info('Seeding database...');

  const db = getDatabase();

  try {
    // 创建默认用户
    const userId = generateId();
    await db.insert(users).values({
      id: userId,
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      createdAt: new Date(),
    }).onConflictDoNothing();

    logger.info({ userId }, 'Default user created');

    // 创建示例项目
    const projectId = generateId();
    await db.insert(projects).values({
      id: projectId,
      name: '示例项目 - LLM 微调优化',
      description: '探索不同的微调策略以提升 LLM 在特定任务上的表现',
      researchGoal: '通过对比不同的微调方法（LoRA、QLoRA、Full Fine-tuning），找到在有限计算资源下最优的微调策略，目标是在保持模型泛化能力的同时，提升特定任务的准确率至少 10%。',
      constraints: {
        budget: 100,
        maxConcurrentRuns: 4,
        resources: ['A100-40G', 'A100-80G'],
      },
      baselineMetrics: {
        accuracy: 0.72,
        f1Score: 0.68,
      },
      status: 'active',
      tags: ['LLM', '微调', 'LoRA'],
      ownerId: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    logger.info({ projectId }, 'Sample project created');

    // 创建示例实验组
    const baselineGroupId = generateId();
    await db.insert(experimentGroups).values({
      id: baselineGroupId,
      projectId,
      name: '基线实验',
      type: 'baseline',
      hypothesis: '使用原始预训练模型作为基线，评估在目标任务上的零样本和少样本表现',
      expectedImpact: '建立性能基准',
      verificationMethod: '在测试集上评估准确率、F1 分数等指标',
      status: 'completed',
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    const loraGroupId = generateId();
    await db.insert(experimentGroups).values({
      id: loraGroupId,
      projectId,
      name: 'LoRA 微调实验',
      type: 'improvement',
      hypothesis: 'LoRA 微调可以在保持参数效率的同时显著提升模型在目标任务上的表现',
      expectedImpact: '准确率提升 5-15%',
      verificationMethod: '对比不同 rank 值和学习率的组合',
      status: 'approved',
      priority: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    logger.info('Sample experiment groups created');

    // 创建示例实验
    await db.insert(experiments).values([
      {
        id: generateId(),
        groupId: loraGroupId,
        name: 'LoRA r=8 lr=1e-4',
        description: 'LoRA 微调，rank=8，学习率 1e-4',
        config: {
          model: { name: 'llama-2-7b', architecture: 'transformer' },
          data: { dataset: 'custom-task-v1', trainSplit: 'train', valSplit: 'val' },
          training: { epochs: 3, batchSize: 8, learningRate: 0.0001, optimizer: 'adamw' },
          resources: { gpuType: 'A100-40G', gpuCount: 1, memoryGb: 40, timeLimit: '4:00:00' },
        },
        variables: { loraRank: 8, loraAlpha: 16 },
        controlVariables: { model: 'llama-2-7b', dataset: 'custom-task-v1' },
        status: 'pending',
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: generateId(),
        groupId: loraGroupId,
        name: 'LoRA r=16 lr=1e-4',
        description: 'LoRA 微调，rank=16，学习率 1e-4',
        config: {
          model: { name: 'llama-2-7b', architecture: 'transformer' },
          data: { dataset: 'custom-task-v1', trainSplit: 'train', valSplit: 'val' },
          training: { epochs: 3, batchSize: 8, learningRate: 0.0001, optimizer: 'adamw' },
          resources: { gpuType: 'A100-40G', gpuCount: 1, memoryGb: 40, timeLimit: '4:00:00' },
        },
        variables: { loraRank: 16, loraAlpha: 32 },
        controlVariables: { model: 'llama-2-7b', dataset: 'custom-task-v1' },
        status: 'pending',
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: generateId(),
        groupId: loraGroupId,
        name: 'LoRA r=32 lr=5e-5',
        description: 'LoRA 微调，rank=32，学习率 5e-5',
        config: {
          model: { name: 'llama-2-7b', architecture: 'transformer' },
          data: { dataset: 'custom-task-v1', trainSplit: 'train', valSplit: 'val' },
          training: { epochs: 3, batchSize: 8, learningRate: 0.00005, optimizer: 'adamw' },
          resources: { gpuType: 'A100-40G', gpuCount: 1, memoryGb: 40, timeLimit: '4:00:00' },
        },
        variables: { loraRank: 32, loraAlpha: 64 },
        controlVariables: { model: 'llama-2-7b', dataset: 'custom-task-v1' },
        status: 'pending',
        priority: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]).onConflictDoNothing();

    logger.info('Sample experiments created');

    logger.info('Database seeding completed successfully');
  } catch (error) {
    logger.error('Database seeding failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

// 直接运行时执行种子
seed().catch(console.error);
