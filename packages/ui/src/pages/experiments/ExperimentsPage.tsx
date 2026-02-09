import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Play, CheckCircle, XCircle, Clock } from 'lucide-react';
import { experimentsApi } from '@/api/client';

export default function ExperimentsPage() {
  const { data: experimentsData, isLoading } = useQuery({
    queryKey: ['experiments'],
    queryFn: () => experimentsApi.list(),
  });

  const experiments = experimentsData?.data || [];

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-4 h-4 text-gray-400" />,
    queued: <Clock className="w-4 h-4 text-yellow-500" />,
    running: <Play className="w-4 h-4 text-blue-500" />,
    completed: <CheckCircle className="w-4 h-4 text-green-500" />,
    failed: <XCircle className="w-4 h-4 text-red-500" />,
  };

  const statusLabels: Record<string, string> = {
    pending: '待处理',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">实验</h1>
        <p className="text-gray-500 mt-1">查看和管理所有实验</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : experiments.length === 0 ? (
        <div className="text-center py-12">
          <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">暂无实验</p>
          <p className="text-sm text-gray-400 mt-1">在项目中创建实验组后，实验将显示在这里</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">名称</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">配置</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">变量</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {experiments.map((exp: any) => (
                <tr key={exp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{exp.name}</div>
                    <div className="text-sm text-gray-500">{exp.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {statusIcons[exp.status]}
                      <span className="text-sm">{statusLabels[exp.status]}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-600">
                      {exp.config?.model?.name || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-600">
                      {Object.keys(exp.variables || {}).length} 个变量
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/experiments/${exp.id}`}
                      className="text-sm text-primary-600 hover:text-primary-700"
                    >
                      查看详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
