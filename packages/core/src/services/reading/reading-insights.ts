export type OcrEngine = 'auto' | 'mineru' | 'glm_ocr' | 'deepseek_ocr' | 'fallback';

export interface StructuredPaperInfo {
  title: string;
  authors: string[];
  affiliations: string[];
  keywords: string[];
  abstract: string;
  outline: string[];
  latexSnippets: string[];
  textPreview: string;
  engineUsed: OcrEngine | 'llm';
  generatedAt: string;
}

export interface AlphaBlogPost {
  title: string;
  slug: string;
  style: 'alpharxiv' | 'technical' | 'plain';
  language: 'zh' | 'en';
  highlights: string[];
  markdown: string;
  generatedAt: string;
}

interface BuildStructuredInput {
  title: string;
  authors: string[];
  abstract?: string;
  rawText?: string;
  metadata?: Record<string, unknown>;
  engineUsed: OcrEngine | 'llm';
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'using', 'into', 'their',
  'model', 'models', 'paper', 'study', 'results', 'result', 'method', 'methods',
  'approach', 'based', 'data', 'dataset', 'datasets', 'analysis', 'task', 'tasks',
  'our', 'are', 'is', 'was', 'were', 'have', 'has', 'had', 'can', 'could', 'should',
  'into', 'about', 'between', 'across', 'over', 'under', 'after', 'before', 'than',
  '问题', '方法', '结果', '模型', '数据', '研究', '实验', '基于', '一种', '以及', '通过',
]);

const toSlug = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const cleanLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export function extractKeywords(text: string, limit = 10): string[] {
  const tokens = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([token]) => token);
}

export function extractAffiliations(text: string, limit = 8): string[] {
  const lines = cleanLines(text);
  const pattern = /(university|institute|school|college|laboratory|lab|research center|academy|大学|学院|研究所|实验室|中心)/i;
  const matches = lines.filter((line) => pattern.test(line));
  const uniq: string[] = [];
  for (const line of matches) {
    if (!uniq.includes(line)) uniq.push(line);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

export function extractOutline(text: string, limit = 12): string[] {
  const lines = cleanLines(text);
  const sectionPattern = /^(\d+(\.\d+){0,2}\s+)?(abstract|introduction|related work|background|method|methods|approach|experiment|experiments|results|discussion|conclusion|appendix)\b/i;
  const matches = lines.filter((line) => sectionPattern.test(line));
  const uniq: string[] = [];
  for (const line of matches) {
    if (!uniq.includes(line)) uniq.push(line);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

export function extractLatexSnippets(text: string, limit = 8): string[] {
  const snippets: string[] = [];
  const patterns = [
    /\$[^$]{3,120}\$/g,
    /\\begin\{equation\}[\s\S]{0,200}?\\end\{equation\}/g,
    /\\[a-zA-Z]+\{[^{}\n]{1,120}\}/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const compact = match.replace(/\s+/g, ' ').trim();
      if (!snippets.includes(compact)) snippets.push(compact);
      if (snippets.length >= limit) return snippets;
    }
  }

  return snippets;
}

export function buildStructuredPaperInfo(input: BuildStructuredInput): StructuredPaperInfo {
  const rawText = input.rawText || '';
  const abstract = input.abstract || '';
  const mergedText = `${abstract}\n${rawText}`.trim();
  const metadataKeywords = Array.isArray(input.metadata?.keywords)
    ? (input.metadata?.keywords as unknown[]).map((k) => String(k)).filter(Boolean)
    : [];

  const keywords = metadataKeywords.length > 0
    ? metadataKeywords.slice(0, 10)
    : extractKeywords(mergedText, 10);

  return {
    title: input.title,
    authors: input.authors,
    affiliations: extractAffiliations(rawText),
    keywords,
    abstract: abstract || cleanLines(rawText).slice(0, 3).join(' '),
    outline: extractOutline(rawText),
    latexSnippets: extractLatexSnippets(rawText),
    textPreview: cleanLines(rawText).slice(0, 12).join('\n'),
    engineUsed: input.engineUsed,
    generatedAt: new Date().toISOString(),
  };
}

interface BuildBlogInput {
  structured: StructuredPaperInfo;
  style?: 'alpharxiv' | 'technical' | 'plain';
  language?: 'zh' | 'en';
}

export function buildAlphaBlogPost(input: BuildBlogInput): AlphaBlogPost {
  const style = input.style || 'alpharxiv';
  const language = input.language || 'zh';
  const s = input.structured;

  const highlights = [
    `核心关键词: ${s.keywords.slice(0, 5).join(', ') || 'N/A'}`,
    `识别作者单位数: ${s.affiliations.length}`,
    `识别章节数: ${s.outline.length}`,
  ];

  const heading = language === 'zh' ? '论文速读' : 'Paper Digest';
  const what = language === 'zh' ? '这篇论文做了什么' : 'What This Paper Does';
  const why = language === 'zh' ? '为什么重要' : 'Why It Matters';
  const methods = language === 'zh' ? '方法与技术要点' : 'Method Highlights';
  const critique = language === 'zh' ? '局限与复现实验建议' : 'Limitations & Reproduction Notes';
  const refs = language === 'zh' ? '附录：结构化解析' : 'Appendix: Structured Parsing';

  const markdown = [
    `# ${heading}: ${s.title}`,
    '',
    `- ${language === 'zh' ? '作者' : 'Authors'}: ${s.authors.join(', ') || 'Unknown'}`,
    `- ${language === 'zh' ? 'OCR 引擎' : 'OCR Engine'}: ${s.engineUsed}`,
    `- ${language === 'zh' ? '关键词' : 'Keywords'}: ${s.keywords.join(', ') || 'N/A'}`,
    '',
    `## ${what}`,
    s.abstract || (language === 'zh' ? '暂无摘要。' : 'No abstract available.'),
    '',
    `## ${why}`,
    language === 'zh'
      ? '该工作可用于快速建立研究背景和方法基线，尤其适合纳入实验规划与复盘环节。'
      : 'This work can be used to quickly build research context and method baselines for experiment planning.',
    '',
    `## ${methods}`,
    s.outline.length > 0 ? s.outline.map((item) => `- ${item}`).join('\n') : (language === 'zh' ? '- 暂未识别章节。' : '- No section outline detected.'),
    '',
    `## ${critique}`,
    language === 'zh'
      ? '- 建议补充消融实验与资源成本对比。\n- 建议检查可复现配置（随机种子、数据切分、评测脚本）。'
      : '- Add ablation and cost comparison.\n- Verify reproducibility setup (seed, split, eval scripts).',
    '',
    `## ${refs}`,
    `- ${language === 'zh' ? '作者单位' : 'Affiliations'}: ${s.affiliations.join(' | ') || 'N/A'}`,
    `- ${language === 'zh' ? 'LaTeX 片段' : 'LaTeX snippets'}: ${s.latexSnippets.slice(0, 5).join(' ; ') || 'N/A'}`,
    '',
  ].join('\n');

  return {
    title: s.title,
    slug: toSlug(s.title) || `paper-${Date.now()}`,
    style,
    language,
    highlights,
    markdown,
    generatedAt: new Date().toISOString(),
  };
}
