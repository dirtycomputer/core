import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProjectsPage from './pages/projects/ProjectsPage';
import ProjectDetailPage from './pages/projects/ProjectDetailPage';
import ExperimentsPage from './pages/experiments/ExperimentsPage';
import ExperimentDetailPage from './pages/experiments/ExperimentDetailPage';
import MonitorPage from './pages/monitor/MonitorPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import DeepResearchPage from './pages/research/DeepResearchPage';
import SkillSeekersPage from './pages/integrations/SkillSeekersPage';
import WorkflowsPage from './pages/workflows/WorkflowsPage';
import RoadmapPage from './pages/roadmap/RoadmapPage';
import DatasetsPage from './pages/datasets/DatasetsPage';
import LibraryPage from './pages/library/LibraryPage';
import ReviewsPage from './pages/reviews/ReviewsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="experiments" element={<ExperimentsPage />} />
        <Route path="experiments/:experimentId" element={<ExperimentDetailPage />} />
        <Route path="monitor" element={<MonitorPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="deep-research" element={<DeepResearchPage />} />
        <Route path="integrations/skill-seekers" element={<SkillSeekersPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="roadmap" element={<RoadmapPage />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
