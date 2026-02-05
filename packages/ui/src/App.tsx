import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProjectsPage from './pages/projects/ProjectsPage';
import ProjectDetailPage from './pages/projects/ProjectDetailPage';
import ExperimentsPage from './pages/experiments/ExperimentsPage';
import MonitorPage from './pages/monitor/MonitorPage';
import ReportsPage from './pages/reports/ReportsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="monitor" element={<MonitorPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
