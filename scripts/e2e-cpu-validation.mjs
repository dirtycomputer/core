import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:3000/api';
const ownerId = 'default-user';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function mapJobStateToRun(state) {
  if (state === 'queued' || state === 'pending') return 'queued';
  if (state === 'running') return 'running';
  if (state === 'completed') return 'completed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'timeout') return 'timeout';
  return 'failed';
}

function makeMetrics(step, expIndex, isAblation = false) {
  const base = isAblation ? 0.73 : 0.75;
  const accuracy = base + expIndex * 0.012 + step * 0.003;
  const f1 = accuracy - 0.02;
  const loss = 1.2 - step * 0.08 - expIndex * 0.03;
  return {
    accuracy: Number(accuracy.toFixed(4)),
    f1Score: Number(f1.toFixed(4)),
    loss: Number(Math.max(loss, 0.2).toFixed(4)),
  };
}

async function runExperiment(experiment, expIndex, isAblation = false) {
  const handle = await api('/clusters/submit', {
    method: 'POST',
    body: {
      clusterType: 'ssh',
      job: {
        name: `cpu-${experiment.name}`,
        workDir: '/tmp',
        script: 'echo start; sleep 2; echo done',
        resources: {
          cpuCount: experiment.config?.resources?.cpuCount || 4,
          gpuCount: 0,
          memoryGb: experiment.config?.resources?.memoryGb || 8,
          timeLimit: '00:10:00',
        },
      },
    },
  });

  const run = await api('/runs', {
    method: 'POST',
    body: {
      experimentId: experiment.id,
      clusterType: 'ssh',
      clusterJobId: handle.jobId,
      logPath: `/tmp/${handle.jobId}.log`,
    },
  });

  let step = 0;
  let done = false;
  let finalStatus = 'pending';

  while (!done) {
    const status = await api(`/clusters/ssh/jobs/${handle.jobId}/status`);
    finalStatus = mapJobStateToRun(status.state);
    await api(`/runs/${run.id}`, { method: 'PATCH', body: { status: finalStatus } });

    if (finalStatus === 'running') {
      step += 1;
      await api(`/runs/${run.id}/metrics`, {
        method: 'POST',
        body: {
          step,
          metrics: makeMetrics(step, expIndex, isAblation),
        },
      });
    }

    if (!['queued', 'running'].includes(finalStatus)) {
      done = true;
    } else {
      await sleep(1200);
    }
  }

  const fullRun = await api(`/runs/${run.id}`);
  return fullRun;
}

