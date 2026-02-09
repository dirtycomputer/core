import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, Play, CheckCircle, XCircle } from 'lucide-react';
import { experimentsApi, runsApi } from '@/api/client';

const statusLabels: Record<string, string> = {
  pending: '待处理',
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const runStatusIcon = (status: string) => {
  if (status === 'running') return <Play className="w-4 h-4 text-blue-500" />;
  if (status === 'completed') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'failed') return <XCircle className="w-4 h-4 text-red-500" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
};

export default function ExperimentDetailPage() {
  const { experimentId } = useParams<{ experimentId: string }>();

  const { data: experiment, isLoading: expLoading } = useQuery({
    queryKey: ['experiment', experimentId],
    queryFn: () => experimentsApi.get(experimentId!),
    enabled: !!experimentId,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', experimentId],
    queryFn: () => runsApi.list({ experimentId }),
    enabled: !!experimentId,
  });

  if (expLoading) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  if (!experiment) {
    return <div className="text-center py-12 text-gray-500">实验不存在</div>;
  }

  const runs = runsData?.data || [];

  return (
    <div className="space-y-6">
      <Link
        to="/experiments"
        className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" />
        返回实验列表
      </Link>

      <div className="bg-white rounded-lg border p-6">
        <h1 className="text-2xl font-bold text-gray-900">{experiment.name}</h1>
        <p className="text-gray-500 mt-1">{experiment.description || '暂无描述'}</p>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-gray-500">状态</div>
            <div className="mt-1 font-medium text-gray-900">
              {statusLabels[experiment.status] || experiment.status}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-gray-500">模型</div>
            <div className="mt-1 font-medium text-gray-900">
              {experiment.config?.model?.name || '-'}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <h2 className="font-semibold text-gray-900 mb-2">实验变量</h2>
          <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-auto">
            {JSON.stringify(experiment.variables || {}, null, 2)}
          </pre>
        </div>

        <div className="mt-4">
          <h2 className="font-semibold text-gray-900 mb-2">实验配置</h2>
          <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-auto">
            {JSON.stringify(experiment.config || {}, null, 2)}
          </pre>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="font-semibold text-gray-900 mb-4">运行记录</h2>
        {runsLoading ? (
          <div className="text-gray-500">加载中...</div>
        ) : runs.length === 0 ? (
          <div className="text-gray-500">暂无运行记录</div>
        ) : (
          <div className="space-y-3">
            {runs.map((run: any) => (
              <div key={run.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {runStatusIcon(run.status)}
                    <span className="font-medium text-gray-900">{run.id}</span>
                  </div>
                  <span className="text-sm text-gray-500">
                    {statusLabels[run.status] || run.status}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  集群: {run.clusterType} {run.clusterJobId ? `| Job: ${run.clusterJobId}` : ''}
                </div>
                <pre className="mt-2 bg-gray-50 border rounded p-2 text-xs overflow-auto">
                  {JSON.stringify(run.metrics || {}, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
