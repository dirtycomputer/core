import axios from 'axios';
import OpenAI from 'openai';
import { and, desc, eq } from 'drizzle-orm';
import { mkdir, writeFile, stat } from 'fs/promises';
import { join } from 'path';
import { getDatabase } from '../../db/connection';
import { papers } from '../../models/schema';
import { getConfig } from '../../utils/config';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { PaperRecord, PaperStatus } from '../../models/types';

const logger = createLogger('service:reading');

export interface PaperSearchResult {
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  url?: string;
  pdfUrl?: string;
  abstract?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePaperInput {
  projectId?: string;
  title: string;
  authors?: string[];
  venue?: string;
  year?: number;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  abstract?: string;
  tags?: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
  status?: PaperStatus;
}

export interface UpdatePaperInput {
  title?: string;
  authors?: string[];
  venue?: string | null;
  year?: number | null;
  doi?: string | null;
  url?: string | null;
  pdfUrl?: string | null;
  abstract?: string | null;
  tags?: string[];
  notes?: string | null;
  status?: PaperStatus;
  localPdfPath?: string | null;
  metadata?: Record<string, unknown>;
}

export class ReadingService {
  private db = getDatabase();

  async search(query: string, maxResults = 10): Promise<PaperSearchResult[]> {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    try {
      const response = await axios.get('https://api.semanticscholar.org/graph/v1/paper/search', {
        params: {
          query: normalized,
          limit: Math.max(1, Math.min(maxResults, 20)),
          fields: 'title,authors,year,venue,url,abstract,openAccessPdf,citationCount',
        },
        timeout: 15000,
      });

      const rows = Array.isArray(response.data?.data) ? response.data.data : [];
      const mapped = rows.map((row: any) => ({
        title: row?.title || 'Untitled',
        authors: Array.isArray(row?.authors) ? row.authors.map((a: any) => a?.name).filter(Boolean) : [],
        venue: row?.venue,
        year: row?.year,
        url: row?.url,
        pdfUrl: row?.openAccessPdf?.url,
        abstract: row?.abstract,
        metadata: {
          source: 'semantic-scholar',
          citationCount: row?.citationCount || 0,
        },
      }));

      if (mapped.length > 0) {
        return mapped;
      }
    } catch (error) {
      logger.warn({ error, query: normalized }, 'Semantic Scholar search failed');
    }

    // 兜底：arXiv
    try {
      const response = await axios.get('http://export.arxiv.org/api/query', {
        params: {
          search_query: `all:${normalized}`,
          start: 0,
          max_results: Math.max(1, Math.min(maxResults, 20)),
        },
        timeout: 15000,
      });

      const xml = typeof response.data === 'string' ? response.data : '';
      const entries = xml.split('<entry>').slice(1).map((item) => item.split('</entry>')[0]);

      const extracted: PaperSearchResult[] = entries.map((entry) => {
        const title = this.pickXml(entry, 'title')?.replace(/\s+/g, ' ').trim() || 'Untitled';
        const summary = this.pickXml(entry, 'summary')?.replace(/\s+/g, ' ').trim();
        const idUrl = this.pickXml(entry, 'id');
        const year = Number((this.pickXml(entry, 'published') || '').slice(0, 4)) || undefined;
        const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1].trim());
        const pdfMatch = entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);

        return {
          title,
          authors,
          year,
          venue: 'arXiv',
          url: idUrl,
          pdfUrl: pdfMatch?.[1] || (idUrl ? `${idUrl}.pdf` : undefined),
          abstract: summary,
          metadata: {
            source: 'arxiv',
          },
        };
      });

