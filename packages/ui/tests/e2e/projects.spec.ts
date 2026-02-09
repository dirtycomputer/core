import { test, expect, type Page } from '@playwright/test';

type Project = {
  id: string;
  name: string;
  description: string;
  researchGoal: string;
  status: 'planning' | 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
};

async function mockProjectApis(page: Page, projects: Project[]) {
  await page.route('**/api/projects**', async (route, request) => {
    const method = request.method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: projects }),
      });
      return;
    }

    if (method === 'POST') {
      const payload = request.postDataJSON() as {
        name: string;
        description?: string;
        researchGoal?: string;
      };

      const created: Project = {
        id: `p-${Date.now()}`,
        name: payload.name,
        description: payload.description ?? '',
        researchGoal: payload.researchGoal ?? '',
        status: 'planning',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      projects.unshift(created);

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }

    await route.continue();
  });
}

test('shows empty state when no projects exist', async ({ page }) => {
  await mockProjectApis(page, []);

  await page.goto('/projects');

  await expect(page.getByRole('heading', { name: '项目' })).toBeVisible();
  await expect(page.getByText('暂无项目')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建第一个项目' })).toBeVisible();
});

test('creates a project from the modal and renders it in the list', async ({ page }) => {
  const projects: Project[] = [];
  await mockProjectApis(page, projects);

  await page.goto('/projects');
  await page.getByRole('button', { name: '新建项目' }).click();

  await page.getByPlaceholder('输入项目名称').fill('视觉模型基线实验');
  await page.getByPlaceholder('简要描述项目').fill('对比不同视觉编码器表现');
  await page
    .getByPlaceholder('描述您的研究目标，AI 将基于此生成实验计划')
    .fill('在相同算力下提升准确率');
  await page.getByRole('button', { name: '创建', exact: true }).click();

  await expect(page.getByText('视觉模型基线实验')).toBeVisible();
  await expect(page.getByText('对比不同视觉编码器表现')).toBeVisible();
});

test('opens project detail page and displays experiment groups', async ({ page }) => {
  const projectId = 'project-1';

  await page.route(`**/api/projects/${projectId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: projectId,
        name: 'LLM 对齐项目',
        description: '对齐数据与训练策略对比',
        researchGoal: '减少幻觉并提升任务成功率',
      }),
    });
  });

  await page.route('**/api/experiment-groups**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'g1',
            name: '基线组',
            type: 'baseline',
            hypothesis: '基础监督微调作为对照',
            status: 'approved',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
  });

  await page.goto(`/projects/${projectId}`);

  await expect(page.getByRole('heading', { name: 'LLM 对齐项目' })).toBeVisible();
  await expect(page.getByText('研究目标')).toBeVisible();
  await expect(page.getByText('基线组')).toBeVisible();
  await expect(page.getByText('已批准')).toBeVisible();
});
