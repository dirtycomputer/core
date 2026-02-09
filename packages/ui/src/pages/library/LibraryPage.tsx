import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, BookOpen, Download, ExternalLink, FileText } from 'lucide-react';
import { projectsApi, readingApi } from '@/api/client';

export default function LibraryPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [summaryByPaperId, setSummaryByPaperId] = useState<Record<string, string>>({});

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

  const { data: papers = [], isLoading } = useQuery({
    queryKey: ['papers', selectedProjectId],
    queryFn: () => readingApi.listPapers({ projectId: selectedProjectId }),
    enabled: !!selectedProjectId,
    refetchInterval: 5000,
  });

  const searchMutation = useMutation({
    mutationFn: (query: string) => readingApi.search({ query, maxResults: 8 }),
  });

  const createPaperMutation = useMutation({
    mutationFn: readingApi.createPaper,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['papers', selectedProjectId] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (paperId: string) => readingApi.downloadPdf(paperId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['papers', selectedProjectId] });
    },
  });

  const summaryMutation = useMutation({
    mutationFn: (paperId: string) => readingApi.summarize(paperId),
    onSuccess: (data: any, paperId: string) => {
      setSummaryByPaperId((prev) => ({ ...prev, [paperId]: data.summary || '' }));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reading Agent / 论文库</h1>
        <p className="text-gray-500 mt-1">检索论文、下载 PDF、管理文献并生成阅读摘要</p>
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
          文献检索
        </h2>
        <div className="flex gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="例如: retrieval augmented generation benchmark"
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
            {searchMutation.data.map((paper: any, index: number) => (
              <div key={`${paper.title}-${index}`} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">{paper.title}</div>
                    <div className="text-sm text-gray-500 mt-1">{(paper.authors || []).join(', ') || 'Unknown authors'}</div>
                    <div className="text-xs text-gray-400 mt-1">{paper.venue || '-'} {paper.year || ''}</div>
                  </div>
                  <button
                    onClick={() => createPaperMutation.mutate({
                      projectId: selectedProjectId,
                      title: paper.title,
                      authors: paper.authors || [],
                      venue: paper.venue,
                      year: paper.year,
                      url: paper.url,
                      pdfUrl: paper.pdfUrl,
                      abstract: paper.abstract,
                      metadata: paper.metadata || {},
                    })}
                    className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
                  >
                    加入论文库
                  </button>
                </div>
                {paper.abstract && <p className="text-sm text-gray-600 mt-2">{paper.abstract}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4" />
          项目论文库
        </h2>

        {isLoading ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : papers.length === 0 ? (
          <div className="text-sm text-gray-500">暂无论文</div>
        ) : (
          <div className="space-y-3">
            {papers.map((paper: any) => (
              <div key={paper.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-900">{paper.title}</div>
                    <div className="text-sm text-gray-500 mt-1">{(paper.authors || []).join(', ') || 'Unknown authors'}</div>
                    <div className="text-xs text-gray-400 mt-1">状态: {paper.status} | {paper.venue || '-'} {paper.year || ''}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                      onClick={() => downloadMutation.mutate(paper.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                    >
                      <Download className="w-3 h-3" />
                      下载PDF
                    </button>
                    {paper.localPdfPath && (
                      <a
                        href={readingApi.pdfUrl(paper.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                      >
                        <FileText className="w-3 h-3" />
                        查看详情
                      </a>
                    )}
                    {paper.url && (
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                      >
                        <ExternalLink className="w-3 h-3" />
                        链接
                      </a>
                    )}
                    <button
                      onClick={() => summaryMutation.mutate(paper.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-900 text-white rounded hover:bg-gray-800"
                    >
                      生成摘要
                    </button>
                  </div>
                </div>

                {paper.abstract && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-3">{paper.abstract}</p>
                )}

                {summaryByPaperId[paper.id] && (
                  <div className="mt-3 p-3 bg-gray-50 border rounded text-sm text-gray-700 whitespace-pre-wrap">
                    {summaryByPaperId[paper.id]}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
