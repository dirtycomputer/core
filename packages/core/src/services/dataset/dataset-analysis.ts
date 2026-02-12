export type ColumnInferredType = 'number' | 'boolean' | 'string' | 'json' | 'mixed' | 'empty';

export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
}

export interface DatasetColumnProfile {
  name: string;
  inferredType: ColumnInferredType;
  missingCount: number;
  missingRate: number;
  uniqueCount: number;
  uniqueRate: number;
  topValues: Array<{ value: string; count: number }>;
  numericStats?: NumericStats;
}

export interface DatasetQualityScore {
  overall: number;
  completeness: number;
  consistency: number;
  diversity: number;
  balance: number;
}

export interface DatasetAnalysisResult {
  sampleSize: number;
  columnCount: number;
  columns: DatasetColumnProfile[];
  quality: DatasetQualityScore;
  detectedIssues: string[];
  recommendedActions: string[];
}

export interface DatasetAnalysisOptions {
  labelField?: string;
  maxTopValues?: number;
}

export interface DatasetConstructStrategy {
  versionSuggestion: string;
  splitInfo: Record<string, unknown>;
  buildRecipe: Record<string, unknown>;
  rationale: string[];
  riskChecks: string[];
}

export interface DatasetConstructStrategyInput {
  datasetName: string;
  analysis: DatasetAnalysisResult;
  targetTask?: string;
  labelField?: string;
  preferredVersion?: string;
}

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

const isMissing = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const inferValueType = (value: unknown): 'number' | 'boolean' | 'string' | 'json' | 'missing' => {
  if (isMissing(value)) return 'missing';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    const numeric = toNumber(value);
    if (numeric !== undefined && value.trim() !== '') return 'number';
    return 'string';
  }
  return 'json';
};

const inferColumnType = (values: unknown[]): ColumnInferredType => {
  const observed = new Set(values.map((v) => inferValueType(v)).filter((v) => v !== 'missing'));
  if (observed.size === 0) return 'empty';
  if (observed.size > 1) return 'mixed';
  const [only] = [...observed];
  if (only === 'number' || only === 'boolean' || only === 'string' || only === 'json') return only;
  return 'mixed';
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
};

const buildTopValues = (values: unknown[], maxTopValues: number): Array<{ value: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (isMissing(value)) continue;
    const key = stableStringify(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTopValues)
    .map(([value, count]) => ({ value, count }));
};

const buildNumericStats = (values: unknown[]): NumericStats | undefined => {
  const nums = values
    .map((v) => toNumber(v))
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);

  if (nums.length === 0) return undefined;

  const sum = nums.reduce((acc, v) => acc + v, 0);
  return {
    min: round2(nums[0]),
    max: round2(nums[nums.length - 1]),
    mean: round2(sum / nums.length),
    p50: round2(percentile(nums, 0.5)),
    p90: round2(percentile(nums, 0.9)),
  };
};

