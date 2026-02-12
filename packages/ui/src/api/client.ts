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

  deepResearch: (data: {
    query: string;
    maxResults?: number;
    topic?: 'general' | 'news' | 'finance';
  }) => api.post('/ai/deep-research', data).then((res) => res.data),
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
    autoPlot?: {
      enabled?: boolean;
      engine?: 'auto' | 'matplotlib' | 'seaborn' | 'echarts' | 'r' | 'pdfkit';
      charts?: Array<'accuracy_bar' | 'loss_bar' | 'accuracy_loss_scatter'>;
      titlePrefix?: string;
    };
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

// 设置 API
export const settingsApi = {
  getLLMConfig: () => api.get('/settings/llm').then((res) => res.data),

  updateLLMConfig: (data: {
    provider?: 'openai' | 'anthropic';
    apiKey?: string;
    tavilyApiKey?: string;
    baseUrl?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }) => api.put('/settings/llm', data).then((res) => res.data),

  testLLMConnection: () => api.post('/settings/llm/test').then((res) => res.data),
  testTavilyConnection: () => api.post('/settings/tavily/test').then((res) => res.data),
};

// Skill Seekers 集成 API
export const skillSeekersApi = {
  getStatus: () => api.get('/integrations/skill-seekers/status').then((res) => res.data),
  syncRepo: (data?: { branch?: string }) =>
    api.post('/integrations/skill-seekers/sync', data || {}).then((res) => res.data),
  listConfigs: () =>
    api.get('/integrations/skill-seekers/configs').then((res) => res.data as {
      total: number;
      data: Array<{
        configPath: string;
        name: string;
        description: string;
        category: string;
        type: string;
        source: 'local' | 'remote';
      }>;
    }),
  buildImage: (data?: { force?: boolean }) =>
    api.post('/integrations/skill-seekers/build-image', data || {}).then((res) => res.data),
  runScrape: (data: {
    configPath: string;
    maxPages?: number;
    buildImage?: boolean;
    verbose?: boolean;
  }) => api.post('/integrations/skill-seekers/run-scrape', data).then((res) => res.data),
  createCustomConfig: (data: {
    name: string;
    description?: string;
    sourceType: 'documentation' | 'github';
    baseUrl?: string;
    repo?: string;
    maxPages?: number;
    configPath?: string;
  }) => api.post('/integrations/skill-seekers/custom-configs', data).then((res) => res.data),
};

// 自动工作流 API
export const workflowsApi = {
  createAuto: (data: {
    projectId: string;
    name?: string;
    requestedBy?: string;
    decisionMode?: 'human_in_loop' | 'autonomous';
    clusterType?: 'slurm' | 'kubernetes' | 'ssh';
    maxExperiments?: number;
    plotEngine?: 'auto' | 'matplotlib' | 'seaborn' | 'echarts' | 'r' | 'pdfkit';
  }) => api.post('/workflows/auto', data).then((res) => res.data),

  list: (params?: { projectId?: string; status?: string }) =>
    api.get('/workflows', { params }).then((res) => res.data),

  get: (id: string) => api.get(`/workflows/${id}`).then((res) => res.data),

  events: (id: string, limit?: number) =>
    api.get(`/workflows/${id}/events`, { params: { limit } }).then((res) => res.data),

  cancel: (id: string) => api.post(`/workflows/${id}/cancel`).then((res) => res.data),

  resume: (id: string) => api.post(`/workflows/${id}/resume`).then((res) => res.data),

  gates: (id: string) => api.get(`/workflows/${id}/gates`).then((res) => res.data),

  resolveGate: (
    workflowId: string,
    gateId: string,
    data: {
      status: 'approved' | 'rejected' | 'changes_requested' | 'timeout';
      selectedOption?: string;
      comment?: string;
      resolvedBy?: string;
    }
  ) => api.post(`/workflows/${workflowId}/gates/${gateId}/resolve`, data).then((res) => res.data),
};

// 项目日程 API
export const scheduleApi = {
  getProjectSchedule: (projectId: string) =>
    api.get(`/projects/${projectId}/schedule`).then((res) => res.data),

  createMilestone: (projectId: string, data: {
    title: string;
    description?: string;
    dueDate?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'blocked';
    position?: number;
    owner?: string;
  }) => api.post(`/projects/${projectId}/milestones`, data).then((res) => res.data),

  updateMilestone: (milestoneId: string, data: Partial<{
    title: string;
    description: string;
    dueDate: string | null;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked';
    position: number;
    owner: string | null;
  }>) => api.patch(`/milestones/${milestoneId}`, data).then((res) => res.data),

  createTask: (milestoneId: string, data: {
    workflowId?: string;
    title: string;
    description?: string;
    status?: 'todo' | 'in_progress' | 'waiting_review' | 'done' | 'blocked';
    assignee?: string;
    dueDate?: string;
    dependencyTaskId?: string;
    blockingReason?: string;
    position?: number;
  }) => api.post(`/milestones/${milestoneId}/tasks`, data).then((res) => res.data),

  updateTask: (taskId: string, data: Partial<{
    title: string;
    description: string;
    status: 'todo' | 'in_progress' | 'waiting_review' | 'done' | 'blocked';
    assignee: string | null;
    dueDate: string | null;
    dependencyTaskId: string | null;
    blockingReason: string | null;
    position: number;
  }>) => api.patch(`/schedule-tasks/${taskId}`, data).then((res) => res.data),
};

