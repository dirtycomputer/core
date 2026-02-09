import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { createLogger } from '../../utils/logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('service:plot');

export type PlotEngine = 'auto' | 'matplotlib' | 'seaborn' | 'echarts' | 'r' | 'pdfkit';
export type PlotChartType = 'accuracy_bar' | 'loss_bar' | 'accuracy_loss_scatter';

export interface PlotExperimentItem {
  name: string;
  results: Record<string, number>;
}

export interface AutoPlotOptions {
  engine?: PlotEngine;
  charts?: PlotChartType[];
  titlePrefix?: string;
}

export interface GeneratedFigure {
  path: string;
  caption: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateFigureResult {
  figures: GeneratedFigure[];
  notes: string[];
}

export class PlotService {
  async generateExperimentFigures(
    experiments: PlotExperimentItem[],
    outputDir: string,
    options: AutoPlotOptions = {}
  ): Promise<GenerateFigureResult> {
    const engine = options.engine || 'auto';
    const charts: PlotChartType[] = options.charts && options.charts.length > 0
      ? options.charts
      : (['accuracy_bar', 'loss_bar', 'accuracy_loss_scatter'] as PlotChartType[]);

    const figures: GeneratedFigure[] = [];
    const notes: string[] = [];

    if (experiments.length === 0) {
      return { figures, notes: ['No experiments provided for plotting'] };
    }

    for (const chart of charts) {
      const payload = this.buildChartPayload(chart, experiments);
      if (!payload) {
        notes.push(`Skipped ${chart}: required metrics not found`);
        continue;
      }

      const fileName = `fig-${chart.replace(/_/g, '-')}.pdf`;
      const absolutePath = join(outputDir, fileName);

      const render = await this.renderChart({
        engine,
        chart,
        payload,
        absolutePath,
        titlePrefix: options.titlePrefix,
      });

      if (!render.success) {
        notes.push(render.note || `Failed to render ${chart}`);
        continue;
      }

      if (render.note) {
        notes.push(render.note);
      }

      figures.push({
        path: fileName,
        caption: this.getCaption(chart),
        metadata: {
          chart,
          engineRequested: engine,
          engineUsed: render.engineUsed,
        },
      });
    }

    return { figures, notes };
  }

  private buildChartPayload(chart: PlotChartType, experiments: PlotExperimentItem[]): {
    labels: string[];
    x?: number[];
    y?: number[];
    series?: number[];
  } | null {
    const labels = experiments.map((e) => e.name);

    if (chart === 'accuracy_bar') {
      const series = experiments.map((e) => this.pickMetric(e.results, ['accuracy', 'acc', 'f1Score']) ?? NaN);
      if (series.every((v) => Number.isNaN(v))) return null;
      return { labels, series: series.map((v) => Number.isNaN(v) ? 0 : v) };
    }

    if (chart === 'loss_bar') {
      const series = experiments.map((e) => this.pickMetric(e.results, ['loss', 'valLoss', 'testLoss']) ?? NaN);
      if (series.every((v) => Number.isNaN(v))) return null;
      return { labels, series: series.map((v) => Number.isNaN(v) ? 0 : v) };
    }

    const x = experiments.map((e) => this.pickMetric(e.results, ['loss', 'valLoss', 'testLoss']) ?? NaN);
    const y = experiments.map((e) => this.pickMetric(e.results, ['accuracy', 'acc', 'f1Score']) ?? NaN);
    if (x.every((v) => Number.isNaN(v)) || y.every((v) => Number.isNaN(v))) return null;

    return {
      labels,
      x: x.map((v) => Number.isNaN(v) ? 0 : v),
      y: y.map((v) => Number.isNaN(v) ? 0 : v),
    };
  }

