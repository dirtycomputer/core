import axios from 'axios';
import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { getDatabase } from '../../db/connection';
import { datasets, datasetVersions } from '../../models/schema';
import { getConfig } from '../../utils/config';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { DatasetRecord, DatasetStatus, DatasetVersion } from '../../models/types';

const logger = createLogger('service:dataset');

export interface DatasetSearchResult {
  name: string;
  source: string;
  description: string;
  license?: string;
  homepage?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateDatasetInput {
  projectId?: string;
  name: string;
  source?: string;
  description?: string;
  license?: string;
  homepage?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  status?: DatasetStatus;
}

export interface UpdateDatasetInput {
  name?: string;
  source?: string;
  description?: string;
  license?: string;
  homepage?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  status?: DatasetStatus;
}

export interface ConstructDatasetInput {
  version: string;
  splitInfo?: Record<string, unknown>;
  buildRecipe?: Record<string, unknown>;
  syntheticRows?: Array<Record<string, unknown>>;
}

export class DatasetService {
  private db = getDatabase();

  async search(query: string, maxResults = 10): Promise<DatasetSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    // 1) HuggingFace 数据集检索
    try {
      const response = await axios.get('https://huggingface.co/api/datasets', {
        params: {
          search: normalized,
          limit: Math.max(1, Math.min(maxResults, 50)),
        },
        timeout: 15000,
      });

      const items = Array.isArray(response.data) ? response.data : [];
      const results = items.map((item: any) => ({
        name: item?.id || 'unknown',
        source: 'huggingface',
        description: item?.cardData?.dataset_info?.description || item?.description || 'No description',
        license: item?.cardData?.license || item?.cardData?.dataset_info?.license,
        homepage: item?.cardData?.homepage || `https://huggingface.co/datasets/${item?.id}`,
        tags: Array.isArray(item?.tags) ? item.tags.slice(0, 8) : [],
        metadata: {
          likes: item?.likes || 0,
          downloads: item?.downloads || 0,
          gated: !!item?.gated,
        },
      }));

      if (results.length > 0) {
        return results.slice(0, maxResults);
      }
    } catch (error) {
      logger.warn({ error, query: normalized }, 'HuggingFace dataset search failed');
    }

    // 2) Tavily 兜底检索
    const tavilyApiKey = getConfig().llm.tavilyApiKey || process.env.TAVILY_API_KEY;
    if (tavilyApiKey) {
      try {
        const response = await axios.post(
          'https://api.tavily.com/search',
          {
            api_key: tavilyApiKey,
            query: `${normalized} machine learning dataset`,
            max_results: Math.max(1, Math.min(maxResults, 20)),
          },
          { timeout: 15000 }
        );

        const results = Array.isArray(response.data?.results) ? response.data.results : [];
        return results.slice(0, maxResults).map((item: any) => ({
          name: item?.title || item?.url || 'unknown',
          source: 'tavily',
          description: item?.content || 'No description',
          homepage: item?.url,
          tags: ['web-search'],
          metadata: { score: item?.score },
        }));
      } catch (error) {
        logger.warn({ error, query: normalized }, 'Tavily dataset search failed');
      }
    }

    return [
      {
        name: `${normalized}-candidate-dataset`,
        source: 'fallback',
        description: 'No online source available. This is a placeholder candidate for manual curation.',
        tags: ['manual'],
      },
    ];
  }

  async create(input: CreateDatasetInput): Promise<DatasetRecord> {
    const now = new Date();
    const id = generateId();

    const [row] = await this.db
      .insert(datasets)
      .values({
        id,
        projectId: input.projectId || null,
        name: input.name,
        source: input.source || '',
        description: input.description || '',
        license: input.license || '',
        homepage: input.homepage || null,
        tags: input.tags || [],
        metadata: input.metadata || {},
        status: input.status || 'discovered',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ datasetId: id, name: input.name }, 'Dataset record created');
    return this.mapDataset(row);
  }

  async list(projectId?: string): Promise<DatasetRecord[]> {
    const rows = projectId
      ? await this.db
          .select()
          .from(datasets)
          .where(eq(datasets.projectId, projectId))
          .orderBy(desc(datasets.updatedAt))
      : await this.db.select().from(datasets).orderBy(desc(datasets.updatedAt));

    return rows.map((row) => this.mapDataset(row));
  }