async function main() {
  const now = new Date().toISOString().slice(0, 19);

  const project = await api('/projects', {
    method: 'POST',
    body: {
      name: `CPU 自动验收项目 ${now}`,
      description: '针对 ROC 端到端编排能力的 CPU 验收测试',
      researchGoal: '验证从计划生成到实验编排、运行监控、分析改进、消融验证、LaTeX报告产出的完整链路',
      ownerId,
    },
  });

  const plan = await api('/ai/plan', {
    method: 'POST',
    body: {
      projectName: project.name,
      researchGoal: project.researchGoal,
      constraints: {
        maxExperiments: 3,
        budget: 0,
      },
    },
  });

  const ideas = plan.experimentGroups.map((g, i) => ({
    rank: i + 1,
    idea: g.hypothesis,
    groupName: g.name,
  }));

  const createdGroups = [];
  const createdExperiments = [];

  for (const [groupIndex, group] of plan.experimentGroups.entries()) {
    const newGroup = await api('/experiment-groups', {
      method: 'POST',
      body: {
        projectId: project.id,
        name: group.name,
        type: group.type,
        hypothesis: group.hypothesis,
        priority: groupIndex + 1,
      },
    });

    createdGroups.push(newGroup);

    const batchPayload = (group.experiments || []).map((exp, idx) => ({
      groupId: newGroup.id,
      name: exp.name,
      description: exp.description,
      config: exp.config,
      variables: exp.variables,
      priority: idx + 1,
    }));

    if (batchPayload.length > 0) {
      const batchCreated = await api('/experiments/batch', {
        method: 'POST',
        body: { experiments: batchPayload },
      });
      createdExperiments.push(...batchCreated);
    }
  }

  const runResults = [];
  for (const [i, exp] of createdExperiments.entries()) {
    await api(`/experiments/${exp.id}`, { method: 'PATCH', body: { status: 'running' } });
    const run = await runExperiment(exp, i, false);
    await api(`/experiments/${exp.id}`, {
      method: 'PATCH',
      body: { status: run.status === 'completed' ? 'completed' : 'failed' },
    });
    runResults.push({ experiment: exp, run });
  }

  const analysisInput = {
    projectName: project.name,
    researchGoal: project.researchGoal,
    results: runResults.map((r) => ({
      experiment: r.experiment,
      runs: [r.run],
      bestRun: r.run,
      averageMetrics: r.run.metrics,
    })),
    baselineResult: runResults[0]
      ? {
          experiment: runResults[0].experiment,
          runs: [runResults[0].run],
          bestRun: runResults[0].run,
          averageMetrics: runResults[0].run.metrics,
        }
      : undefined,
  };

  const analysis = await api('/ai/analyze', {
    method: 'POST',
    body: analysisInput,
  });

  const ablationSeed = runResults[0]?.experiment;
  let ablationPlans = [];
  if (ablationSeed) {
    ablationPlans = await api('/ai/ablation-plan', {
      method: 'POST',
      body: {
        baseExperiment: {
          name: ablationSeed.name,
          description: ablationSeed.description,
          hypothesis: '验证关键组件贡献',
          type: 'baseline',
          config: ablationSeed.config,
          variables: ablationSeed.variables,
          expectedImpact: '用于消融对照',
          priority: 1,
        },
        components: ['scheduler', 'warmup'],
      },
    });
  }

  const ablationRuns = [];
  if (ablationPlans.length > 0 && createdGroups[2]) {
    const selected = ablationPlans.slice(0, 1);
    const batchPayload = selected.map((exp, idx) => ({
      groupId: createdGroups[2].id,
      name: exp.name,
      description: exp.description,
      config: exp.config,
      variables: exp.variables,
      priority: idx + 1,
    }));

    const created = await api('/experiments/batch', {
      method: 'POST',
      body: { experiments: batchPayload },
    });

    for (const [i, exp] of created.entries()) {
      await api(`/experiments/${exp.id}`, { method: 'PATCH', body: { status: 'running' } });
      const run = await runExperiment(exp, i, true);
      await api(`/experiments/${exp.id}`, {
        method: 'PATCH',
        body: { status: run.status === 'completed' ? 'completed' : 'failed' },
      });
      ablationRuns.push({ experiment: exp, run });
    }
  }

  const reportPayload = {
    projectId: project.id,
    type: 'final',
    compilePdf: false,
    data: {
      title: `CPU 验收报告 - ${project.name}`,
      projectName: project.name,
      researchGoal: project.researchGoal,
      methodology: plan.methodology,
      experiments: [...runResults, ...ablationRuns].map((x) => ({
        name: x.experiment.name,
        description: x.experiment.description || '',
        config: x.experiment.config,
        results: x.run.metrics || {},
      })),
      analysis,
      tables: [
        {
          caption: 'Idea Candidates',
          headers: ['Rank', 'Group', 'Idea'],
          rows: ideas.map((i) => [String(i.rank), i.groupName, i.idea]),
        },
      ],
    },
  };

  const report = await api('/reports', {
    method: 'POST',
    body: reportPayload,
  });

  const reportDetail = await api(`/reports/${report.id}`);
  await mkdir('/Users/sii002/Desktop/core/artifacts/e2e', { recursive: true });
  const latexPath = `/Users/sii002/Desktop/core/artifacts/e2e/${report.id}.tex`;
  await writeFile(latexPath, reportDetail.latexSource || '', 'utf8');

  const summary = {
    projectId: project.id,
    reportId: report.id,
    latexPath,
    ideaCount: ideas.length,
    experimentCount: createdExperiments.length + ablationRuns.length,
    completedRuns: [...runResults, ...ablationRuns].filter((x) => x.run.status === 'completed').length,
    analysisSummary: analysis.summary,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