  private async renderChart(input: {
    engine: PlotEngine;
    chart: PlotChartType;
    payload: { labels: string[]; x?: number[]; y?: number[]; series?: number[] };
    absolutePath: string;
    titlePrefix?: string;
  }): Promise<{ success: boolean; engineUsed: PlotEngine; note?: string }> {
    const ordered = this.resolveEngineOrder(input.engine);

    for (const candidate of ordered) {
      try {
        if (candidate === 'matplotlib' || candidate === 'seaborn') {
          const ok = await this.renderWithPython(candidate, input.chart, input.payload, input.absolutePath, input.titlePrefix);
          if (ok) {
            return { success: true, engineUsed: candidate };
          }
        } else if (candidate === 'r') {
          const ok = await this.renderWithR(input.chart, input.payload, input.absolutePath, input.titlePrefix);
          if (ok) {
            return { success: true, engineUsed: candidate };
          }
        } else if (candidate === 'echarts') {
          const optionPath = input.absolutePath.replace(/\.pdf$/i, '.echarts.json');
          await this.writeEchartsOption(optionPath, input.chart, input.payload, input.titlePrefix);
          await this.renderWithPdfKit(input.chart, input.payload, input.absolutePath, input.titlePrefix);
          return {
            success: true,
            engineUsed: 'pdfkit',
            note: `ECharts runtime renderer unavailable on server; generated ${optionPath} and fallback PDF figure`,
          };
        } else {
          await this.renderWithPdfKit(input.chart, input.payload, input.absolutePath, input.titlePrefix);
          return { success: true, engineUsed: 'pdfkit' };
        }
      } catch (error) {
        logger.warn({ error, candidate, chart: input.chart }, 'Plot render attempt failed');
      }
    }

    return {
      success: false,
      engineUsed: 'pdfkit',
      note: `All plot engines failed for ${input.chart}`,
    };
  }

  private resolveEngineOrder(engine: PlotEngine): PlotEngine[] {
    if (engine === 'auto') {
      return ['matplotlib', 'seaborn', 'r', 'echarts', 'pdfkit'];
    }
    if (engine === 'matplotlib') {
      return ['matplotlib', 'seaborn', 'pdfkit'];
    }
    if (engine === 'seaborn') {
      return ['seaborn', 'matplotlib', 'pdfkit'];
    }
    if (engine === 'r') {
      return ['r', 'pdfkit'];
    }
    if (engine === 'echarts') {
      return ['echarts', 'pdfkit'];
    }
    return ['pdfkit'];
  }

  private async renderWithPython(
    engine: 'matplotlib' | 'seaborn',
    chart: PlotChartType,
    payload: { labels: string[]; x?: number[]; y?: number[]; series?: number[] },
    outputPath: string,
    titlePrefix?: string
  ): Promise<boolean> {
    const pyScript = `
import json
import sys

engine = sys.argv[1]
chart = sys.argv[2]
out = sys.argv[3]
title_prefix = sys.argv[4]
payload = json.loads(sys.argv[5])

if engine == "seaborn":
    import seaborn as sns
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.figure(figsize=(8, 4.5))
title = (title_prefix + " - " if title_prefix else "") + chart

if chart in ["accuracy_bar", "loss_bar"]:
    labels = payload.get('labels', [])
    values = payload.get('series', [])
    color = '#2f80ed' if chart == "accuracy_bar" else '#eb5757'
    plt.bar(range(len(labels)), values, color=color)
    plt.xticks(range(len(labels)), labels, rotation=30, ha='right')
    plt.ylabel('value')
    plt.tight_layout()
elif chart == "accuracy_loss_scatter":
    x = payload.get('x', [])
    y = payload.get('y', [])
    labels = payload.get('labels', [])
    plt.scatter(x, y, c='#2f80ed')
    for i, label in enumerate(labels):
        if i < len(x) and i < len(y):
            plt.annotate(label, (x[i], y[i]), fontsize=8)
    plt.xlabel('loss')
    plt.ylabel('accuracy')
    plt.tight_layout()

plt.title(title)
plt.savefig(out, format='pdf')
plt.close()
`;

    await execFileAsync('python3', [
      '-c',
      pyScript,
      engine,
      chart,
      outputPath,
      titlePrefix || '',
      JSON.stringify(payload),
    ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });

    return true;
  }

