import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { aiApi } from '@/api/client';
import { Search, Loader2 } from 'lucide-react';

interface DeepResearchResponse {
  mode: 'deepagents' | 'fallback';
  query: string;
  report: string;
  notes: string[];
}

export default function DeepResearchPage() {
  const [query, setQuery] = useState('');
  const [maxResults, setMaxResults] = useState(6);
  const [topic, setTopic] = useState<'general' | 'news' | 'finance'>('general');

  const researchMutation = useMutation({
    mutationFn: async () =>
      aiApi.deepResearch({
        query,
        maxResults,
        topic,
      }) as Promise<DeepResearchResponse>,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    researchMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DeepResearch</h1>
        <p className="text-gray-500 mt-1">基于 deepagents 的深度研究工作流（含自动降级）</p>
      </div>

      <form onSubmit={onSubmit} className="bg-white rounded-lg border p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">研究问题</label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
            placeholder="例如：2026年多模态推理模型在工业质检中的最佳实践与主要风险"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">检索结果上限</label>
            <input
              type="number"
              min={3}
              max={20}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value) || 6)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">研究主题</label>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value as 'general' | 'news' | 'finance')}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="general">General</option>
              <option value="news">News</option>
              <option value="finance">Finance</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={researchMutation.isPending || !query.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
        >
          {researchMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              研究中...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              开始 DeepResearch
            </>
          )}
        </button>
      </form>

      {researchMutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {(researchMutation.error as any)?.response?.data?.error || 'DeepResearch 执行失败'}
        </div>
      )}

      {researchMutation.data && (
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">研究结果</h2>
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
              mode: {researchMutation.data.mode}
            </span>
          </div>

          {researchMutation.data.notes?.length > 0 && (
            <div className="text-sm text-gray-600">
              <div className="font-medium mb-1">Notes</div>
              <ul className="list-disc pl-5 space-y-1">
                {researchMutation.data.notes.map((note, index) => (
                  <li key={`${index}-${note}`}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <pre className="bg-gray-50 border rounded-lg p-3 text-sm whitespace-pre-wrap overflow-auto">
            {researchMutation.data.report}
          </pre>
        </div>
      )}
    </div>
  );
}
