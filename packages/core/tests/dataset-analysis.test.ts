import { describe, expect, it } from 'vitest';
import {
  analyzeDatasetRows,
  recommendDatasetConstructStrategy,
} from '../src/services/dataset/dataset-analysis';

describe('dataset-analysis', () => {
  it('computes EDA quality metrics and detects imbalance', () => {
    const rows = [
      { text: 'alpha', label: 'A', score: 0.9 },
      { text: 'beta', label: 'A', score: 0.85 },
      { text: 'gamma', label: 'A', score: 0.8 },
      { text: 'delta', label: 'A', score: 0.7 },
      { text: 'epsilon', label: 'B', score: 0.5 },
      { text: '', label: 'A', score: null },
    ] as Array<Record<string, unknown>>;

    const analysis = analyzeDatasetRows(rows, { labelField: 'label' });

    expect(analysis.sampleSize).toBe(6);
    expect(analysis.columnCount).toBe(3);
    expect(analysis.quality.overall).toBeGreaterThan(0);
    expect(analysis.quality.balance).toBeLessThan(70);
    expect(analysis.columns.find((col) => col.name === 'score')?.numericStats?.max).toBe(0.9);
  });

  it('recommends quality-aware construction strategy', () => {
    const analysis = analyzeDatasetRows(
      Array.from({ length: 120 }, (_v, idx) => ({
        text: `sample-${idx}`,
        label: idx < 110 ? 'major' : 'minor',
        feature: idx % 4,
      })),
      { labelField: 'label' }
    );

    const strategy = recommendDatasetConstructStrategy({
      datasetName: 'demo',
      analysis,
      targetTask: 'classification',
    });

    expect(strategy.versionSuggestion).toContain('v');
    expect(strategy.splitInfo).toHaveProperty('train');
    expect(strategy.buildRecipe).toHaveProperty('preprocessingSteps');
    expect(Array.isArray(strategy.rationale)).toBe(true);
  });
});
