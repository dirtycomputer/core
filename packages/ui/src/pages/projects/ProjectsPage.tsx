import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderKanban } from 'lucide-react';
import { projectsApi } from '@/api/client';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface Project {
  id: string;
  name: string;
  description: string;
  researchGoal: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function ProjectsPage() {
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['projects', search],
    queryFn: () => projectsApi.list({ search: search || undefined }),
  });

  const projects: Project[] = data?.data || [];

  const statusColors: Record<string, string> = {
    planning: 'bg-yellow-100 text-yellow-800',
    active: 'bg-green-100 text-green-800',
    completed: 'bg-blue-100 text-blue-800',
    archived: 'bg-gray-100 text-gray-800',
  };

  const statusLabels: Record<string, string> = {
    planning: '规划中',
    active: '进行中',
    completed: '已完成',
    archived: '已归档',
  };

  return (
    <div>
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">项目</h1>
          <p className="text-gray-500 mt-1">管理您的研究项目</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          新建项目
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="搜索项目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* 项目列表 */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">加载中...</div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <FolderKanban className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">暂无项目</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 text-primary-600 hover:text-primary-700"
          >
            创建第一个项目
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="block bg-white rounded-lg border hover:shadow-md transition-shadow"
            >
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-gray-900">{project.name}</h3>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${statusColors[project.status]}`}
                  >
                    {statusLabels[project.status]}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                  {project.description || project.researchGoal || '暂无描述'}
                </p>
                <div className="mt-4 text-xs text-gray-400">
                  更新于{' '}
                  {formatDistanceToNow(new Date(project.updatedAt), {
                    addSuffix: true,
                    locale: zhCN,
                  })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 创建项目模态框 */}
      {showCreateModal && (
        <CreateProjectModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [researchGoal, setResearchGoal] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      projectsApi.create({
        name,
        description,
        researchGoal,
        ownerId: 'default-user', // TODO: 从认证上下文获取
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-lg mx-4">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">新建项目</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                项目名称 *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="输入项目名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                项目描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="简要描述项目"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                研究目标
              </label>
              <textarea
                value={researchGoal}
                onChange={(e) => setResearchGoal(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="描述您的研究目标，AI 将基于此生成实验计划"
              />
            </div>
          </div>
          <div className="p-4 border-t flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name || createMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