      if (extracted.length > 0) {
        return extracted.slice(0, maxResults);
      }
    } catch (error) {
      logger.warn({ error, query: normalized }, 'arXiv search failed');
    }

    return [
      {
        title: `${normalized}: manual candidate`,
        authors: [],
        abstract: 'No online source available. Please fill metadata manually.',
        metadata: { source: 'fallback' },
      },
    ];
  }

  async create(input: CreatePaperInput): Promise<PaperRecord> {
    const id = generateId();
    const now = new Date();

    const [row] = await this.db
      .insert(papers)
      .values({
        id,
        projectId: input.projectId || null,
        title: input.title,
        authors: input.authors || [],
        venue: input.venue || null,
        year: input.year || null,
        doi: input.doi || null,
        url: input.url || null,
        pdfUrl: input.pdfUrl || null,
        localPdfPath: null,
        abstract: input.abstract || null,
        tags: input.tags || [],
        notes: input.notes || null,
        status: input.status || 'discovered',
        metadata: input.metadata || {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ paperId: id, title: input.title }, 'Paper record created');
    return this.mapPaper(row);
  }

  async list(projectId?: string): Promise<PaperRecord[]> {
    const rows = projectId
      ? await this.db
          .select()
          .from(papers)
          .where(eq(papers.projectId, projectId))
          .orderBy(desc(papers.updatedAt))
      : await this.db.select().from(papers).orderBy(desc(papers.updatedAt));

    return rows.map((row) => this.mapPaper(row));
  }

  async getById(id: string): Promise<PaperRecord | null> {
    const [row] = await this.db.select().from(papers).where(eq(papers.id, id)).limit(1);
    return row ? this.mapPaper(row) : null;
  }

  async update(id: string, input: UpdatePaperInput): Promise<PaperRecord | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (input.title !== undefined) patch.title = input.title;
    if (input.authors !== undefined) patch.authors = input.authors;
    if (input.venue !== undefined) patch.venue = input.venue;
    if (input.year !== undefined) patch.year = input.year;
    if (input.doi !== undefined) patch.doi = input.doi;
    if (input.url !== undefined) patch.url = input.url;
    if (input.pdfUrl !== undefined) patch.pdfUrl = input.pdfUrl;
    if (input.abstract !== undefined) patch.abstract = input.abstract;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined) patch.status = input.status;
    if (input.localPdfPath !== undefined) patch.localPdfPath = input.localPdfPath;
    if (input.metadata !== undefined) patch.metadata = input.metadata;

    const [row] = await this.db.update(papers).set(patch).where(eq(papers.id, id)).returning();
    return row ? this.mapPaper(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db.delete(papers).where(eq(papers.id, id)).returning({ id: papers.id });
    return deleted.length > 0;
  }

  async findByTitle(projectId: string | undefined, title: string): Promise<PaperRecord | null> {
    const where = projectId
      ? and(eq(papers.projectId, projectId), eq(papers.title, title))
      : eq(papers.title, title);

    const [row] = await this.db.select().from(papers).where(where).limit(1);
    return row ? this.mapPaper(row) : null;
  }

  async downloadPdf(paperId: string): Promise<PaperRecord> {
    const paper = await this.getById(paperId);
    if (!paper) {
      throw new Error('Paper not found');
    }

    const pdfUrl = paper.pdfUrl || paper.url;
    if (!pdfUrl) {
      throw new Error('No PDF URL available');
    }

    const config = getConfig();
    const dir = join(config.storage.basePath, 'papers');
    const targetPath = join(dir, `${paper.id}.pdf`);

    await mkdir(dir, { recursive: true });

    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        Accept: 'application/pdf,*/*',
      },
    });

    const bytes = Buffer.from(response.data as ArrayBuffer);
    if (bytes.length === 0) {
      throw new Error('Downloaded PDF is empty');
    }

    await writeFile(targetPath, bytes);
    const meta = await stat(targetPath);

    const updated = await this.update(paperId, {
      status: 'downloaded',
      localPdfPath: targetPath,
      metadata: {
        ...(paper.metadata || {}),
        pdfSizeBytes: meta.size,
        downloadedAt: new Date().toISOString(),
      },
    });

    if (!updated) {
      throw new Error('Failed to update paper after download');
    }

    logger.info({ paperId, targetPath }, 'Paper PDF downloaded');
    return updated;
  }

  async summarize(paperId: string): Promise<string> {
    const paper = await this.getById(paperId);
    if (!paper) {
      throw new Error('Paper not found');
    }

    const baseText = [
      `Title: ${paper.title}`,
      `Authors: ${paper.authors.join(', ')}`,
      paper.abstract ? `Abstract: ${paper.abstract}` : '',
      paper.notes ? `Notes: ${paper.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!baseText.trim()) {
      return 'No content available for summarization.';
    }

    const config = getConfig();
    if (!config.llm.apiKey) {
      return `Summary (fallback): ${paper.title} (${paper.year || 'N/A'}) by ${paper.authors.join(', ') || 'Unknown authors'}.`;
    }

    const client = new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl || undefined });
    const completion = await client.chat.completions.create({
      model: config.llm.model,
      max_tokens: 500,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are a research reading assistant. Produce concise Chinese summary with: problem, method, results, limitations, actionable takeaways.',
        },
        {
          role: 'user',
          content: baseText,
        },
      ],
    });

    const content: unknown = completion.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('\n');
    }
    return 'No summary generated.';
  }

  private pickXml(segment: string, tag: string): string | undefined {
    const match = segment.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return match?.[1];
  }

  private mapPaper(row: typeof papers.$inferSelect): PaperRecord {
    return {
      id: row.id,
      projectId: row.projectId || undefined,
      title: row.title,
      authors: (row.authors || []) as string[],
      venue: row.venue || undefined,
      year: row.year || undefined,
      doi: row.doi || undefined,
      url: row.url || undefined,
      pdfUrl: row.pdfUrl || undefined,
      localPdfPath: row.localPdfPath || undefined,
      abstract: row.abstract || undefined,
      tags: (row.tags || []) as string[],
      notes: row.notes || undefined,
      status: row.status as PaperStatus,
      metadata: (row.metadata || {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const readingService = new ReadingService();
