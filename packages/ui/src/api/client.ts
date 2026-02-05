import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// 项目 API
export const projectsApi = {
  list: (params?: { ownerId?: string; status?: string; search?: string }) =>
    api.get('/projects', { params }).then((res) => res.data),

  get: (id: string) => api.get(`/projects/${id}`).then((res) => res.data),

  create: (data: {
    name: string;
    description?: string;
    researchGoal?: string;
    ownerId: string;
  }) => api.post('/projects', data).then((res) => res.data),

  update: (id: string, data: Partial<{ name: string; description: string; status: string }>) =>
    api.patch(`/projects/${id}`, data).then((res) => res.data),

  delete: (id: string) => api.delete(`/projects/${id}`),
};

// 实验组 API
export const experimentGroupsApi = {
  list: (params?: { projectId?: string; status?: string }) =>
    api.get('/experiment-groups', { params }).then((res) => res.data),

  get: (id: string) => api.get(`/experiment-groups/${id}`).then((res) => res.data),

  create: (data: {
    projectId: string;
    name: string;
    type?: string;
    hypothesis?: string;
  }) => api.post('/experiment-groups', data).then((res) => res.data),

  update: (id: string, data: Partial<{ name: string; status: string }>) =>
    api.patch(`/experiment-groups/${id}`, data).then((res) => res.data),

  approve: (id: string, approverId: string) =>
    api.post(`/experiment-groups/${id}/approve`, { approverId }).then((res) => res.data),

  delete: (id: string) => api.delete(`/experiment-groups/${id}`),
};

// 实验 API
export const experimentsApi = {
  list: (params?: { groupId?: string; status?: string }) =>
    api.get('/experiments', { params }).then((res) => res.data),

  get: (id: string) => api.get(`/experiments/${id}`).then((res) => res.data),

  create: (data: {
    groupId: string;
    name: string;
    config: Record<string, unknown>;
  }) => api.post('/experiments', data).then((res) => res.data),

  createBatch: (experiments: Array<{ groupId: string; name: string; config: Record<string, unknown> }>) =>
    api.post('/experiments/batch', { experiments }).then((res) => res.data),

  update: (id: string, data: Partial<{ name: string; status: string }>) =>
    api.patch(`/experiments/${id}`, data).then((res) => res.data),

  delete: (id: string) => api.delete(`/experiments/${id}`),
};

// 运行 API
export const runsApi = {
  list: (params?: { experimentId?: string; status?: string }) =>
    api.get('/runs', { params }).then((res) => res.data),

  getActive: () => api.get('/runs/active').then((res) => res.data),

  get: (id: string) => api.get(`/runs/${id}`).then((res) => res.data),

  create: (data: { experimentId: string; clusterType: string }) =>
    api.post('/runs', data).then((res) => res.data),

  update: (id: string, data: Partial<{ status: string }>) =>
    api.patch(`/runs/${id}`, data).then((res) => res.data),

  logMetrics: (id: string, metrics: Record<string, number>, step: number) =>
    api.post(`/runs/${id}/metrics`, { metrics, step }),

  getMetrics: (id: string, name?: string) =>
    api.get(`/runs/${id}/metrics`, { params: { name } }).then((res) => res.data),

  cancel: (id: string) => api.post(`/runs/${id}/cancel`),
};

// 集群 API
export const clustersApi = {
  detect: () => api.get('/clusters/detect').then((res) => res.data),

  submit: (job: Record<string, unknown>, clusterType?: string) =>
    api.post('/clusters/submit', { job, clusterType }).then((res) => res.data),

  getStatus: (type: string, jobId: string) =>
    api.get(`/clusters/${type}/jobs/${jobId}/status`).then((res) => res.data),

  getLogs: (type: string, jobId: string, tail?: number) =>
    api.get(`/clusters/${type}/jobs/${jobId}/logs`, { params: { tail } }).then((res) => res.data),
};

// AI API
export const aiApi = {
  generatePlan: (data: {
    projectName: string;
    researchGoal: string;
    constraints?: Record<string, unknown>;
  }) => api.post('/ai/plan', data).then((res) => res.data),

  generateAblationPlan: (baseExperiment: Record<string, unknown>, components: string[]) =>
    api.post('/ai/ablation-plan', { baseExperiment, components }).then((res) => res.data),

  generateHyperparameterGrid: (baseConfig: Record<string, unknown>, searchSpace: Record<string, unknown[]>) =>
    api.post('/ai/hyperparameter-grid', { baseConfig, searchSpace }).then((res) => res.data),

  analyze: (data: {
    projectName: string;
    researchGoal: string;
    results: Array<Record<string, unknown>>;
  }) => api.post('/ai/analyze', data).then((res) => res.data),
};

// 报告 API
export const reportsApi = {
  list: (projectId: string) =>
    api.get('/reports', { params: { projectId } }).then((res) => res.data),

  get: (id: string) => api.get(`/reports/${id}`).then((res) => res.data),

  generate: (data: {
    projectId: string;
    type: string;
    data: Record<string, unknown>;
  }) => api.post('/reports', data).then((res) => res.data),

  delete: (id: string) => api.delete(`/reports/${id}`),
};

// 告警 API
export const alertsApi = {
  getActive: () => api.get('/alerts/active').then((res) => res.data),

  getByRun: (runId: string) => api.get(`/runs/${runId}/alerts`).then((res) => res.data),

  acknowledge: (id: string) => api.post(`/alerts/${id}/acknowledge`),

  resolve: (id: string) => api.post(`/alerts/${id}/resolve`),
};

export default api;
