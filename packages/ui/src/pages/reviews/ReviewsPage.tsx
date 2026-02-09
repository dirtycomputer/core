import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, RefreshCcw } from 'lucide-react';
import { projectsApi, reviewsApi, workflowsApi } from '@/api/client';

export default function ReviewsPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState('');

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

  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows', selectedProjectId],
    queryFn: () => workflowsApi.list({ projectId: selectedProjectId }),
    enabled: !!selectedProjectId,
  });

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['reviews', selectedProjectId],
    queryFn: () => reviewsApi.list(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  useEffect(() => {
    if (!selectedReviewId && reviews.length > 0) {
      setSelectedReviewId(reviews[0].id);
    }
  }, [reviews, selectedReviewId]);

  const { data: selectedReview } = useQuery({
    queryKey: ['review', selectedReviewId],
    queryFn: () => reviewsApi.get(selectedReviewId),
    enabled: !!selectedReviewId,
  });

  const generateMutation = useMutation({
    mutationFn: () => reviewsApi.generate({
      projectId: selectedProjectId,
      workflowId: selectedWorkflowId || undefined,
    }),
    onSuccess: (review) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', selectedProjectId] });
      setSelectedReviewId(review.id);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paper Review 与复盘</h1>
        <p className="text-gray-500 mt-1">对实验产出做审稿视角评估，并沉淀复盘行动项</p>
      </div>

      <div className="bg-white border rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">项目</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">请选择</option>
            {projects.map((project: any) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">关联工作流（可选）</label>
          <select
            value={selectedWorkflowId}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value="">无</option>
            {workflows.map((workflow: any) => (
              <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={() => generateMutation.mutate()}
            disabled={!selectedProjectId || generateMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            <RefreshCcw className="w-4 h-4" />
            {generateMutation.isPending ? '生成中...' : '生成 Review'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">历史记录</h2>
          {isLoading ? (
            <div className="text-sm text-gray-500">加载中...</div>
          ) : reviews.length === 0 ? (
            <div className="text-sm text-gray-500">暂无记录</div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-auto">
              {reviews.map((review: any) => (
                <button
                  key={review.id}
                  onClick={() => setSelectedReviewId(review.id)}
                  className={`w-full text-left border rounded-lg p-3 ${selectedReviewId === review.id ? 'border-primary-500 bg-primary-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="text-sm font-medium text-gray-900">{review.title}</div>
                  <div className="text-xs text-gray-500 mt-1">{new Date(review.createdAt).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="xl:col-span-2 bg-white border rounded-lg p-4">
          {!selectedReview ? (
            <div className="text-sm text-gray-500">请选择一条记录</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FileSearch className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">{selectedReview.title}</h2>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <Metric label="Overall" value={selectedReview.review?.overallScore} />
                <Metric label="Novelty" value={selectedReview.review?.novelty} />
                <Metric label="Soundness" value={selectedReview.review?.soundness} />
                <Metric label="Repro" value={selectedReview.review?.reproducibility} />
                <Metric label="Clarity" value={selectedReview.review?.clarity} />
              </div>

              <div className="text-sm text-gray-700">
                <span className="font-medium">Decision:</span> {selectedReview.review?.decision}
              </div>

              <ListSection title="Strengths" items={selectedReview.review?.strengths || []} />
              <ListSection title="Weaknesses" items={selectedReview.review?.weaknesses || []} />
              <ListSection title="Suggestions" items={selectedReview.review?.suggestions || []} />

              <div className="pt-3 border-t">
                <h3 className="font-medium text-gray-900">Retrospective</h3>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{selectedReview.retrospective?.summary}</p>
              </div>

              <ListSection title="What Worked" items={selectedReview.retrospective?.whatWorked || []} />
              <ListSection title="What Did Not Work" items={selectedReview.retrospective?.whatDidNotWork || []} />

              <div>
                <h4 className="font-medium text-gray-900 mb-2">Action Items</h4>
                <div className="space-y-2">
                  {(selectedReview.retrospective?.actionItems || []).map((item: any, index: number) => (
                    <div key={`${index}-${item.action}`} className="border rounded p-2 text-sm text-gray-700">
                      <div className="font-medium">{item.action}</div>
                      <div className="text-xs text-gray-500 mt-1">priority: {item.priority} {item.owner ? `| owner: ${item.owner}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="border rounded-lg p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{typeof value === 'number' ? value.toFixed(1) : '-'}</div>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="font-medium text-gray-900 mb-2">{title}</h4>
      {items.length === 0 ? (
        <div className="text-sm text-gray-500">暂无</div>
      ) : (
        <ul className="space-y-1 text-sm text-gray-700 list-disc pl-5">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
