import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, Eye, Trash2, ExternalLink } from 'lucide-react';
import { reportsApi, projectsApi } from '@/api/client';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export default function ReportsPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports', selectedProjectId],
    queryFn: () => reportsApi.list(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const projects = projectsData?.data || [];
  const reportsList = reports || [];

  const typeLabels: Record<string, string> = {
    experiment: '实验报告',
    ablation: '消融报告',
    comparison: '对比报告',
    final: '最终报告',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    generating: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  const statusLabels: Record<string, string> = {
    draft: '草稿',
    generating: '生成中',
    completed: '已完成',
    failed: '失败',
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">报告</h1>
        <p className="text-gray-500 mt-1">查看和下载实验报告</p>
      </div>

      {/* 项目选择 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          选择项目
        </label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">请选择项目</option>
          {projects.map((project: any) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      {/* 报告列表 */}
      {!selectedProjectId ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">请先选择一个项目</p>
        </div>
      ) : isLoading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : reportsList.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">该项目暂无报告</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">标题</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">类型</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">创建时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {reportsList.map((report: any) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{report.title}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600">
                      {typeLabels[report.type] || report.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${statusColors[report.status]}`}
                    >
                      {statusLabels[report.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-500">
                      {formatDistanceToNow(new Date(report.createdAt), {
                        addSuffix: true,
                        locale: zhCN,
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        className="p-1 text-gray-500 hover:text-gray-700"
                        title="预览"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <a
                        href={`/api/reports/${report.id}/overleaf`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 text-gray-500 hover:text-gray-700"
                        title="Open in Overleaf"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      {report.pdfPath && (
                        <a
                          href={report.pdfPath}
                          download
                          className="p-1 text-gray-500 hover:text-gray-700"
                          title="下载 PDF"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        className="p-1 text-red-500 hover:text-red-700"
                        title="删除"
                        onClick={() => reportsApi.delete(report.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
