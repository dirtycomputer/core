import { Outlet, NavLink } from 'react-router-dom';
import {
  FolderKanban,
  FlaskConical,
  Activity,
  FileText,
  Bell,
  Settings,
  Brain,
  Bot,
  Workflow,
  CalendarRange,
  Database,
  Library,
  FileSearch
} from 'lucide-react';
import { clsx } from 'clsx';

const navItems = [
  { to: '/projects', icon: FolderKanban, label: '项目' },
  { to: '/experiments', icon: FlaskConical, label: '实验' },
  { to: '/monitor', icon: Activity, label: '监控' },
  { to: '/reports', icon: FileText, label: '报告' },
  { to: '/deep-research', icon: Brain, label: 'DeepResearch' },
  { to: '/workflows', icon: Workflow, label: '工作流' },
  { to: '/roadmap', icon: CalendarRange, label: '日程' },
  { to: '/datasets', icon: Database, label: '数据集' },
  { to: '/library', icon: Library, label: '论文库' },
  { to: '/reviews', icon: FileSearch, label: 'Review' },
  { to: '/integrations/skill-seekers', icon: Bot, label: 'SkillSeekers' },
  { to: '/settings', icon: Settings, label: '设置' },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* 侧边栏 */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-xl font-bold">ROC</h1>
          <p className="text-xs text-gray-400">Research Orchestration Cockpit</p>
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-300 hover:bg-gray-800'
                    )
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="p-4 border-t border-gray-800">
          <div className="text-xs text-gray-500">
            v0.1.0
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部栏 */}
        <header className="h-14 bg-white border-b flex items-center justify-between px-6">
          <div></div>
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-gray-500 hover:text-gray-700">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
              U
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
