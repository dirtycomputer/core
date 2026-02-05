import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle, XCircle, Clock, Play } from 'lucide-react';
import { runsApi, alertsApi } from '@/api/client';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function MonitorPage() {
  const { data: activeRuns, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', 'active'],
    queryFn: () => runsApi.getActive(),
    refetchInterval: 5000, // 每 5 秒刷新
  });

  const { data: activeAlerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', 'active'],
    queryFn: () => alertsApi.getActive(),
    refetchInterval: 10000,
  });

  const runs = activeRuns || [];
  const alerts = activeAlerts || [];

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-5 h-5 text-gray-400" />,
    queued: <Clock className="w-5 h-5 text-yellow-500" />,
    running: <Play className="w-5 h-5 text-blue-500 animate-pulse" />,
    completed: <CheckCircle className="w-5 h-5 text-green-500" />,
    failed: <XCircle className="w-5 h-5 text-red-500" />,
  };

  const severityColors: Record<string, string> = {
    info: 'bg-blue-100 text-blue-800 border-blue-200',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    error: 'bg-red-100 text-red-800 border-red-200',
    critical: 'bg-red-200 text-red-900 border-red-300',
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">监控中心</h1>
        <p className="text-gray-500 mt-1">实时监控运行状态和告警</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 活跃运行 */}
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              活跃运行
            </h2>
            <span className="text-sm text-gray-500">{runs.length} 个运行中</span>
          </div>

          {runsLoading ? (
            <div className="p-8 text-center text-gray-500">加载中...</div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p>暂无活跃运行</p>
            </div>
          ) : (
            <div className="divide-y max-h-96 overflow-auto">
              {runs.map((run: any) => (
                <div key={run.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {statusIcons[run.status]}
                      <div>
                        <div className="font-medium text-gray-900">
                          Run #{run.attempt}
                        </div>
                        <div className="text-sm text-gray-500">
                          {run.clusterType} - {run.clusterJobId || 'N/A'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">
                        {run.startTime
                          ? formatDistanceToNow(new Date(run.startTime), {
                              addSuffix: true,
                              locale: zhCN,
                            })
                          : '未开始'}
                      </div>
                      {run.metrics?.loss !== undefined && (
                        <div className="text-xs text-gray-400">
                          Loss: {run.metrics.loss.toFixed(4)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 活跃告警 */}
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              活跃告警
            </h2>
            <span className="text-sm text-gray-500">{alerts.length} 个告警</span>
          </div>

          {alertsLoading ? (
            <div className="p-8 text-center text-gray-500">加载中...</div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
              <p>暂无告警</p>
            </div>
          ) : (
            <div className="divide-y max-h-96 overflow-auto">
              {alerts.map((alert: any) => (
                <div
                  key={alert.id}
                  className={`p-4 border-l-4 ${severityColors[alert.severity]}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{alert.title}</div>
                      <div className="text-sm mt-1">{alert.message}</div>
                    </div>
                    <button
                      className="text-sm text-gray-500 hover:text-gray-700"
                      onClick={() => alertsApi.acknowledge(alert.id)}
                    >
                      确认
                    </button>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {formatDistanceToNow(new Date(alert.createdAt), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
