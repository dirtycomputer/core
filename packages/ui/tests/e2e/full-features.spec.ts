import { test, expect, type Page, type Request } from '@playwright/test';

type MockState = ReturnType<typeof createMockState>;

function nowIso(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

function createMockState() {
  const projectId = 'p1';
  const workflowId = 'wf1';
  const reportId = 'rep1';
  const reviewId = 'rev1';
  const datasetId = 'd1';
  const paperId = 'paper1';

  return {
    projects: [
      {
        id: projectId,
        name: '示例科研项目',
        description: '用于端到端测试',
        researchGoal: '提升模型准确率并降低推理成本',
        status: 'active',
        createdAt: nowIso(-240),
        updatedAt: nowIso(-5),
      },
    ],
    experimentGroups: [
      {
        id: 'g1',
        projectId,
        name: '基线组',
        type: 'baseline',
        hypothesis: '监督微调作为基线',
        status: 'approved',
        createdAt: nowIso(-180),
      },
    ],
    experiments: [
      {
        id: 'e1',
        groupId: 'g1',
        name: 'Baseline-Run',
        description: '基线实验',
        status: 'running',
        config: { model: { name: 'gpt-4o' }, train: { lr: 0.0001 } },
        variables: { lr: 0.0001, batchSize: 8 },
        createdAt: nowIso(-170),
        updatedAt: nowIso(-10),
      },
    ],
    runs: [
      {
        id: 'r1',
        experimentId: 'e1',
        attempt: 1,
        clusterType: 'ssh',
        clusterJobId: 'job-001',
        status: 'running',
        startTime: nowIso(-60),
        metrics: { loss: 0.1234, accuracy: 0.87 },
        createdAt: nowIso(-60),
        updatedAt: nowIso(-1),
      },
      {
        id: 'r2',
        experimentId: 'e1',
        attempt: 2,
        clusterType: 'ssh',
        clusterJobId: 'job-002',
        status: 'completed',
        startTime: nowIso(-120),
        endTime: nowIso(-90),
        metrics: { loss: 0.09, accuracy: 0.9 },
        createdAt: nowIso(-120),
        updatedAt: nowIso(-90),
      },
    ],
    alerts: [
      {
        id: 'a1',
        runId: 'r1',
        severity: 'warning',
        status: 'active',
        title: 'Loss 波动告警',
        message: '最近 5 个 step 中 loss 波动超过阈值',
        createdAt: nowIso(-15),
      },
    ],
    reports: [
      {
        id: reportId,
        projectId,
        type: 'final',
        title: '最终实验报告',
        status: 'completed',
        createdAt: nowIso(-100),
        updatedAt: nowIso(-95),
        pdfPath: '/tmp/final-report.pdf',
      },
    ],
    workflows: [
      {
        id: workflowId,
        projectId,
        name: '自动科研编排-1',
        status: 'waiting_human',
        currentStep: 'hitl_direction',
        context: {
          decisionMode: 'human_in_loop',
          reportId,
          reviewId,
        },
        createdAt: nowIso(-110),
        updatedAt: nowIso(-2),
      },
    ],
    workflowEvents: {
      [workflowId]: [
        {
          id: 'we1',
          workflowId,
          type: 'workflow.created',
          message: 'Workflow started',
          createdAt: nowIso(-110),
        },
        {
          id: 'we2',
          workflowId,
          type: 'workflow.waiting_human',
          message: 'Waiting for human decision',
          createdAt: nowIso(-3),
        },
      ],
    } as Record<string, any[]>,
    workflowGates: {
      [workflowId]: [
        {
          id: 'gate1',
          workflowId,
          step: 'hitl_direction',
          title: '方向确认',
          question: '是否继续执行当前实验方向？',
          options: ['approve_plan', 'request_changes'],
          status: 'pending',
          selectedOption: null,
          comment: null,
          requestedAt: nowIso(-5),
          createdAt: nowIso(-5),
          updatedAt: nowIso(-5),
        },
      ],
    } as Record<string, any[]>,
    milestones: [
      {
        id: 'm1',
        projectId,
        title: '数据准备',
        description: '完成数据清洗与切分',
        dueDate: nowIso(24 * 60),
        status: 'in_progress',
        createdAt: nowIso(-200),
        updatedAt: nowIso(-10),
        tasks: [
          {
            id: 't1',
            milestoneId: 'm1',
            workflowId,
            title: '准备数据',
            description: '合并标注并校验 schema',
            status: 'todo',
            dueDate: nowIso(10 * 60),
            createdAt: nowIso(-180),
            updatedAt: nowIso(-20),
          },
        ],
      },
    ] as any[],
    datasets: [
      {
        id: datasetId,
        projectId,
        name: 'demo-dataset',
        source: 'huggingface',
        description: '演示数据集',
        license: 'mit',
        homepage: 'https://example.com/dataset',
        tags: ['nlp'],
        metadata: {},
        status: 'curated',
        createdAt: nowIso(-300),
        updatedAt: nowIso(-10),
      },
    ] as any[],
    datasetVersions: {
      [datasetId]: [
        {
          id: 'dv1',
          datasetId,
          version: 'v1',
          splitInfo: { train: 0.8, validation: 0.1, test: 0.1 },
          filePath: '/tmp/dataset/v1',
          checksum: 'abc',
          sizeBytes: 1234,
          buildRecipe: { strategy: 'manual' },
          createdAt: nowIso(-200),
        },
      ],
    } as Record<string, any[]>,
    papers: [
      {
        id: paperId,
        projectId,
        title: 'A Retrieval Study',
        authors: ['Alice', 'Bob'],
        venue: 'arXiv',
        year: 2025,
        url: 'https://example.com/paper',
        pdfUrl: 'https://example.com/paper.pdf',
        localPdfPath: '/tmp/paper1.pdf',
        abstract: 'This paper studies retrieval augmentation.',
        tags: ['retrieval'],
        notes: '',
        status: 'downloaded',
        metadata: {},
        createdAt: nowIso(-200),
        updatedAt: nowIso(-10),
      },
    ] as any[],
    reviews: [
      {
        id: reviewId,
        projectId,
        workflowId,
        reportId,
        title: 'Review #1',
        review: {
          overallScore: 8.1,
          novelty: 7.6,
          soundness: 8.4,
          reproducibility: 8.0,
          clarity: 8.5,
          decision: 'weak_accept',
          strengths: ['指标提升明显', '实验覆盖完整'],
          weaknesses: ['资源成本偏高'],
          suggestions: ['补充更细粒度消融'],
        },
        retrospective: {
          summary: '本轮实验完成度较高，建议进一步优化资源效率。',
          whatWorked: ['自动编排稳定执行', '报告产出完整'],
          whatDidNotWork: ['部分参数搜索空间过大'],
          actionItems: [{ action: '缩小下一轮搜索空间', priority: 'high' }],
        },
        createdAt: nowIso(-80),
        updatedAt: nowIso(-70),
      },
    ] as any[],
    settings: {
      provider: 'openai',
      baseUrl: '',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0.7,
      hasApiKey: true,
      hasTavilyApiKey: true,
    },
    skillSeekersStatus: {
      repoPath: '/tmp/skill_seekers',
      outputPath: '/tmp/skill_seekers_output',
      imageTag: 'roc-skill-seekers:latest',
      repoReady: true,
      dockerAvailable: true,
      imageAvailable: true,
      pythonAvailable: true,
      pythonVersion: '3.11',
      configsCount: 2,
    },
    skillConfigs: [
      {
        configPath: 'configs/defaults/general.json',
        name: 'General Docs',
        description: 'General documentation scraping',
        category: 'general',
        type: 'documentation',
        source: 'local',
      },
      {
        configPath: 'configs/github/owner_repo.json',
        name: 'Owner Repo',
        description: 'GitHub repo skill',
        category: 'github',
        type: 'github',
        source: 'local',
      },
    ] as any[],
    skillLastRunCounter: 1,
  };
}

function buildSchedulePayload(state: MockState, projectId: string) {
  const milestones = state.milestones.filter((m) => m.projectId === projectId);
  const allTasks = milestones.flatMap((m) => m.tasks || []);
  const doneTasks = allTasks.filter((t: any) => t.status === 'done').length;
  const inProgressTasks = allTasks.filter((t: any) => t.status === 'in_progress').length;
  const blockedTasks = allTasks.filter((t: any) => t.status === 'blocked').length;
  const completionRate = allTasks.length === 0 ? 0 : Math.round((doneTasks / allTasks.length) * 100);

  return {
    projectId,
    milestones,
    progress: {
      totalTasks: allTasks.length,
      doneTasks,
      inProgressTasks,
      blockedTasks,
      completionRate,
    },
  };
}

function json(route: any, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function requestBody(request: Request): any {
  try {
    return request.postDataJSON();
  } catch {
    return {};
  }
}

async function installApiMocks(page: Page): Promise<MockState> {
  const state = createMockState();

  await page.route((url) => url.pathname.startsWith('/api/'), async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // projects
    if (path === '/api/projects' && method === 'GET') {
      return json(route, { data: state.projects });
    }
    if (path === '/api/projects' && method === 'POST') {
      const body = requestBody(request);
      const created = {
        id: `p-${Date.now()}`,
        name: body.name || '新项目',
        description: body.description || '',
        researchGoal: body.researchGoal || '',
        status: 'planning',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.projects.unshift(created);
      return json(route, created, 201);
    }
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && method === 'GET') {
      const found = state.projects.find((p) => p.id === projectMatch[1]);
      return found ? json(route, found) : json(route, { error: 'Project not found' }, 404);
    }

    // experiment groups
    if (path === '/api/experiment-groups' && method === 'GET') {
      const pid = url.searchParams.get('projectId');
      const data = pid ? state.experimentGroups.filter((g) => g.projectId === pid) : state.experimentGroups;
      return json(route, { data });
    }
    if (path === '/api/experiment-groups' && method === 'POST') {
      const body = requestBody(request);
      const created = {
        id: `g-${Date.now()}`,
        projectId: body.projectId,
        name: body.name || '自动实验组',
        type: body.type || 'exploration',
        hypothesis: body.hypothesis || '',
        status: 'draft',
        createdAt: nowIso(),
      };
      state.experimentGroups.unshift(created);
      return json(route, created, 201);
    }

    // experiments
    if (path === '/api/experiments' && method === 'GET') {
      const gid = url.searchParams.get('groupId');
      const data = gid ? state.experiments.filter((e) => e.groupId === gid) : state.experiments;
      return json(route, { data });
    }
    const experimentMatch = path.match(/^\/api\/experiments\/([^/]+)$/);
    if (experimentMatch && method === 'GET') {
      const found = state.experiments.find((e) => e.id === experimentMatch[1]);
      return found ? json(route, found) : json(route, { error: 'Experiment not found' }, 404);
    }

    // runs
    if (path === '/api/runs' && method === 'GET') {
      const experimentId = url.searchParams.get('experimentId');
      const data = experimentId ? state.runs.filter((r) => r.experimentId === experimentId) : state.runs;
      return json(route, { data });
    }
    if (path === '/api/runs/active' && method === 'GET') {
      return json(route, state.runs.filter((r) => r.status === 'running' || r.status === 'queued'));
    }

    // alerts
    if (path === '/api/alerts/active' && method === 'GET') {
      return json(route, state.alerts.filter((a) => a.status === 'active'));
    }
    const alertAckMatch = path.match(/^\/api\/alerts\/([^/]+)\/acknowledge$/);
    if (alertAckMatch && method === 'POST') {
      state.alerts = state.alerts.map((a) => (a.id === alertAckMatch[1] ? { ...a, status: 'acknowledged' } : a));
      return route.fulfill({ status: 204, body: '' });
    }

    // ai
    if (path === '/api/ai/plan' && method === 'POST') {
      return json(route, {
        summary: '自动生成了基线与改进两组实验。',
        experimentGroups: [
          {
            name: '自动基线组',
            type: 'baseline',
            hypothesis: '以当前配置作为对照',
            experiments: [{ name: 'baseline-1' }],
          },
          {
            name: '自动改进组',
            type: 'improvement',
            hypothesis: '加入改进模块提升指标',
            experiments: [{ name: 'improvement-1' }],
          },
        ],
        estimatedResources: {
          totalGpuHours: 12,
          experimentsCount: 2,
        },
      });
    }
    if (path === '/api/ai/deep-research' && method === 'POST') {
      const body = requestBody(request);
      return json(route, {
        mode: 'fallback',
        query: body.query || '',
        report: '1) 当前方案可行\n2) 需关注部署成本\n3) 推荐逐步上线',
        notes: ['mocked deep research'],
      });
    }

    // reports
    if (path === '/api/reports' && method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      return json(route, state.reports.filter((r) => r.projectId === projectId));
    }
    const reportDeleteMatch = path.match(/^\/api\/reports\/([^/]+)$/);
    if (reportDeleteMatch && method === 'DELETE') {
      state.reports = state.reports.filter((r) => r.id !== reportDeleteMatch[1]);
      return route.fulfill({ status: 204, body: '' });
    }
    const reportOverleafMatch = path.match(/^\/api\/reports\/([^/]+)\/overleaf$/);
    if (reportOverleafMatch && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>redirecting to overleaf</body></html>',
      });
    }

    // settings
    if (path === '/api/settings/llm' && method === 'GET') {
      return json(route, state.settings);
    }
    if (path === '/api/settings/llm' && method === 'PUT') {
      const body = requestBody(request);
      state.settings = { ...state.settings, ...body };
      return json(route, { success: true });
    }
    if (path === '/api/settings/llm/test' && method === 'POST') {
      return json(route, { success: true, message: 'API 连接成功' });
    }
    if (path === '/api/settings/tavily/test' && method === 'POST') {
      return json(route, { success: true, message: 'Tavily API 连接成功' });
    }

    // skill seekers
    if (path === '/api/integrations/skill-seekers/status' && method === 'GET') {
      state.skillSeekersStatus.configsCount = state.skillConfigs.length;
      return json(route, state.skillSeekersStatus);
    }
    if (path === '/api/integrations/skill-seekers/configs' && method === 'GET') {
      return json(route, { total: state.skillConfigs.length, data: state.skillConfigs });
    }
    if (path === '/api/integrations/skill-seekers/sync' && method === 'POST') {
      state.skillSeekersStatus.repoReady = true;
      return json(route, state.skillSeekersStatus);
    }
    if (path === '/api/integrations/skill-seekers/build-image' && method === 'POST') {
      state.skillSeekersStatus.imageAvailable = true;
      return json(route, {
        imageTag: state.skillSeekersStatus.imageTag,
        built: true,
        logs: 'mock build logs',
      });
    }
    if (path === '/api/integrations/skill-seekers/run-scrape' && method === 'POST') {
      const body = requestBody(request);
      const runId = `ss-${state.skillLastRunCounter++}`;
      return json(route, {
        runId,
        outputDir: `/tmp/skillseekers/${runId}`,
        expectedSkillDir: `/tmp/skillseekers/${runId}/output`,
        command: `docker run mock --config ${body.configPath}`,
        durationMs: 1200,
        stdoutTail: 'mock stdout',
        stderrTail: '',
      });
    }
    if (path === '/api/integrations/skill-seekers/custom-configs' && method === 'POST') {
      const body = requestBody(request);
      const slug = String(body.name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const created = {
        configPath: `configs/custom/${slug}.json`,
        name: body.name,
        description: body.description || '',
        category: 'custom',
        type: body.sourceType,
        source: 'local',
      };
      state.skillConfigs.unshift(created);
      return json(route, created, 201);
    }

    // workflows
    if (path === '/api/workflows' && method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const data = projectId ? state.workflows.filter((w) => w.projectId === projectId) : state.workflows;
      return json(route, data);
    }
    if (path === '/api/workflows/auto' && method === 'POST') {
      const body = requestBody(request);
      const id = `wf-${Date.now()}`;
      const created = {
        id,
        projectId: body.projectId,
        name: body.name || `Auto Workflow ${id.slice(-4)}`,
        status: 'running',
        currentStep: 'plan_generate',
        context: { decisionMode: body.decisionMode || 'human_in_loop' },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.workflows.unshift(created);
      state.workflowEvents[id] = [
        { id: `we-${id}`, workflowId: id, type: 'workflow.created', message: 'Workflow created', createdAt: nowIso() },
      ];
      state.workflowGates[id] = [];
      return json(route, created, 201);
    }
    const workflowEventsMatch = path.match(/^\/api\/workflows\/([^/]+)\/events$/);
    if (workflowEventsMatch && method === 'GET') {
      return json(route, state.workflowEvents[workflowEventsMatch[1]] || []);
    }
    const workflowGatesMatch = path.match(/^\/api\/workflows\/([^/]+)\/gates$/);
    if (workflowGatesMatch && method === 'GET') {
      return json(route, state.workflowGates[workflowGatesMatch[1]] || []);
    }
    const workflowCancelMatch = path.match(/^\/api\/workflows\/([^/]+)\/cancel$/);
    if (workflowCancelMatch && method === 'POST') {
      const wid = workflowCancelMatch[1];
      state.workflows = state.workflows.map((w) => (w.id === wid ? { ...w, status: 'cancelled' } : w));
      return json(route, state.workflows.find((w) => w.id === wid));
    }
    const workflowResumeMatch = path.match(/^\/api\/workflows\/([^/]+)\/resume$/);
    if (workflowResumeMatch && method === 'POST') {
      const wid = workflowResumeMatch[1];
      state.workflows = state.workflows.map((w) => (w.id === wid ? { ...w, status: 'running' } : w));
      return json(route, state.workflows.find((w) => w.id === wid));
    }
    const resolveGateMatch = path.match(/^\/api\/workflows\/([^/]+)\/gates\/([^/]+)\/resolve$/);
    if (resolveGateMatch && method === 'POST') {
      const [, wid, gateId] = resolveGateMatch;
      const body = requestBody(request);
      const gateList = state.workflowGates[wid] || [];
      state.workflowGates[wid] = gateList.map((g) =>
        g.id === gateId
          ? { ...g, status: body.status, selectedOption: body.selectedOption || null, updatedAt: nowIso() }
          : g
      );
      return json(route, state.workflowGates[wid].find((g) => g.id === gateId));
    }

    // schedule
    const scheduleMatch = path.match(/^\/api\/projects\/([^/]+)\/schedule$/);
    if (scheduleMatch && method === 'GET') {
      return json(route, buildSchedulePayload(state, scheduleMatch[1]));
    }
    const milestoneCreateMatch = path.match(/^\/api\/projects\/([^/]+)\/milestones$/);
    if (milestoneCreateMatch && method === 'POST') {
      const body = requestBody(request);
      const created = {
        id: `m-${Date.now()}`,
        projectId: milestoneCreateMatch[1],
        title: body.title || '新里程碑',
        description: body.description || '',
        dueDate: body.dueDate || null,
        status: body.status || 'pending',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        tasks: [],
      };
      state.milestones.unshift(created);
      return json(route, created, 201);
    }
    const milestoneUpdateMatch = path.match(/^\/api\/milestones\/([^/]+)$/);
    if (milestoneUpdateMatch && method === 'PATCH') {
      const body = requestBody(request);
      state.milestones = state.milestones.map((m) =>
        m.id === milestoneUpdateMatch[1] ? { ...m, ...body, updatedAt: nowIso() } : m
      );
      return json(route, state.milestones.find((m) => m.id === milestoneUpdateMatch[1]));
    }
    const taskCreateMatch = path.match(/^\/api\/milestones\/([^/]+)\/tasks$/);
    if (taskCreateMatch && method === 'POST') {
      const body = requestBody(request);
      const milestone = state.milestones.find((m) => m.id === taskCreateMatch[1]);
      if (!milestone) return json(route, { error: 'Milestone not found' }, 404);
      const created = {
        id: `t-${Date.now()}`,
        milestoneId: milestone.id,
        workflowId: body.workflowId || null,
        title: body.title || '新任务',
        description: body.description || '',
        status: body.status || 'todo',
        assignee: body.assignee || null,
        dueDate: body.dueDate || null,
        dependencyTaskId: body.dependencyTaskId || null,
        blockingReason: body.blockingReason || null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      milestone.tasks = milestone.tasks || [];
      milestone.tasks.push(created);
      return json(route, created, 201);
    }
    const taskUpdateMatch = path.match(/^\/api\/schedule-tasks\/([^/]+)$/);
    if (taskUpdateMatch && method === 'PATCH') {
      const body = requestBody(request);
      let updated: any = null;
      state.milestones = state.milestones.map((m) => {
        const tasks = (m.tasks || []).map((t: any) => {
          if (t.id !== taskUpdateMatch[1]) return t;
          updated = { ...t, ...body, updatedAt: nowIso() };
          return updated;
        });
        return { ...m, tasks };
      });
      return updated ? json(route, updated) : json(route, { error: 'Task not found' }, 404);
    }

    // datasets
    if (path === '/api/datasets' && method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const data = projectId ? state.datasets.filter((d) => d.projectId === projectId) : state.datasets;
      return json(route, data);
    }
    if (path === '/api/datasets/search' && method === 'POST') {
      const body = requestBody(request);
      const q = body.query || 'dataset';
      return json(route, [
        {
          name: `${q}-candidate`,
          source: 'tavily',
          description: `Candidate dataset for ${q}`,
          license: 'mit',
          homepage: 'https://example.com/candidate',
          tags: ['candidate'],
          metadata: { score: 0.8 },
        },
      ]);
    }
    if (path === '/api/datasets' && method === 'POST') {
      const body = requestBody(request);
      const created = {
        id: `d-${Date.now()}`,
        projectId: body.projectId || null,
        name: body.name,
        source: body.source || '',
        description: body.description || '',
        license: body.license || '',
        homepage: body.homepage || null,
        tags: body.tags || [],
        metadata: body.metadata || {},
        status: body.status || 'curated',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.datasets.unshift(created);
      state.datasetVersions[created.id] = [];
      return json(route, created, 201);
    }
    const datasetVersionsMatch = path.match(/^\/api\/datasets\/([^/]+)\/versions$/);
    if (datasetVersionsMatch && method === 'GET') {
      return json(route, state.datasetVersions[datasetVersionsMatch[1]] || []);
    }
    const datasetConstructMatch = path.match(/^\/api\/datasets\/([^/]+)\/construct$/);
    if (datasetConstructMatch && method === 'POST') {
      const body = requestBody(request);
      const did = datasetConstructMatch[1];
      const created = {
        id: `dv-${Date.now()}`,
        datasetId: did,
        version: body.version || 'v-new',
        splitInfo: body.splitInfo || { train: 0.8, validation: 0.1, test: 0.1 },
        filePath: `/tmp/datasets/${did}/${body.version || 'v-new'}`,
        checksum: 'mock',
        sizeBytes: 2000,
        buildRecipe: body.buildRecipe || {},
        createdAt: nowIso(),
      };
      state.datasetVersions[did] = [created, ...(state.datasetVersions[did] || [])];
      return json(route, created, 201);
    }
    const datasetAnalyzeMatch = path.match(/^\/api\/datasets\/([^/]+)\/analyze$/);
    if (datasetAnalyzeMatch && method === 'POST') {
      return json(route, {
        sampleSize: 120,
        columnCount: 3,
        columns: [
          { name: 'text', inferredType: 'string', missingCount: 0, missingRate: 0, uniqueCount: 115, uniqueRate: 95, topValues: [] },
          { name: 'label', inferredType: 'string', missingCount: 0, missingRate: 0, uniqueCount: 2, uniqueRate: 1.7, topValues: [{ value: 'A', count: 100 }] },
          { name: 'score', inferredType: 'number', missingCount: 2, missingRate: 1.7, uniqueCount: 110, uniqueRate: 91.7, topValues: [] },
        ],
        quality: {
          overall: 84.2,
          completeness: 98,
          consistency: 92,
          diversity: 88,
          balance: 60,
        },
        detectedIssues: ['Label distribution is imbalanced on field "label".'],
        recommendedActions: ['Rebalance labels before training.'],
      });
    }
    const datasetStrategyMatch = path.match(/^\/api\/datasets\/([^/]+)\/construct-strategy$/);
    if (datasetStrategyMatch && method === 'POST') {
      return json(route, {
        versionSuggestion: 'v-auto-1',
        splitInfo: { train: 0.75, validation: 0.125, test: 0.125 },
        buildRecipe: {
          strategy: 'quality-aware-v1',
          preprocessingSteps: ['schema_validation', 'label_rebalancing'],
        },
        rationale: ['Quality overall score: 84.2', 'Recommended split for medium-size dataset'],
        riskChecks: ['Leakage check', 'Label coverage check'],
      });
    }

    // reading / papers
    if (path === '/api/reading/search' && method === 'POST') {
      return json(route, [
        {
          title: 'A New Paper Candidate',
          authors: ['Tom', 'Jerry'],
          venue: 'arXiv',
          year: 2026,
          url: 'https://example.com/new-paper',
          pdfUrl: 'https://example.com/new-paper.pdf',
          abstract: 'Candidate abstract',
          metadata: { source: 'mock' },
        },
      ]);
    }
    if (path === '/api/reading/papers' && method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const data = projectId ? state.papers.filter((p) => p.projectId === projectId) : state.papers;
      return json(route, data);
    }
    if (path === '/api/reading/papers' && method === 'POST') {
      const body = requestBody(request);
      const created = {
        id: `paper-${Date.now()}`,
        projectId: body.projectId || null,
        title: body.title,
        authors: body.authors || [],
        venue: body.venue || '',
        year: body.year || null,
        doi: body.doi || null,
        url: body.url || null,
        pdfUrl: body.pdfUrl || null,
        localPdfPath: null,
        abstract: body.abstract || '',
        tags: body.tags || [],
        notes: body.notes || '',
        status: body.status || 'discovered',
        metadata: body.metadata || {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.papers.unshift(created);
      return json(route, created, 201);
    }
    const paperDownloadMatch = path.match(/^\/api\/reading\/papers\/([^/]+)\/download$/);
    if (paperDownloadMatch && method === 'POST') {
      state.papers = state.papers.map((p) =>
        p.id === paperDownloadMatch[1]
          ? { ...p, status: 'downloaded', localPdfPath: `/tmp/${p.id}.pdf`, updatedAt: nowIso() }
          : p
      );
      const paper = state.papers.find((p) => p.id === paperDownloadMatch[1]);
      return json(route, paper);
    }
    const paperSummarizeMatch = path.match(/^\/api\/reading\/papers\/([^/]+)\/summarize$/);
    if (paperSummarizeMatch && method === 'POST') {
      return json(route, { summary: '自动摘要：该论文提出了一个有效的检索增强方法。' });
    }
    const paperExtractMatch = path.match(/^\/api\/reading\/papers\/([^/]+)\/extract$/);
    if (paperExtractMatch && method === 'POST') {
      return json(route, {
        title: 'A Retrieval Study',
        authors: ['Alice', 'Bob'],
        affiliations: ['Tsinghua University', 'Open Research Lab'],
        keywords: ['retrieval', 'augmentation', 'llm'],
        abstract: 'This paper studies retrieval augmentation.',
        outline: ['Introduction', 'Method', 'Results', 'Conclusion'],
        latexSnippets: ['$L=\\lambda_1 L_{ce}$'],
        textPreview: 'Introduction ...',
        engineUsed: 'fallback',
        generatedAt: nowIso(),
      });
    }
    const paperBlogMatch = path.match(/^\/api\/reading\/papers\/([^/]+)\/blog$/);
    if (paperBlogMatch && method === 'POST') {
      return json(route, {
        title: 'A Retrieval Study',
        slug: 'a-retrieval-study',
        style: 'alpharxiv',
        language: 'zh',
        highlights: ['核心关键词: retrieval, augmentation'],
        markdown: '# 论文速读: A Retrieval Study\n\n## 这篇论文做了什么\n提出了检索增强方案。',
        generatedAt: nowIso(),
      });
    }
    const paperPdfMatch = path.match(/^\/api\/reading\/papers\/([^/]+)\/pdf$/);
    if (paperPdfMatch && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF-1.4 mock pdf',
      });
    }

    // reviews
    if (path === '/api/reviews' && method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      return json(route, state.reviews.filter((r) => r.projectId === projectId));
    }
    if (path === '/api/reviews/generate' && method === 'POST') {
      const body = requestBody(request);
      const created = {
        id: `rev-${Date.now()}`,
        projectId: body.projectId,
        workflowId: body.workflowId || null,
        reportId: null,
        title: 'Auto Generated Review',
        review: {
          overallScore: 7.9,
          novelty: 7.5,
          soundness: 8.2,
          reproducibility: 7.8,
          clarity: 8.1,
          decision: 'weak_accept',
          strengths: ['流程完整'],
          weaknesses: ['缺少长周期验证'],
          suggestions: ['补充更多真实场景'],
        },
        retrospective: {
          summary: '复盘结果：下一轮应聚焦稳健性。',
          whatWorked: ['自动化调度'],
          whatDidNotWork: ['部分配置泛化差'],
          actionItems: [{ action: '增加稳健性测试', priority: 'high' }],
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.reviews.unshift(created);
      return json(route, created, 201);
    }
    const reviewMatch = path.match(/^\/api\/reviews\/([^/]+)$/);
    if (reviewMatch && method === 'GET') {
      const review = state.reviews.find((r) => r.id === reviewMatch[1]);
      return review ? json(route, review) : json(route, { error: 'Review not found' }, 404);
    }

    return json(route, { error: `Unhandled API: ${method} ${path}` }, 404);
  });

  return state;
}

test('all sidebar pages render', async ({ page }) => {
  await installApiMocks(page);

  const cases: Array<{ path: string; heading: string }> = [
    { path: '/projects', heading: '项目' },
    { path: '/experiments', heading: '实验' },
    { path: '/monitor', heading: '监控中心' },
    { path: '/reports', heading: '报告' },
    { path: '/deep-research', heading: 'DeepResearch' },
    { path: '/workflows', heading: '自动编排工作流' },
    { path: '/roadmap', heading: '项目日程与进展' },
    { path: '/datasets', heading: '数据集搜索与管理' },
    { path: '/library', heading: 'Reading Agent / 论文库' },
    { path: '/reviews', heading: 'Paper Review 与复盘' },
    { path: '/integrations/skill-seekers', heading: 'Skill Seekers 集成' },
    { path: '/settings', heading: '设置' },
  ];

  for (const item of cases) {
    await page.goto(item.path);
    await expect(page.getByRole('heading', { name: item.heading, exact: true })).toBeVisible();
  }
});

test('project detail can generate and apply AI plan', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/projects/p1');

  await page.getByRole('button', { name: 'AI 生成计划' }).click();
  await page.getByRole('button', { name: '生成计划', exact: true }).click();
  await expect(page.getByText('计划摘要')).toBeVisible();
  await page.getByRole('button', { name: '应用计划' }).click();
  await expect(page.getByText('自动基线组')).toBeVisible();
});

test('datasets page supports search, analyze, strategy and construct', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/datasets');

  await page.getByPlaceholder('例如: code generation benchmark').fill('quality benchmark');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByText('quality benchmark-candidate')).toBeVisible();

  await page.getByRole('button', { name: '加入数据集库' }).first().click();
  await page.getByRole('button', { name: 'EDA/质量评分' }).first().click();
  await expect(page.getByText(/Overall .* \/ 100/)).toBeVisible();

  await page.getByRole('button', { name: '策略建议' }).first().click();
  await expect(page.getByText('推荐版本:')).toBeVisible();

  await page.getByRole('button', { name: '按策略构造' }).first().click();
  await expect(page.getByText('v-auto-1')).toBeVisible();
});

test('library page supports summarize, OCR extract and blog generation', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/library');

  await page.getByPlaceholder('例如: retrieval augmented generation benchmark').fill('new paper');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(page.getByText('A New Paper Candidate')).toBeVisible();
  await page.getByRole('button', { name: '加入论文库' }).first().click();

  await page.getByRole('button', { name: '下载PDF' }).first().click();
  await page.getByRole('button', { name: '生成摘要' }).first().click();
  await expect(page.getByText('自动摘要：该论文提出了一个有效的检索增强方法。')).toBeVisible();

  await page.getByRole('button', { name: 'OCR/LaTeX解析' }).first().click();
  await expect(page.getByText('结构化解析')).toBeVisible();

  await page.getByRole('button', { name: '一键博客' }).first().click();
  await expect(page.getByText('# 论文速读: A Retrieval Study')).toBeVisible();
});

test('workflow, roadmap, deepresearch, reviews, reports, settings and integrations actions', async ({ page }) => {
  await installApiMocks(page);

  // workflow
  await page.goto('/workflows');
  await page.getByRole('button', { name: '启动自动工作流' }).click();
  await expect(page.getByText('Auto Workflow')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByText('approved')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('已取消').first()).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();

  // roadmap
  await page.goto('/roadmap');
  await page.getByRole('button', { name: '周视图' }).click();
  await page.getByRole('button', { name: '甘特图' }).click();
  await expect(page.getByText('任务甘特图')).toBeVisible();
  await page.getByRole('button', { name: '月视图' }).click();
  await page.getByText('准备数据').first().click();
  await expect(page.getByText('任务详情')).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).last().click();

  // deep research
  await page.goto('/deep-research');
  await page
    .getByPlaceholder('例如：2026年多模态推理模型在工业质检中的最佳实践与主要风险')
    .fill('2026 多模态工业质检最佳实践');
  await page.getByRole('button', { name: '开始 DeepResearch' }).click();
  await expect(page.getByRole('heading', { name: '研究结果' })).toBeVisible();

  // reviews
  await page.goto('/reviews');
  await page.getByRole('button', { name: '生成 Review' }).click();
  await expect(page.getByText('Retrospective')).toBeVisible();

  // reports
  await page.goto('/reports');
  await page.locator('select').first().selectOption('p1');
  await expect(page.getByText('最终实验报告')).toBeVisible();
  await page.getByRole('button', { name: '删除' }).first().click();
  await expect(page.getByText('该项目暂无报告')).toBeVisible();

  // settings
  await page.goto('/settings');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已保存')).toBeVisible();
  await page.getByRole('button', { name: '测试 LLM' }).click();
  await expect(page.getByText(/LLM: /)).toBeVisible();
  await page.getByRole('button', { name: '测试 Tavily' }).click();
  await expect(page.getByText(/Tavily: /)).toBeVisible();

  // skill seekers
  await page.goto('/integrations/skill-seekers');
  await page.getByRole('button', { name: '同步仓库' }).click();
  await expect(page.getByText('仓库同步完成')).toBeVisible();
  await page.getByRole('button', { name: '构建镜像' }).click();
  await expect(page.getByText('镜像构建完成')).toBeVisible();

  await page.getByPlaceholder('例如: my-product-docs').fill('my docs');
  await page.getByPlaceholder('https://docs.example.com').fill('https://docs.example.com');
  await page.getByRole('button', { name: '创建自定义 Skill 配置' }).click();
  await expect(page.getByText(/自定义 Skill 配置已创建/)).toBeVisible();
  await page.getByRole('button', { name: '开始执行' }).click();
  await expect(page.getByText('最近一次执行结果')).toBeVisible();

  // monitor
  await page.goto('/monitor');
  await expect(page.getByText('活跃运行')).toBeVisible();
  await expect(page.getByText('活跃告警')).toBeVisible();
});