// 数据集 API
export const datasetsApi = {
  search: (data: { query: string; maxResults?: number }) =>
    api.post('/datasets/search', data).then((res) => res.data),

  list: (params?: { projectId?: string }) =>
    api.get('/datasets', { params }).then((res) => res.data),

  get: (id: string) => api.get(`/datasets/${id}`).then((res) => res.data),

  create: (data: {
    projectId?: string;
    name: string;
    source?: string;
    description?: string;
    license?: string;
    homepage?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    status?: 'discovered' | 'curated' | 'ready' | 'archived';
  }) => api.post('/datasets', data).then((res) => res.data),

  update: (id: string, data: Partial<{
    name: string;
    source: string;
    description: string;
    license: string;
    homepage: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    status: 'discovered' | 'curated' | 'ready' | 'archived';
  }>) => api.patch(`/datasets/${id}`, data).then((res) => res.data),

  versions: (id: string) => api.get(`/datasets/${id}/versions`).then((res) => res.data),

  construct: (id: string, data: {
    version: string;
    splitInfo?: Record<string, unknown>;
    buildRecipe?: Record<string, unknown>;
    syntheticRows?: Array<Record<string, unknown>>;
  }) => api.post(`/datasets/${id}/construct`, data).then((res) => res.data),

  analyze: (id: string, data?: {
    sampleRows?: Array<Record<string, unknown>>;
    labelField?: string;
    maxRows?: number;
  }) => api.post(`/datasets/${id}/analyze`, data || {}).then((res) => res.data),

  strategy: (id: string, data?: {
    sampleRows?: Array<Record<string, unknown>>;
    labelField?: string;
    targetTask?: string;
    preferredVersion?: string;
  }) => api.post(`/datasets/${id}/construct-strategy`, data || {}).then((res) => res.data),
};

// 阅读代理 / 论文库 API
export const readingApi = {
  search: (data: { query: string; maxResults?: number }) =>
    api.post('/reading/search', data).then((res) => res.data),

  listPapers: (params?: { projectId?: string }) =>
    api.get('/reading/papers', { params }).then((res) => res.data),

  getPaper: (id: string) => api.get(`/reading/papers/${id}`).then((res) => res.data),

  createPaper: (data: {
    projectId?: string;
    title: string;
    authors?: string[];
    venue?: string;
    year?: number;
    doi?: string;
    url?: string;
    pdfUrl?: string;
    abstract?: string;
    tags?: string[];
    notes?: string;
    metadata?: Record<string, unknown>;
    status?: 'discovered' | 'downloaded' | 'archived';
  }) => api.post('/reading/papers', data).then((res) => res.data),

  updatePaper: (id: string, data: Partial<{
    title: string;
    authors: string[];
    venue: string | null;
    year: number | null;
    doi: string | null;
    url: string | null;
    pdfUrl: string | null;
    abstract: string | null;
    tags: string[];
    notes: string | null;
    status: 'discovered' | 'downloaded' | 'archived';
    localPdfPath: string | null;
    metadata: Record<string, unknown>;
  }>) => api.patch(`/reading/papers/${id}`, data).then((res) => res.data),

  deletePaper: (id: string) => api.delete(`/reading/papers/${id}`),

  downloadPdf: (id: string) => api.post(`/reading/papers/${id}/download`).then((res) => res.data),

  pdfUrl: (id: string) => `/api/reading/papers/${id}/pdf`,

  summarize: (id: string) => api.post(`/reading/papers/${id}/summarize`).then((res) => res.data),

  extract: (id: string, data?: {
    engine?: 'auto' | 'mineru' | 'glm_ocr' | 'deepseek_ocr' | 'fallback';
    maxPages?: number;
    force?: boolean;
  }) => api.post(`/reading/papers/${id}/extract`, data || {}).then((res) => res.data),

  blog: (id: string, data?: {
    style?: 'alpharxiv' | 'technical' | 'plain';
    language?: 'zh' | 'en';
    force?: boolean;
  }) => api.post(`/reading/papers/${id}/blog`, data || {}).then((res) => res.data),
};

// 审稿与复盘 API
export const reviewsApi = {
  generate: (data: {
    projectId: string;
    workflowId?: string;
    reportId?: string;
    title?: string;
  }) => api.post('/reviews/generate', data).then((res) => res.data),

  list: (projectId: string) => api.get('/reviews', { params: { projectId } }).then((res) => res.data),

  get: (id: string) => api.get(`/reviews/${id}`).then((res) => res.data),
};

export default api;
