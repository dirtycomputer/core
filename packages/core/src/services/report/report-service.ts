/**
 * 报告服务
 * 生成 LaTeX 报告并编译为 PDF
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { reports } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { Report, ReportType, ReportStatus, ReportSection } from '../../models/types';
import type { ExperimentAnalysis } from '../../agents/analysis-agent';
import { plotService, type AutoPlotOptions } from '../plot';

const execAsync = promisify(exec);
const logger = createLogger('service:report');

export interface ReportData {
  title: string;
  projectName: string;
  researchGoal: string;
  methodology?: string;
  experiments: Array<{
    name: string;
    description: string;
    config: Record<string, unknown>;
    results: Record<string, number>;
  }>;
  analysis?: ExperimentAnalysis;
  figures?: Array<{
    path: string;
    caption: string;
  }>;
  tables?: Array<{
    caption: string;
    headers: string[];
    rows: string[][];
  }>;
}

export interface GenerateReportOptions {
  projectId: string;
  type: ReportType;
  data: ReportData;
  outputDir?: string;
  compilePdf?: boolean;
  autoPlot?: AutoPlotOptions & { enabled?: boolean };
}

export class ReportService {
  private db = getDatabase();
  private outputBaseDir: string;

  constructor() {
    this.outputBaseDir = process.env.REPORT_OUTPUT_DIR || join(process.cwd(), 'reports');
  }

  /**
   * 生成报告
   */
  async generate(options: GenerateReportOptions): Promise<Report> {
    const id = generateId();
    const now = new Date();
    const outputDir = options.outputDir || join(this.outputBaseDir, id);

    // 创建输出目录
    await mkdir(outputDir, { recursive: true });

    const autoPlotEnabled = options.autoPlot?.enabled !== false;
    let figureNotes: string[] = [];
    let enrichedData = options.data;

    if (autoPlotEnabled && options.data.experiments.length > 0) {
      const generated = await plotService.generateExperimentFigures(
        options.data.experiments.map((e) => ({
          name: e.name,
          results: e.results,
        })),
        outputDir,
        {
          engine: options.autoPlot?.engine || 'auto',
          charts: options.autoPlot?.charts,
          titlePrefix: options.data.projectName || options.data.title,
        }
      );

      figureNotes = generated.notes;
      enrichedData = {
        ...options.data,
        figures: [...(options.data.figures || []), ...generated.figures],
      };
    }

    if (figureNotes.length > 0) {
      enrichedData = {
        ...enrichedData,
        analysis: enrichedData.analysis
          ? {
              ...enrichedData.analysis,
              limitations: [...(enrichedData.analysis.limitations || []), ...figureNotes],
            }
          : undefined,
      };
    }

    // 生成 LaTeX 源码
    const latexSource = this.generateLatex(enrichedData, options.type);
    const texPath = join(outputDir, 'report.tex');
    await writeFile(texPath, latexSource);

    // 创建报告记录
    const sections = this.extractSections(enrichedData);

    const [result] = await this.db
      .insert(reports)
      .values({
        id,
        projectId: options.projectId,
        type: options.type,
        title: enrichedData.title,
        status: 'draft',
        sections,
        latexSource,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ reportId: id, type: options.type }, 'Report created');

    // 编译 PDF
    if (options.compilePdf !== false) {
      try {
        await this.compilePdf(id, outputDir);
      } catch (error) {
        logger.error({ reportId: id, error }, 'PDF compilation failed');
        await this.updateStatus(id, 'failed');
      }
    }

    return this.mapToReport(result);
  }

  /**
   * 编译 PDF
   */
  async compilePdf(reportId: string, outputDir: string): Promise<string> {
    await this.updateStatus(reportId, 'generating');

    const texPath = join(outputDir, 'report.tex');
    const pdfPath = join(outputDir, 'report.pdf');

    try {
      // 尝试使用 tectonic (更现代的 LaTeX 引擎)
      try {
        await execAsync(`tectonic "${texPath}"`, { cwd: outputDir });
      } catch {
        // 回退到 pdflatex
        await execAsync(`pdflatex -interaction=nonstopmode "${texPath}"`, { cwd: outputDir });
        // 运行两次以解决引用
        await execAsync(`pdflatex -interaction=nonstopmode "${texPath}"`, { cwd: outputDir });
      }

      // 更新报告记录
      await this.db
        .update(reports)
        .set({
          status: 'completed',
          pdfPath,
          generatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reports.id, reportId));

      logger.info({ reportId, pdfPath }, 'PDF compiled successfully');

      return pdfPath;
    } catch (error) {
      logger.error({ reportId, error }, 'PDF compilation failed');
      await this.updateStatus(reportId, 'failed');
      throw error;
    }
  }

  /**
   * 获取报告
   */
  async getById(id: string): Promise<Report | null> {
    const [result] = await this.db
      .select()
      .from(reports)
      .where(eq(reports.id, id))
      .limit(1);

    if (!result) {
      return null;
    }

    return this.mapToReport(result);
  }

  /**
   * 获取项目的所有报告
   */
  async listByProject(projectId: string): Promise<Report[]> {
    const results = await this.db
      .select()
      .from(reports)
      .where(eq(reports.projectId, projectId));

    return results.map((r) => this.mapToReport(r));
  }

  /**
   * 更新报告状态
   */
  async updateStatus(id: string, status: ReportStatus): Promise<void> {
    await this.db
      .update(reports)
      .set({ status, updatedAt: new Date() })
      .where(eq(reports.id, id));
  }

  /**
   * 删除报告
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(reports)
      .where(eq(reports.id, id))
      .returning({ id: reports.id });

    return result.length > 0;
  }

  /**
   * 生成 LaTeX 源码
   */
  private generateLatex(data: ReportData, _type: ReportType): string {
    const sections: string[] = [];

    // 文档头
    sections.push(`\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{CJKutf8}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage[unicode]{hyperref}
\\usepackage{float}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{${this.escapeLatex(data.title)}}
\\author{Research Orchestration Cockpit}
\\date{\\today}

\\begin{document}
\\begin{CJK*}{UTF8}{gbsn}
\\maketitle
`);

    // 摘要
    if (data.analysis?.summary) {
      sections.push(`\\begin{abstract}
${this.escapeLatex(data.analysis.summary)}
\\end{abstract}
`);
    }

    // 引言
    sections.push(`\\section{Introduction}
\\subsection{Research Goal}
${this.escapeLatex(data.researchGoal)}
`);

    // 方法论
    if (data.methodology) {
      sections.push(`\\section{Methodology}
${this.escapeLatex(data.methodology)}
`);
    }

    // 实验设置
    sections.push(`\\section{Experimental Setup}
`);

    for (const exp of data.experiments) {
      sections.push(`\\subsection{${this.escapeLatex(exp.name)}}
${this.escapeLatex(exp.description)}

\\textbf{Configuration:}
\\begin{itemize}
${Object.entries(exp.config)
  .map(([k, v]) => `\\item ${this.escapeLatex(k)}: ${this.escapeLatex(this.formatLatexValue(v))}`)
  .join('\n')}
\\end{itemize}
`);
    }

    // 结果
    sections.push(`\\section{Results}
`);

    // 结果表格
    if (data.experiments.length > 0) {
      const metrics = Object.keys(data.experiments[0].results);
      sections.push(this.generateResultsTable(data.experiments, metrics));
    }

    if (data.tables && data.tables.length > 0) {
      sections.push(`\\subsection{Additional Tables}`);
      for (const table of data.tables) {
        sections.push(this.generateCustomTable(table.caption, table.headers, table.rows));
      }
    }

    // 图表
    if (data.figures && data.figures.length > 0) {
      sections.push(`\\subsection{Figures}
`);
      for (const fig of data.figures) {
        sections.push(`\\begin{figure}[H]
\\centering
\\includegraphics[width=0.8\\textwidth]{${fig.path}}
\\caption{${this.escapeLatex(fig.caption)}}
\\end{figure}
`);
      }
    }

    // 分析
    if (data.analysis) {
      sections.push(`\\section{Analysis}
`);

      if (data.analysis.keyFindings.length > 0) {
        sections.push(`\\subsection{Key Findings}
\\begin{itemize}
${data.analysis.keyFindings.map((f) => `\\item ${this.escapeLatex(f)}`).join('\n')}
\\end{itemize}
`);
      }

      if (data.analysis.insights.length > 0) {
        sections.push(`\\subsection{Insights}
\\begin{itemize}
${data.analysis.insights.map((i) => `\\item ${this.escapeLatex(i)}`).join('\n')}
\\end{itemize}
`);
      }
    }

    // 结论
    if (data.analysis?.recommendations) {
      sections.push(`\\section{Conclusion and Recommendations}
\\begin{itemize}
${data.analysis.recommendations.map((r) => `\\item ${this.escapeLatex(r)}`).join('\n')}
\\end{itemize}
`);
    }

    // 局限性
    if (data.analysis?.limitations && data.analysis.limitations.length > 0) {
      sections.push(`\\section{Limitations}
\\begin{itemize}
${data.analysis.limitations.map((l) => `\\item ${this.escapeLatex(l)}`).join('\n')}
\\end{itemize}
`);
    }

    // 文档尾
    sections.push(`\\end{CJK*}
\\end{document}`);

    return sections.join('\n');
  }

  /**
   * 生成结果表格
   */
  private generateResultsTable(
    experiments: Array<{ name: string; results: Record<string, number> }>,
    metrics: string[]
  ): string {
    const colSpec = 'l' + 'r'.repeat(metrics.length);
    const headers = ['Experiment', ...metrics].map((h) => this.escapeLatex(h)).join(' & ');

    const rows = experiments.map((exp) => {
      const values = metrics.map((m) => {
        const val = exp.results[m];
        return val !== undefined ? val.toFixed(4) : '-';
      });
      return [this.escapeLatex(exp.name), ...values].join(' & ');
    });

    return `\\begin{table}[H]
\\centering
\\caption{Experimental Results}
\\begin{tabular}{${colSpec}}
\\toprule
${headers} \\\\
\\midrule
${rows.join(' \\\\\n')} \\\\
\\bottomrule
\\end{tabular}
\\end{table}
`;
  }

  private generateCustomTable(caption: string, headers: string[], rows: string[][]): string {
    const colSpec = 'l'.repeat(Math.max(headers.length, 1));
    const safeHeaders = headers.map((h) => this.escapeLatex(h)).join(' & ');
    const safeRows = rows.map((row) => row.map((cell) => this.escapeLatex(cell)).join(' & '));

    return `\\begin{table}[H]
\\centering
\\caption{${this.escapeLatex(caption)}}
\\begin{tabular}{${colSpec}}
\\toprule
${safeHeaders} \\\\
\\midrule
${safeRows.join(' \\\\\n')} \\\\
\\bottomrule
\\end{tabular}
\\end{table}
`;
  }

  private formatLatexValue(value: unknown): string {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /**
   * 转义 LaTeX 特殊字符
   */
  private escapeLatex(text: string): string {
    return text
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/[&%$#_{}]/g, '\\$&')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}');
  }

  /**
   * 提取报告章节
   */
  private extractSections(data: ReportData): ReportSection[] {
    const sections: ReportSection[] = [];

    sections.push({
      title: 'Introduction',
      content: data.researchGoal,
    });

    if (data.methodology) {
      sections.push({
        title: 'Methodology',
        content: data.methodology,
      });
    }

    if (data.analysis) {
      sections.push({
        title: 'Analysis',
        content: data.analysis.summary,
      });
    }

    return sections;
  }

  /**
   * 映射数据库结果到 Report 类型
   */
  private mapToReport(row: typeof reports.$inferSelect): Report {
    return {
      id: row.id,
      projectId: row.projectId,
      type: row.type as ReportType,
      title: row.title,
      status: row.status as ReportStatus,
      sections: row.sections as ReportSection[],
      latexSource: row.latexSource || undefined,
      pdfPath: row.pdfPath || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      generatedAt: row.generatedAt || undefined,
    };
  }
}

// 单例导出
export const reportService = new ReportService();
