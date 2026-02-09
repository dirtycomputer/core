import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Pause, RotateCcw, Activity, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { projectsApi, workflowsApi } from '@/api/client';
import { clsx } from 'clsx';

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '运行中',
  waiting_human: '等待人工',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  waiting_human: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-700',
};

export default function WorkflowsPage() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [requestedBy, setRequestedBy] = useState('researcher');
  const [maxExperiments, setMaxExperiments] = useState(8);
  const [clusterType, setClusterType] = useState<'slurm' | 'kubernetes' | 'ssh'>('ssh');
  const [decisionMode, setDecisionMode] = useState<'human_in_loop' | 'autonomous'>('human_in_loop');
  const [plotEngine, setPlotEngine] = useState<'auto' | 'matplotlib' | 'seaborn' | 'echarts' | 'r' | 'pdfkit'>('auto');
  const [gateSelection, setGateSelection] = useState<Record<string, string>>({});

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

  const { data: workflows = [], isLoading: workflowsLoading } = useQuery({
    queryKey: ['workflows', selectedProjectId],
    queryFn: () => workflowsApi.list({ projectId: selectedProjectId }),
    enabled: !!selectedProjectId,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId('');
      return;
    }
    if (!selectedWorkflowId || !workflows.some((w: any) => w.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [workflows, selectedWorkflowId]);

  const { data: events = [] } = useQuery({
    queryKey: ['workflow-events', selectedWorkflowId],
    queryFn: () => workflowsApi.events(selectedWorkflowId, 300),
    enabled: !!selectedWorkflowId,
    refetchInterval: 4000,
  });

  const { data: gates = [] } = useQuery({
    queryKey: ['workflow-gates', selectedWorkflowId],
    queryFn: () => workflowsApi.gates(selectedWorkflowId),
    enabled: !!selectedWorkflowId,
    refetchInterval: 4000,
  });

  const pendingGates = useMemo(
    () => gates.filter((gate: any) => gate.status === 'pending'),
    [gates]
  );

  const createMutation = useMutation({
    mutationFn: workflowsApi.createAuto,
    onSuccess: (workflow) => {
      queryClient.invalidateQueries({ queryKey: ['workflows', selectedProjectId] });
      setSelectedWorkflowId(workflow.id);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: workflowsApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-events', selectedWorkflowId] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: workflowsApi.resume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-events', selectedWorkflowId] });
    },
  });

  const resolveGateMutation = useMutation({
    mutationFn: ({ gateId, status, selectedOption }: { gateId: string; status: 'approved' | 'rejected' | 'changes_requested'; selectedOption?: string }) =>
      workflowsApi.resolveGate(selectedWorkflowId, gateId, {
        status,
        selectedOption,
        resolvedBy: requestedBy,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-gates', selectedWorkflowId] });
      queryClient.invalidateQueries({ queryKey: ['workflow-events', selectedWorkflowId] });
      queryClient.invalidateQueries({ queryKey: ['workflows', selectedProjectId] });
    },
  });

  const onCreateWorkflow = () => {
    if (!selectedProjectId) return;
    createMutation.mutate({
      projectId: selectedProjectId,
      requestedBy,
      decisionMode,
      clusterType,
      maxExperiments,
      plotEngine,
    });
  };

  const selectedWorkflow = workflows.find((w: any) => w.id === selectedWorkflowId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">自动编排工作流</h1>
        <p className="text-gray-500 mt-1">从计划到报告/复盘的可恢复后端工作流，支持人工闸门与 AI 自主决策</p>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">选择项目</option>
              {projects.map((project: any) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">发起人</label>
            <input
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">集群类型</label>
            <select
              value={clusterType}
              onChange={(e) => setClusterType(e.target.value as 'slurm' | 'kubernetes' | 'ssh')}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="ssh">SSH/CPU</option>
              <option value="slurm">Slurm</option>
              <option value="kubernetes">Kubernetes</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">决策模式</label>
            <select
              value={decisionMode}
              onChange={(e) => setDecisionMode(e.target.value as 'human_in_loop' | 'autonomous')}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="human_in_loop">Human in the loop</option>
              <option value="autonomous">完全 AI 自主</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">最大实验数</label>
            <input
              type="number"
              min={1}
              max={200}
              value={maxExperiments}
              onChange={(e) => setMaxExperiments(Number(e.target.value) || 8)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">绘图引擎</label>
            <select
              value={plotEngine}
              onChange={(e) => setPlotEngine(e.target.value as 'auto' | 'matplotlib' | 'seaborn' | 'echarts' | 'r' | 'pdfkit')}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="auto">Auto</option>
              <option value="matplotlib">matplotlib</option>
              <option value="seaborn">seaborn</option>
              <option value="echarts">echarts</option>
              <option value="r">R</option>
              <option value="pdfkit">pdfkit</option>
            </select>
          </div>
        </div>

        <button
          onClick={onCreateWorkflow}
          disabled={!selectedProjectId || createMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          {createMutation.isPending ? '创建中...' : '启动自动工作流'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">工作流列表</h2>
          {workflowsLoading ? (
            <div className="text-gray-500 text-sm">加载中...</div>
          ) : workflows.length === 0 ? (
            <div className="text-gray-500 text-sm">暂无工作流</div>
          ) : (
            <div className="space-y-2 max-h-[520px] overflow-auto">
              {workflows.map((workflow: any) => (
                <button
                  key={workflow.id}
                  onClick={() => setSelectedWorkflowId(workflow.id)}
                  className={clsx(
                    'w-full text-left border rounded-lg p-3',
                    selectedWorkflowId === workflow.id ? 'border-primary-500 bg-primary-50' : 'hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{workflow.name}</span>
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[workflow.status])}>
                      {STATUS_LABELS[workflow.status] || workflow.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">step: {workflow.currentStep}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="xl:col-span-2 space-y-6">
          {!selectedWorkflow ? (
            <div className="bg-white border rounded-lg p-8 text-gray-500 text-sm">请选择一个工作流</div>
          ) : (
            <>
              <div className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="font-semibold text-gray-900">当前工作流</h2>
                    <div className="text-sm text-gray-500 mt-1">{selectedWorkflow.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => resumeMutation.mutate(selectedWorkflow.id)}
                      className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Resume
                    </button>
                    <button
                      onClick={() => cancelMutation.mutate(selectedWorkflow.id)}
                      className="inline-flex items-center gap-1 px-3 py-2 border rounded-lg text-red-700 hover:bg-red-50"
                    >
                      <Pause className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4 text-sm">
                  <StatCard icon={<Activity className="w-4 h-4 text-blue-600" />} label="状态" value={STATUS_LABELS[selectedWorkflow.status] || selectedWorkflow.status} />
                  <StatCard icon={<Clock className="w-4 h-4 text-amber-600" />} label="当前步骤" value={selectedWorkflow.currentStep} />
                  <StatCard icon={<Activity className="w-4 h-4 text-indigo-600" />} label="决策模式" value={selectedWorkflow.context?.decisionMode === 'autonomous' ? 'AI 自主' : 'HITL'} />
                  <StatCard icon={<CheckCircle2 className="w-4 h-4 text-green-600" />} label="报告 ID" value={selectedWorkflow.context?.reportId || '-'} />
                  <StatCard icon={<XCircle className="w-4 h-4 text-purple-600" />} label="Review ID" value={selectedWorkflow.context?.reviewId || '-'} />
                </div>
              </div>

              <div className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">HITL 闸门</h2>
                  <span className="text-xs text-gray-500">待处理 {pendingGates.length}</span>
                </div>

                {gates.length === 0 ? (
                  <div className="text-sm text-gray-500 mt-3">暂无闸门</div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {gates.map((gate: any) => (
                      <div key={gate.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-gray-900">{gate.title}</div>
                            <div className="text-xs text-gray-500 mt-1">{gate.step}</div>
                          </div>
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full', gate.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700')}>
                            {gate.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-2">{gate.question}</p>

                        {gate.status === 'pending' && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <select
                              value={gateSelection[gate.id] || gate.options?.[0] || ''}
                              onChange={(e) => setGateSelection((prev) => ({ ...prev, [gate.id]: e.target.value }))}
                              className="px-2 py-1 border rounded text-sm"
                            >
                              {(gate.options || []).map((option: string) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => resolveGateMutation.mutate({ gateId: gate.id, status: 'approved', selectedOption: gateSelection[gate.id] || gate.options?.[0] })}
                              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => resolveGateMutation.mutate({ gateId: gate.id, status: 'changes_requested', selectedOption: gateSelection[gate.id] || gate.options?.[0] })}
                              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700"
                            >
                              Changes
                            </button>
                            <button
                              onClick={() => resolveGateMutation.mutate({ gateId: gate.id, status: 'rejected' })}
                              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border rounded-lg p-4">
                <h2 className="font-semibold text-gray-900">事件流</h2>
                <div className="mt-3 max-h-[320px] overflow-auto space-y-2">
                  {events.length === 0 ? (
                    <div className="text-sm text-gray-500">暂无事件</div>
                  ) : (
                    events.map((event: any) => (
                      <div key={event.id} className="border rounded px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-gray-900">{event.type}</div>
                          <div className="text-xs text-gray-500">{new Date(event.createdAt).toLocaleString()}</div>
                        </div>
                        <div className="text-sm text-gray-600 mt-1">{event.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-gray-600">{icon}<span>{label}</span></div>
      <div className="text-sm font-medium text-gray-900 mt-1 truncate">{value}</div>
    </div>
  );
}
