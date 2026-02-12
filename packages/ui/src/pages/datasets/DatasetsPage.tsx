import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Database, Hammer, Plus } from 'lucide-react';
import { datasetsApi, projectsApi } from '@/api/client';

export default function DatasetsPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [versionInput, setVersionInput] = useState<Record<string, string>>({});
  const [analysisByDatasetId, setAnalysisByDatasetId] = useState<Record<string, any>>({});
  const [strategyByDatasetId, setStrategyByDatasetId] = useState<Record<string, any>>({});

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const projects = projectsData?.data || [];

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ['datasets', selectedProjectId],
    queryFn: () => datasetsApi.list({ projectId: selectedProjectId }),
    enabled: !!selectedProjectId,
  });

  const searchMutation = useMutation({
    mutationFn: (query: string) => datasetsApi.search({ query, maxResults: 10 }),
  });

  const createMutation = useMutation({
    mutationFn: datasetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets', selectedProjectId] });
    },
  });

  const constructMutation = useMutation({
    mutationFn: ({ datasetId, version }: { datasetId: string; version: string }) =>
      datasetsApi.construct(datasetId, {
        version,
        buildRecipe: {
          type: 'manual-curation',
          note: 'Constructed from dataset registry UI',
        },
        syntheticRows: [
          { text: 'example row 1', label: 'positive' },
          { text: 'example row 2', label: 'negative' },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets', selectedProjectId] });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: (datasetId: string) => datasetsApi.analyze(datasetId, { labelField: 'label', maxRows: 1000 }),
    onSuccess: (data: any, datasetId: string) => {
      setAnalysisByDatasetId((prev) => ({ ...prev, [datasetId]: data }));
    },
  });

  const strategyMutation = useMutation({
    mutationFn: (datasetId: string) =>
      datasetsApi.strategy(datasetId, {
        labelField: 'label',
        targetTask: 'classification',
      }),
    onSuccess: (data: any, datasetId: string) => {
      setStrategyByDatasetId((prev) => ({ ...prev, [datasetId]: data }));
      if (data?.versionSuggestion) {
        setVersionInput((prev) => ({ ...prev, [datasetId]: prev[datasetId] || data.versionSuggestion }));
      }
    },
  });

  const strategyConstructMutation = useMutation({
    mutationFn: ({ datasetId, strategy, version }: { datasetId: string; strategy: any; version: string }) =>
      datasetsApi.construct(datasetId, {
        version,
        splitInfo: strategy?.splitInfo || {},
        buildRecipe: strategy?.buildRecipe || {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets', selectedProjectId] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">数据集搜索与管理</h1>
        <p className="text-gray-500 mt-1">支持检索、入库、版本构造和可追溯管理</p>
      </div>

      <div className="bg-white border rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">选择项目</label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="w-full max-w-md px-3 py-2 border rounded-lg"
        >
          <option value="">请选择</option>
          {projects.map((project: any) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Search className="w-4 h-4" />
          数据集调研
        </h2>
        <div className="flex gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="例如: code generation benchmark"
            className="flex-1 px-3 py-2 border rounded-lg"
          />
          <button
            onClick={() => searchQuery.trim() && searchMutation.mutate(searchQuery.trim())}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            搜索
          </button>
        </div>

        {searchMutation.data && (
          <div className="space-y-2">
            {searchMutation.data.map((item: any, index: number) => (
              <div key={`${item.name}-${index}`} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">{item.name}</div>
                    <div className="text-sm text-gray-500 mt-1">{item.description}</div>
                    <div className="text-xs text-gray-400 mt-1">source: {item.source}</div>
                  </div>
                  <button
                    onClick={() => createMutation.mutate({
                      projectId: selectedProjectId,
                      name: item.name,
                      source: item.source,
                      description: item.description,
                      license: item.license,
                      homepage: item.homepage,
                      tags: item.tags || [],
                      metadata: item.metadata || {},
                      status: 'curated',
                    })}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                  >
                    <Plus className="w-4 h-4" />
                    加入数据集库
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <Database className="w-4 h-4" />
          项目数据集库
        </h2>

        {isLoading ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : datasets.length === 0 ? (
          <div className="text-sm text-gray-500">暂无数据集</div>
        ) : (
          <div className="space-y-3">
            {datasets.map((dataset: any) => (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                version={versionInput[dataset.id] || ''}
                onVersionChange={(value) =>
                  setVersionInput((prev) => ({ ...prev, [dataset.id]: value }))
                }
                onConstruct={() => {
                  const version = (versionInput[dataset.id] || '').trim();
                  if (!version) return;
                  constructMutation.mutate({ datasetId: dataset.id, version });
                }}
                onAnalyze={() => analyzeMutation.mutate(dataset.id)}
                onStrategy={() => strategyMutation.mutate(dataset.id)}
                onStrategyConstruct={() => {
                  const strategy = strategyByDatasetId[dataset.id];
                  const version = (versionInput[dataset.id] || strategy?.versionSuggestion || '').trim();
                  if (!strategy || !version) return;
                  strategyConstructMutation.mutate({ datasetId: dataset.id, strategy, version });
                }}
                analysis={analysisByDatasetId[dataset.id]}
                strategy={strategyByDatasetId[dataset.id]}
                analyzing={analyzeMutation.isPending && analyzeMutation.variables === dataset.id}
                strategizing={strategyMutation.isPending && strategyMutation.variables === dataset.id}
                strategyConstructing={strategyConstructMutation.isPending && strategyConstructMutation.variables?.datasetId === dataset.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DatasetCard({
  dataset,
  version,
  onVersionChange,
  onConstruct,
  onAnalyze,
  onStrategy,
  onStrategyConstruct,
  analysis,
  strategy,
  analyzing,
  strategizing,
  strategyConstructing,
}: {
  dataset: any;
  version: string;
  onVersionChange: (value: string) => void;
  onConstruct: () => void;
  onAnalyze: () => void;
  onStrategy: () => void;
  onStrategyConstruct: () => void;
  analysis?: any;
  strategy?: any;
  analyzing?: boolean;
  strategizing?: boolean;
  strategyConstructing?: boolean;
}) {
  const { data: versions = [] } = useQuery({
    queryKey: ['dataset-versions', dataset.id],
    queryFn: () => datasetsApi.versions(dataset.id),
  });

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-gray-900">{dataset.name}</div>
          <div className="text-sm text-gray-500 mt-1">{dataset.description || '-'}</div>
          <div className="text-xs text-gray-400 mt-1">状态: {dataset.status} | 来源: {dataset.source || '-'}</div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={version}
          onChange={(e) => onVersionChange(e.target.value)}
          placeholder="输入新版本号，例如 v1"
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
        />
        <button
          onClick={onConstruct}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          <Hammer className="w-4 h-4" />
          构造版本
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={onAnalyze}
          className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
          disabled={analyzing}
        >
          {analyzing ? '分析中...' : 'EDA/质量评分'}
        </button>
        <button
          onClick={onStrategy}
          className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
          disabled={strategizing}
        >
          {strategizing ? '生成中...' : '策略建议'}
        </button>
        <button
          onClick={onStrategyConstruct}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
          disabled={!strategy || strategyConstructing}
        >
          {strategyConstructing ? '构造中...' : '按策略构造'}
        </button>
      </div>

      {analysis && (
        <div className="mt-3 p-3 border rounded bg-gray-50">
          <div className="text-xs text-gray-500">数据质量评分</div>
          <div className="mt-1 text-sm text-gray-700">
            Overall {analysis.quality?.overall} / 100
            {' '}| Completeness {analysis.quality?.completeness}
            {' '}| Consistency {analysis.quality?.consistency}
            {' '}| Diversity {analysis.quality?.diversity}
            {' '}| Balance {analysis.quality?.balance}
          </div>
          {Array.isArray(analysis.detectedIssues) && analysis.detectedIssues.length > 0 && (
            <ul className="mt-2 text-xs text-red-600 list-disc pl-5">
              {analysis.detectedIssues.slice(0, 4).map((issue: string, idx: number) => (
                <li key={`${dataset.id}-issue-${idx}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {strategy && (
        <div className="mt-3 p-3 border rounded bg-blue-50">
          <div className="text-xs text-gray-500">策略化构造建议</div>
          <div className="mt-1 text-sm text-gray-700">
            推荐版本: <span className="font-medium">{strategy.versionSuggestion}</span>
            {' '}| split: {JSON.stringify(strategy.splitInfo || {})}
          </div>
          {Array.isArray(strategy.rationale) && strategy.rationale.length > 0 && (
            <ul className="mt-2 text-xs text-gray-700 list-disc pl-5">
              {strategy.rationale.slice(0, 3).map((item: string, idx: number) => (
                <li key={`${dataset.id}-rationale-${idx}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {versions.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1">版本历史</div>
          <div className="flex flex-wrap gap-2">
            {versions.map((v: any) => (
              <span key={v.id} className="text-xs px-2 py-1 bg-gray-100 rounded">
                {v.version}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
