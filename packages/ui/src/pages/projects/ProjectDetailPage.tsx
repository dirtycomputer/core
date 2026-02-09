import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Sparkles,
  Plus,
  ChevronRight,
  FlaskConical,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { projectsApi, experimentGroupsApi, aiApi } from '@/api/client';

interface ExperimentGroup {
  id: string;
  name: string;
  type: string;
  hypothesis: string;
  status: string;
  createdAt: string;
}

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [showPlanModal, setShowPlanModal] = useState(false);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['experiment-groups', projectId],
    queryFn: () => experimentGroupsApi.list({ projectId }),
    enabled: !!projectId,
  });

  const groups: ExperimentGroup[] = groupsData?.data || [];

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    approved: 'bg-blue-100 text-blue-800',
    running: 'bg-green-100 text-green-800',
    completed: 'bg-purple-100 text-purple-800',
  };

  const statusLabels: Record<string, string> = {
    draft: '草稿',
    approved: '已批准',
    running: '运行中',
    completed: '已完成',
  };

  const typeLabels: Record<string, string> = {
    baseline: '基线',
    improvement: '改进',
    ablation: '消融',
    exploration: '探索',
  };

  if (projectLoading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  if (!project) {
    return <div className="text-center py-12 text-gray-500">项目不存在</div>;
  }

  return (
    <div>
      {/* 返回链接 */}
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        返回项目列表
      </Link>

      {/* 项目信息 */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <p className="text-gray-500 mt-1">{project.description}</p>
          </div>
          <button
            onClick={() => setShowPlanModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-colors"
          >
            <Sparkles className="w-5 h-5" />
            AI 生成计划
          </button>
        </div>

        {project.researchGoal && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-1">研究目标</h3>
            <p className="text-gray-600">{project.researchGoal}</p>
          </div>
        )}
      </div>

      {/* 实验组列表 */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">实验组</h2>
          <button className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
            <Plus className="w-4 h-4" />
            添加实验组
          </button>
        </div>

        {groupsLoading ? (
          <div className="p-8 text-center text-gray-500">加载中...</div>
        ) : groups.length === 0 ? (
          <div className="p-8 text-center">
            <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">暂无实验组</p>
            <button
              onClick={() => setShowPlanModal(true)}
              className="mt-4 text-primary-600 hover:text-primary-700"
            >
              使用 AI 生成实验计划
            </button>
          </div>
        ) : (
          <div className="divide-y">
            {groups.map((group) => (
              <div
                key={group.id}
                className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{group.name}</h3>
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          {typeLabels[group.type]}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded ${statusColors[group.status]}`}
                        >
                          {statusLabels[group.status]}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{group.hypothesis}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 计划生成模态框 */}
      {showPlanModal && (
        <GeneratePlanModal
          project={project}
          onClose={() => setShowPlanModal(false)}
        />
      )}
    </div>
  );
}

function GeneratePlanModal({
  project,
  onClose,
}: {
  project: { id: string; name: string; researchGoal: string };
  onClose: () => void;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [generationError, setGenerationError] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [constraints, setConstraints] = useState({
    budget: '',
    maxExperiments: '',
  });
  const queryClient = useQueryClient();
  const generationSteps = [
    '解析研究目标与约束',
    '设计实验组与变量',
    '估算资源与风险',
    '整理为可执行计划',
  ];

  useEffect(() => {
    if (!isGenerating) {
      setElapsedSeconds(0);
      setActiveStepIndex(-1);
      return;
    }

    const startedAt = Date.now();
    setActiveStepIndex(0);

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(elapsed);
      setActiveStepIndex(Math.min(Math.floor(elapsed / 4), generationSteps.length - 1));
    }, 500);

    return () => clearInterval(timer);
  }, [isGenerating]);

  const handleGenerate = async () => {
    setGenerationError('');
    setIsGenerating(true);
    try {
      const result = await aiApi.generatePlan({
        projectName: project.name,
        researchGoal: project.researchGoal,
        constraints: {
          budget: constraints.budget ? parseInt(constraints.budget) : undefined,
          maxExperiments: constraints.maxExperiments
            ? parseInt(constraints.maxExperiments)
            : undefined,
        },
      });
      setPlan(result);
    } catch (error: any) {
      const apiError = error?.response?.data?.error;
      setGenerationError(apiError || '生成失败，请稍后重试或缩小约束范围。');
      console.error('Failed to generate plan:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!plan) return;

    // 创建实验组
    for (const group of plan.experimentGroups) {
      await experimentGroupsApi.create({
        projectId: project.id,
        name: group.name,
        type: group.type,
        hypothesis: group.hypothesis,
      });
    }

    queryClient.invalidateQueries({ queryKey: ['experiment-groups', project.id] });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">AI 生成实验计划</h2>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!plan ? (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <h3 className="text-sm font-medium text-gray-700 mb-1">研究目标</h3>
                <p className="text-gray-600">{project.researchGoal || '未设置'}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    GPU 小时预算
                  </label>
                  <input
                    type="number"
                    value={constraints.budget}
                    onChange={(e) =>
                      setConstraints({ ...constraints, budget: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="可选"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    最大实验数
                  </label>
                  <input
                    type="number"
                    value={constraints.maxExperiments}
                    onChange={(e) =>
                      setConstraints({ ...constraints, maxExperiments: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="可选"
                  />
                </div>
              </div>

              {generationError && (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                  {generationError}
                </div>
              )}

              {isGenerating && (
                <div className="p-4 rounded-lg border bg-gray-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                      AI 正在生成计划
                    </div>
                    <div className="text-xs text-gray-500">已耗时 {elapsedSeconds}s</div>
                  </div>
                  <div className="space-y-2">
                    {generationSteps.map((step, index) => {
                      const done = index < activeStepIndex;
                      const active = index === activeStepIndex;
                      return (
                        <div key={step} className="flex items-center gap-2 text-sm">
                          {done ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : active ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-gray-300" />
                          )}
                          <span className={done || active ? 'text-gray-800' : 'text-gray-400'}>
                            {step}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 rounded-lg">
                <h3 className="text-sm font-medium text-green-800 mb-1">计划摘要</h3>
                <p className="text-green-700">{plan.summary}</p>
              </div>

              <div>
                <h3 className="font-medium text-gray-900 mb-2">实验组</h3>
                <div className="space-y-2">
                  {plan.experimentGroups?.map((group: any, index: number) => (
                    <div key={index} className="p-3 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{group.name}</span>
                        <span className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                          {group.type}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{group.hypothesis}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {group.experiments?.length || 0} 个实验
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-blue-50 rounded-lg">
                <h3 className="text-sm font-medium text-blue-800 mb-1">资源估算</h3>
                <p className="text-blue-700">
                  预计 {plan.estimatedResources?.totalGpuHours || 0} GPU 小时，
                  {plan.estimatedResources?.experimentsCount || 0} 个实验
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            取消
          </button>
          {!plan ? (
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !project.researchGoal}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-colors disabled:opacity-50"
            >
              {isGenerating ? '生成中...' : '生成计划'}
            </button>
          ) : (
            <button
              onClick={handleApply}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              应用计划
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