  private async renderWithR(
    chart: PlotChartType,
    payload: { labels: string[]; x?: number[]; y?: number[]; series?: number[] },
    outputPath: string,
    titlePrefix?: string
  ): Promise<boolean> {
    const rScript = `
args <- commandArgs(trailingOnly=TRUE)
chart <- args[[1]]
out <- args[[2]]
title_prefix <- args[[3]]
payload_json <- args[[4]]

if (!requireNamespace("jsonlite", quietly = TRUE)) stop("jsonlite not installed")
if (!requireNamespace("ggplot2", quietly = TRUE)) stop("ggplot2 not installed")

library(jsonlite)
library(ggplot2)

payload <- fromJSON(payload_json)
title <- ifelse(nchar(title_prefix) > 0, paste(title_prefix, chart, sep=" - "), chart)

pdf(out, width=8, height=4.5)

if (chart == "accuracy_bar" || chart == "loss_bar") {
  df <- data.frame(label=payload$labels, value=payload$series)
  p <- ggplot(df, aes(x=label, y=value)) +
    geom_col(fill=ifelse(chart == "accuracy_bar", "#2f80ed", "#eb5757")) +
    theme_minimal() +
    theme(axis.text.x = element_text(angle = 30, hjust = 1)) +
    ggtitle(title)
  print(p)
} else {
  df <- data.frame(label=payload$labels, loss=payload$x, accuracy=payload$y)
  p <- ggplot(df, aes(x=loss, y=accuracy, label=label)) +
    geom_point(color="#2f80ed") +
    geom_text(vjust=-0.4, size=3) +
    theme_minimal() +
    ggtitle(title)
  print(p)
}

dev.off()
`;

    await execFileAsync('Rscript', [
      '-e',
      rScript,
      chart,
      outputPath,
      titlePrefix || '',
      JSON.stringify(payload),
    ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });

    return true;
  }

  private async writeEchartsOption(
    optionPath: string,
    chart: PlotChartType,
    payload: { labels: string[]; x?: number[]; y?: number[]; series?: number[] },
    titlePrefix?: string
  ): Promise<void> {
    const title = `${titlePrefix ? `${titlePrefix} - ` : ''}${chart}`;
    let option: Record<string, unknown>;

    if (chart === 'accuracy_loss_scatter') {
      option = {
        title: { text: title },
        xAxis: { type: 'value', name: 'loss' },
        yAxis: { type: 'value', name: 'accuracy' },
        series: [
          {
            type: 'scatter',
            data: (payload.x || []).map((x, i) => [x, payload.y?.[i] ?? 0, payload.labels?.[i] || `p${i}`]),
            label: { show: true, formatter: (params: any) => params.value[2] },
          },
        ],
      };
    } else {
      option = {
        title: { text: title },
        xAxis: { type: 'category', data: payload.labels },
        yAxis: { type: 'value' },
        series: [
          {
            type: 'bar',
            data: payload.series || [],
          },
        ],
      };
    }

    await writeFile(optionPath, JSON.stringify(option, null, 2), 'utf-8');
  }