const computeBalanceScore = (
  rows: Array<Record<string, unknown>>,
  explicitLabelField?: string
): { score: number; field?: string; labels: Record<string, number> } => {
  const candidateField = explicitLabelField || (rows.length > 0 && 'label' in rows[0] ? 'label' : undefined);
  if (!candidateField) {
    return { score: 70, labels: {} };
  }

  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row[candidateField];
    if (isMissing(raw)) continue;
    const key = stableStringify(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const entries = [...counts.entries()];
  if (entries.length <= 1) {
    return {
      score: entries.length === 1 ? 40 : 55,
      field: candidateField,
      labels: Object.fromEntries(entries),
    };
  }

  const total = entries.reduce((acc, item) => acc + item[1], 0);
  const entropy = entries.reduce((acc, [, count]) => {
    const p = count / total;
    return acc - p * Math.log(p);
  }, 0);
  const normalizedEntropy = entropy / Math.log(entries.length);

  return {
    score: round2(clamp(normalizedEntropy * 100)),
    field: candidateField,
    labels: Object.fromEntries(entries),
  };
};

export function analyzeDatasetRows(
  rows: Array<Record<string, unknown>>,
  options: DatasetAnalysisOptions = {}
): DatasetAnalysisResult {
  const maxTopValues = options.maxTopValues || 5;
  const sampleSize = rows.length;
  const allColumns = new Set<string>();
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => allColumns.add(key));
  }
  const columnNames = [...allColumns];

  const columns: DatasetColumnProfile[] = columnNames.map((name) => {
    const values = rows.map((row) => row[name]);
    const missingCount = values.filter((v) => isMissing(v)).length;
    const valueKeys = values.filter((v) => !isMissing(v)).map((v) => stableStringify(v));
    const uniqueCount = new Set(valueKeys).size;
    const inferredType = inferColumnType(values);

    return {
      name,
      inferredType,
      missingCount,
      missingRate: sampleSize > 0 ? round2((missingCount / sampleSize) * 100) : 0,
      uniqueCount,
      uniqueRate: sampleSize > 0 ? round2((uniqueCount / sampleSize) * 100) : 0,
      topValues: buildTopValues(values, maxTopValues),
      numericStats: buildNumericStats(values),
    };
  });

  const columnCount = columns.length;
  const totalCells = Math.max(1, sampleSize * Math.max(1, columnCount));
  const missingCells = columns.reduce((acc, c) => acc + c.missingCount, 0);
  const mixedColumns = columns.filter((c) => c.inferredType === 'mixed' || c.inferredType === 'empty').length;
  const avgUniqueRate = columnCount === 0
    ? 0
    : columns.reduce((acc, c) => acc + c.uniqueRate, 0) / columnCount;

  const balance = computeBalanceScore(rows, options.labelField);

  const quality: DatasetQualityScore = {
    completeness: round2(clamp((1 - missingCells / totalCells) * 100)),
    consistency: round2(clamp((1 - mixedColumns / Math.max(1, columnCount)) * 100)),
    diversity: round2(clamp(avgUniqueRate)),
    balance: round2(clamp(balance.score)),
    overall: 0,
  };

  quality.overall = round2(
    clamp(
      quality.completeness * 0.35
      + quality.consistency * 0.25
      + quality.diversity * 0.2
      + quality.balance * 0.2
    )
  );

  const detectedIssues: string[] = [];
  if (sampleSize < 50) detectedIssues.push('Sample size is very small (<50).');
  if (quality.completeness < 85) detectedIssues.push('Missing value ratio is high.');
  if (quality.consistency < 80) detectedIssues.push('Schema consistency is weak (mixed/empty columns detected).');
  if (quality.diversity < 35) detectedIssues.push('Feature diversity is low.');
  if (quality.balance < 60 && balance.field) {
    detectedIssues.push(`Label distribution is imbalanced on field "${balance.field}".`);
  }
  if (columns.some((c) => c.uniqueRate > 99 && c.inferredType === 'string')) {
    detectedIssues.push('Potential ID-like columns detected (very high cardinality).');
  }

  const recommendedActions: string[] = [];
  if (quality.completeness < 95) recommendedActions.push('Apply missing-value cleaning or imputation.');
  if (quality.consistency < 90) recommendedActions.push('Normalize schema/types before training split.');
  if (quality.balance < 70 && balance.field) recommendedActions.push(`Rebalance labels for "${balance.field}" using class weights or resampling.`);
  if (quality.diversity < 45) recommendedActions.push('Run deduplication and expand data coverage for hard/rare cases.');
  if (sampleSize < 1000) recommendedActions.push('Use K-fold validation or conservative split due to limited sample size.');

  return {
    sampleSize,
    columnCount,
    columns,
    quality,
    detectedIssues,
    recommendedActions,
  };
}

const defaultSplit = (sampleSize: number): { train: number; validation: number; test: number } => {
  if (sampleSize < 200) return { train: 0.7, validation: 0.15, test: 0.15 };
  if (sampleSize < 1000) return { train: 0.75, validation: 0.125, test: 0.125 };
  return { train: 0.8, validation: 0.1, test: 0.1 };
};

const dateVersionToken = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
};

export function recommendDatasetConstructStrategy(
  input: DatasetConstructStrategyInput
): DatasetConstructStrategy {
  const { analysis } = input;
  const split = defaultSplit(analysis.sampleSize);
  const preprocessingSteps: string[] = ['schema_validation', 'train_val_test_split'];
  const qualityActions: string[] = [];

  if (analysis.quality.completeness < 95) {
    preprocessingSteps.push('missing_value_imputation');
    qualityActions.push('impute-missing-values');
  }
  if (analysis.quality.consistency < 90) {
    preprocessingSteps.push('type_normalization');
    qualityActions.push('normalize-column-types');
  }
  if (analysis.quality.balance < 70) {
    preprocessingSteps.push('label_rebalancing');
    qualityActions.push('rebalance-label-distribution');
  }
  if (analysis.quality.diversity < 45) {
    preprocessingSteps.push('deduplication_and_hard_case_mining');
    qualityActions.push('deduplicate-and-add-hard-cases');
  }

  const rationale = [
    `Quality overall score: ${analysis.quality.overall}`,
    `Completeness=${analysis.quality.completeness}, Consistency=${analysis.quality.consistency}, Diversity=${analysis.quality.diversity}, Balance=${analysis.quality.balance}`,
    `Recommended split: train=${split.train}, validation=${split.validation}, test=${split.test}`,
  ];

  const riskChecks = [
    'Leakage check between train/val/test',
    'Label coverage check per split',
    'Outlier and duplicates check',
    'Schema drift check against previous version',
  ];

  const buildRecipe: Record<string, unknown> = {
    strategy: 'quality-aware-v1',
    targetTask: input.targetTask || 'classification',
    preprocessingSteps,
    qualityActions,
    generatedAt: new Date().toISOString(),
  };

  return {
    versionSuggestion: input.preferredVersion || `v${dateVersionToken()}-qa`,
    splitInfo: split,
    buildRecipe,
    rationale,
    riskChecks,
  };
}
