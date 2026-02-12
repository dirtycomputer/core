import { describe, expect, it } from 'vitest';
import {
  buildAlphaBlogPost,
  buildStructuredPaperInfo,
  extractLatexSnippets,
} from '../src/services/reading/reading-insights';

describe('reading-insights', () => {
  it('extracts structured paper info from OCR-like text', () => {
    const rawText = `
      Introduction
      We propose a transformer-based retrieval system.
      Tsinghua University, Beijing, China
      Method
      The objective is $L = \\lambda_1 L_{ce} + \\lambda_2 L_{rank}$.
      Results
    `;

    const structured = buildStructuredPaperInfo({
      title: 'A Retrieval Paper',
      authors: ['Alice', 'Bob'],
      abstract: 'We study retrieval augmentation for generation.',
      rawText,
      engineUsed: 'fallback',
    });

    expect(structured.affiliations.length).toBeGreaterThan(0);
    expect(structured.keywords.length).toBeGreaterThan(0);
    expect(structured.outline.some((item) => /introduction/i.test(item))).toBe(true);
    expect(structured.latexSnippets.length).toBeGreaterThan(0);
  });

  it('generates alpharxiv-like markdown blog', () => {
    const structured = buildStructuredPaperInfo({
      title: 'Fast Inference with Distillation',
      authors: ['Carol'],
      abstract: 'This paper compresses large models using distillation.',
      rawText: 'Method\nConclusion',
      engineUsed: 'fallback',
    });

    const blog = buildAlphaBlogPost({
      structured,
      style: 'alpharxiv',
      language: 'zh',
    });

    expect(blog.slug.length).toBeGreaterThan(0);
    expect(blog.markdown).toContain('# 论文速读');
    expect(blog.markdown).toContain('## 这篇论文做了什么');
  });

  it('extracts latex snippets', () => {
    const snippets = extractLatexSnippets('Loss: $L=xy$ and \\begin{equation}a+b=c\\end{equation}');
    expect(snippets.length).toBeGreaterThan(0);
  });
});
