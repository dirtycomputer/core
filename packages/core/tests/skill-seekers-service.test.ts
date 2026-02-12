import { mkdtemp, mkdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillSeekersService } from '../src/services/integration/skill-seekers-service';

const tempDirs: string[] = [];

async function createTempRepoRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'skill-seekers-test-'));
  tempDirs.push(root);

  const repoPath = path.join(root, 'skill-seekers-repo');
  await mkdir(path.join(repoPath, '.git'), { recursive: true });
  await mkdir(path.join(repoPath, 'configs'), { recursive: true });

  process.env.SKILL_SEEKERS_REPO_PATH = repoPath;
  process.env.SKILL_SEEKERS_OUTPUT_PATH = path.join(root, 'output');
  return repoPath;
}

afterEach(async () => {
  delete process.env.SKILL_SEEKERS_REPO_PATH;
  delete process.env.SKILL_SEEKERS_OUTPUT_PATH;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('SkillSeekersService.createCustomConfig', () => {
  it('creates a documentation config under configs/custom', async () => {
    const repoPath = await createTempRepoRoot();
    const service = new SkillSeekersService();

    const created = await service.createCustomConfig({
      name: 'My Product Docs',
      description: 'knowledge for product docs',
      sourceType: 'documentation',
      baseUrl: 'https://docs.example.com',
      maxPages: 150,
    });

    expect(created.configPath).toBe('configs/custom/my-product-docs.json');
    expect(created.type).toBe('documentation');
    expect(created.source).toBe('local');

    const saved = JSON.parse(await readFile(path.join(repoPath, created.configPath), 'utf-8')) as Record<string, any>;
    expect(saved.name).toBe('My Product Docs');
    expect(saved.sources?.[0]?.type).toBe('documentation');
    expect(saved.sources?.[0]?.base_url).toBe('https://docs.example.com');
    expect(saved.sources?.[0]?.max_pages).toBe(150);
  });

  it('creates a github config with custom configPath and validates traversal', async () => {
    const repoPath = await createTempRepoRoot();
    const service = new SkillSeekersService();

    const created = await service.createCustomConfig({
      name: 'Org Repo',
      sourceType: 'github',
      repo: 'example-org/example-repo',
      configPath: 'team/example-repo',
    });

    expect(created.configPath).toBe('configs/custom/team/example-repo.json');

    const saved = JSON.parse(await readFile(path.join(repoPath, created.configPath), 'utf-8')) as Record<string, any>;
    expect(saved.sources?.[0]?.type).toBe('github');
    expect(saved.sources?.[0]?.repo).toBe('example-org/example-repo');

    await expect(
      service.createCustomConfig({
        name: 'Bad Path',
        sourceType: 'github',
        repo: 'owner/repo',
        configPath: '../escape.json',
      })
    ).rejects.toThrow('configPath cannot contain ".."');
  });
});