  private async renderWithPdfKit(
    chart: PlotChartType,
    payload: { labels: string[]; x?: number[]; y?: number[]; series?: number[] },
    outputPath: string,
    titlePrefix?: string
  ): Promise<void> {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = doc.pipe(require('fs').createWriteStream(outputPath));

    const title = `${titlePrefix ? `${titlePrefix} - ` : ''}${this.getCaption(chart)}`;

    doc.fontSize(16).text(title, 50, 40);

    if (chart === 'accuracy_loss_scatter') {
      this.drawScatter(doc, payload, {
        x: 70,
        y: 100,
        width: 470,
        height: 280,
      });
    } else {
      this.drawBar(doc, payload, {
        x: 70,
        y: 100,
        width: 470,
        height: 280,
      }, chart === 'accuracy_bar' ? '#2f80ed' : '#eb5757');
    }

    doc.fontSize(9).fillColor('#666').text('Generated by ROC plotting service', 50, 410);
    doc.end();

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', (error: Error) => reject(error));
    });
  }

  private drawBar(
    doc: PDFKit.PDFDocument,
    payload: { labels: string[]; series?: number[] },
    bounds: { x: number; y: number; width: number; height: number },
    color: string
  ) {
    const labels = payload.labels || [];
    const values = payload.series || [];
    const maxValue = Math.max(...values, 1);
    const barWidth = labels.length > 0 ? bounds.width / (labels.length * 1.6) : bounds.width;

    doc.save();
    doc.strokeColor('#333').lineWidth(1);
    doc.moveTo(bounds.x, bounds.y).lineTo(bounds.x, bounds.y + bounds.height).stroke();
    doc.moveTo(bounds.x, bounds.y + bounds.height).lineTo(bounds.x + bounds.width, bounds.y + bounds.height).stroke();

    labels.forEach((label, i) => {
      const value = values[i] ?? 0;
      const h = maxValue > 0 ? (value / maxValue) * (bounds.height - 10) : 0;
      const bx = bounds.x + i * (barWidth * 1.6) + barWidth * 0.3;
      const by = bounds.y + bounds.height - h;

      doc.fillColor(color).rect(bx, by, barWidth, h).fill();
      doc.fillColor('#333').fontSize(8).text(label, bx - 6, bounds.y + bounds.height + 6, {
        width: barWidth + 16,
        align: 'center',
      });
      doc.fillColor('#111').fontSize(8).text(value.toFixed(3), bx - 4, by - 12, {
        width: barWidth + 8,
        align: 'center',
      });
    });

    doc.restore();
  }

  private drawScatter(
    doc: PDFKit.PDFDocument,
    payload: { labels: string[]; x?: number[]; y?: number[] },
    bounds: { x: number; y: number; width: number; height: number }
  ) {
    const xs = payload.x || [];
    const ys = payload.y || [];
    const labels = payload.labels || [];

    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 1);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 1);

    const sx = (v: number) => bounds.x + ((v - minX) / (maxX - minX || 1)) * bounds.width;
    const sy = (v: number) => bounds.y + bounds.height - ((v - minY) / (maxY - minY || 1)) * bounds.height;

    doc.save();
    doc.strokeColor('#333').lineWidth(1);
    doc.moveTo(bounds.x, bounds.y).lineTo(bounds.x, bounds.y + bounds.height).stroke();
    doc.moveTo(bounds.x, bounds.y + bounds.height).lineTo(bounds.x + bounds.width, bounds.y + bounds.height).stroke();

    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const x = sx(xs[i] ?? 0);
      const y = sy(ys[i] ?? 0);
      doc.fillColor('#2f80ed').circle(x, y, 4).fill();
      doc.fillColor('#222').fontSize(8).text(labels[i] || `P${i + 1}`, x + 5, y - 3);
    }

    doc.fontSize(9).fillColor('#333').text('loss', bounds.x + bounds.width - 20, bounds.y + bounds.height + 10);
    doc.save();
    doc.rotate(-90, { origin: [bounds.x - 25, bounds.y + 20] });
    doc.fontSize(9).fillColor('#333').text('accuracy', bounds.x - 25, bounds.y + 20);
    doc.restore();

    doc.restore();
  }

  private getCaption(chart: PlotChartType): string {
    if (chart === 'accuracy_bar') return 'Experiment accuracy comparison';
    if (chart === 'loss_bar') return 'Experiment loss comparison';
    return 'Accuracy vs Loss scatter across experiments';
  }

  private pickMetric(metrics: Record<string, number>, keys: string[]): number | undefined {
    for (const key of keys) {
      const v = metrics[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
      }
    }
    return undefined;
  }
}

export const plotService = new PlotService();