  async getById(id: string): Promise<DatasetRecord | null> {
    const [row] = await this.db.select().from(datasets).where(eq(datasets.id, id)).limit(1);
    return row ? this.mapDataset(row) : null;
  }

  async update(id: string, input: UpdateDatasetInput): Promise<DatasetRecord | null> {
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) patch.name = input.name;
    if (input.source !== undefined) patch.source = input.source;
    if (input.description !== undefined) patch.description = input.description;
    if (input.license !== undefined) patch.license = input.license;
    if (input.homepage !== undefined) patch.homepage = input.homepage;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.metadata !== undefined) patch.metadata = input.metadata;
    if (input.status !== undefined) patch.status = input.status;

    const [row] = await this.db.update(datasets).set(patch).where(eq(datasets.id, id)).returning();
    return row ? this.mapDataset(row) : null;
  }

  async listVersions(datasetId: string): Promise<DatasetVersion[]> {
    const rows = await this.db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, datasetId))
      .orderBy(desc(datasetVersions.createdAt));

    return rows.map((row) => this.mapDatasetVersion(row));
  }

  async construct(datasetId: string, input: ConstructDatasetInput): Promise<DatasetVersion> {
    const dataset = await this.getById(datasetId);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    const config = getConfig();
    const now = new Date();
    const versionId = generateId();
    const basePath = join(config.storage.basePath, 'datasets', datasetId, input.version);

    await mkdir(basePath, { recursive: true });

    const manifest = {
      datasetId,
      datasetName: dataset.name,
      version: input.version,
      splitInfo: input.splitInfo || {},
      buildRecipe: input.buildRecipe || {},
      builtAt: now.toISOString(),
    };

    const manifestPath = join(basePath, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    let samplePath: string | undefined;
    if (input.syntheticRows && input.syntheticRows.length > 0) {
      const headers = Array.from(new Set(input.syntheticRows.flatMap((row) => Object.keys(row))));
      const csvRows = [headers.join(',')];
      for (const row of input.syntheticRows) {
        const values = headers.map((h) => JSON.stringify(row[h] ?? ''));
        csvRows.push(values.join(','));
      }
      samplePath = join(basePath, 'synthetic_sample.csv');
      await writeFile(samplePath, csvRows.join('\n'), 'utf-8');
    }

    const checksum = createHash('sha256')
      .update(JSON.stringify(manifest))
      .update(samplePath || '')
      .digest('hex');

    const stats = await stat(manifestPath);
    const sampleSize = samplePath ? (await stat(samplePath)).size : 0;

    const [row] = await this.db
      .insert(datasetVersions)
      .values({
        id: versionId,
        datasetId,
        version: input.version,
        splitInfo: input.splitInfo || {},
        filePath: basePath,
        checksum,
        sizeBytes: stats.size + sampleSize,
        buildRecipe: input.buildRecipe || {},
        createdAt: now,
      })
      .returning();

    await this.update(datasetId, { status: 'ready' });

    logger.info({ datasetId, version: input.version, path: basePath }, 'Dataset construct completed');
    return this.mapDatasetVersion(row);
  }

  async findByName(projectId: string | undefined, name: string): Promise<DatasetRecord | null> {
    const condition = projectId
      ? and(eq(datasets.projectId, projectId), eq(datasets.name, name))
      : eq(datasets.name, name);

    const [row] = await this.db.select().from(datasets).where(condition).limit(1);
    return row ? this.mapDataset(row) : null;
  }

  private mapDataset(row: typeof datasets.$inferSelect): DatasetRecord {
    return {
      id: row.id,
      projectId: row.projectId || undefined,
      name: row.name,
      source: row.source,
      description: row.description,
      license: row.license,
      homepage: row.homepage || undefined,
      tags: (row.tags || []) as string[],
      metadata: (row.metadata || {}) as Record<string, unknown>,
      status: row.status as DatasetStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDatasetVersion(row: typeof datasetVersions.$inferSelect): DatasetVersion {
    return {
      id: row.id,
      datasetId: row.datasetId,
      version: row.version,
      splitInfo: (row.splitInfo || {}) as Record<string, unknown>,
      filePath: row.filePath || undefined,
      checksum: row.checksum || undefined,
      sizeBytes: row.sizeBytes,
      buildRecipe: (row.buildRecipe || {}) as Record<string, unknown>,
      createdAt: row.createdAt,
    };
  }
}

export const datasetService = new DatasetService();
