import { existsSync } from 'fs';
import { mkdir, readdir, readFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import axios from 'axios';
import { createLogger } from '../../utils/logger';

const logger = createLogger('service:skill-seekers');

const REPO_URL = 'https://github.com/yusufkaraaslan/Skill_Seekers';
const DEFAULT_BRANCH = 'development';
const REMOTE_CONFIGS_API = 'https://api.skillseekersweb.com/api/configs';

interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string[];
}

export interface SkillSeekersStatus {
  repoPath: string;
  outputPath: string;
  imageTag: string;
  repoReady: boolean;
  dockerAvailable: boolean;
  imageAvailable: boolean;
  pythonAvailable: boolean;
  pythonVersion: string | null;
  configsCount: number;
}

export interface SkillSeekersConfigInfo {
  configPath: string;
  name: string;
  description: string;
  category: string;
  type: string;
  source: 'local' | 'remote';
}

export interface SkillSeekersScrapeInput {
  configPath: string;
  maxPages?: number;
  buildImage?: boolean;
  verbose?: boolean;
}

export interface SkillSeekersRunResult {
  runId: string;
  outputDir: string;
  expectedSkillDir: string;
  command: string;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
}

function normalizePathToUnix(p: string): string {
  return p.split(path.sep).join('/');
}

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd();
  const rootMarkers = [
    path.join(cwd, 'packages', 'core'),
    path.join(cwd, 'packages', 'ui'),
  ];

  if (rootMarkers.every((p) => existsSync(p))) {
    return cwd;
  }

  if (path.basename(cwd) === 'core' && existsSync(path.join(cwd, 'src'))) {
    const root = path.resolve(cwd, '..', '..');
    if (existsSync(path.join(root, 'packages', 'ui'))) {
      return root;
    }
  }

  return cwd;
}

export class SkillSeekersService {
  private readonly workspaceRoot = resolveWorkspaceRoot();
  private readonly repoPath = process.env.SKILL_SEEKERS_REPO_PATH
    || path.join(this.workspaceRoot, 'integrations', 'Skill_Seekers');
  private readonly outputPath = process.env.SKILL_SEEKERS_OUTPUT_PATH
    || path.join(this.workspaceRoot, 'artifacts', 'skill-seekers');
  private readonly imageTag = process.env.SKILL_SEEKERS_IMAGE || 'roc-skill-seekers:latest';

  async getStatus(): Promise<SkillSeekersStatus> {
    const repoReady = existsSync(path.join(this.repoPath, '.git'));
    const [docker, py, imageAvailable, configsCount] = await Promise.all([
      this.tryCommand('docker', ['--version']),
      this.tryCommand('python3', ['--version']),
      this.imageExists(),
      this.countLocalConfigs(),
    ]);

    return {
      repoPath: this.repoPath,
      outputPath: this.outputPath,
      imageTag: this.imageTag,
      repoReady,
      dockerAvailable: docker.ok,
      imageAvailable,
      pythonAvailable: py.ok,
      pythonVersion: py.ok ? (py.stdout || py.stderr || '').trim() : null,
      configsCount,
    };
  }

  async syncRepo(branch = DEFAULT_BRANCH): Promise<SkillSeekersStatus> {
    await mkdir(path.dirname(this.repoPath), { recursive: true });

    if (!existsSync(path.join(this.repoPath, '.git'))) {
      await this.runCommand('git', [
        'clone',
        '--depth',
        '1',
        '--branch',
        branch,
        REPO_URL,
        this.repoPath,
      ], { timeoutMs: 120_000 });
      logger.info({ repoPath: this.repoPath, branch }, 'Skill Seekers repository cloned');
      return this.getStatus();
    }

    await this.runCommand('git', ['-C', this.repoPath, 'fetch', '--depth', '1', 'origin', branch], {
      timeoutMs: 120_000,
    });
    await this.runCommand('git', ['-C', this.repoPath, 'checkout', branch], { timeoutMs: 30_000 });
    await this.runCommand('git', ['-C', this.repoPath, 'pull', '--ff-only', 'origin', branch], {
      timeoutMs: 120_000,
    });
    logger.info({ repoPath: this.repoPath, branch }, 'Skill Seekers repository updated');

    return this.getStatus();
  }

  async listConfigs(): Promise<SkillSeekersConfigInfo[]> {
    const local = await this.listLocalConfigs();
    if (local.length > 0) {
      return local;
    }
    return this.listRemoteConfigs();
  }

  async buildImage(force = false): Promise<{ imageTag: string; built: boolean; logs: string }> {
    if (!existsSync(path.join(this.repoPath, '.git'))) {
      throw new Error(`Skill Seekers repo is not ready. Please sync first: ${this.repoPath}`);
    }

    const imageAvailable = await this.imageExists();
    if (imageAvailable && !force) {
      return { imageTag: this.imageTag, built: false, logs: 'Image already exists, skipped.' };
    }

    const result = await this.runCommand(
      'docker',
      ['build', '-t', this.imageTag, '-f', 'Dockerfile', '.'],
      { cwd: this.repoPath, timeoutMs: 30 * 60 * 1000 }
    );

    return {
      imageTag: this.imageTag,
      built: true,
      logs: this.tail(`${result.stdout}\n${result.stderr}`, 8000),
    };
  }

  async runScrape(input: SkillSeekersScrapeInput): Promise<SkillSeekersRunResult> {
    const configPath = this.validateConfigPath(input.configPath);
    const absConfigPath = path.join(this.repoPath, configPath);

    if (!existsSync(absConfigPath)) {
      throw new Error(`Config not found: ${absConfigPath}`);
    }

    const status = await this.getStatus();
    if (!status.dockerAvailable) {
      throw new Error('Docker is required for Skill Seekers integration');
    }
    if (!status.repoReady) {
      throw new Error('Skill Seekers repo is not ready. Please sync repository first.');
    }

    if (input.buildImage || !status.imageAvailable) {
      await this.buildImage(false);
    }

    const runId = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runOutputDir = path.join(this.outputPath, runId);
    await mkdir(runOutputDir, { recursive: true });

    const configRaw = JSON.parse(await readFile(absConfigPath, 'utf-8')) as { name?: string };
    const expectedSkillDir = path.join(runOutputDir, configRaw.name || 'output');

    const args = [
      'run',
      '--rm',
      '-v',
      `${this.repoPath}:/repo:ro`,
      '-v',
      `${runOutputDir}:/app/output`,
      '-w',
      '/app',
      this.imageTag,
      'skill-seekers',
      'scrape',
      '--config',
      `/repo/${normalizePathToUnix(configPath)}`,
    ];

    if (input.maxPages && Number.isFinite(input.maxPages) && input.maxPages > 0) {
      args.push('--max-pages', String(input.maxPages));
    }
    if (input.verbose) {
      args.push('--verbose');
    }

    const result = await this.runCommand('docker', args, { timeoutMs: 30 * 60 * 1000 });

    return {
      runId,
      outputDir: runOutputDir,
      expectedSkillDir,
      command: ['docker', ...args].join(' '),
      durationMs: result.durationMs,
      stdoutTail: this.tail(result.stdout, 10_000),
      stderrTail: this.tail(result.stderr, 6_000),
    };
  }

  private async listLocalConfigs(): Promise<SkillSeekersConfigInfo[]> {
    const configsDir = path.join(this.repoPath, 'configs');
    if (!existsSync(configsDir)) {
      return [];
    }

    const files = await this.walkJsonFiles(configsDir);
    const result: SkillSeekersConfigInfo[] = [];

    for (const absPath of files) {
      const rel = normalizePathToUnix(path.relative(this.repoPath, absPath));
      try {
        const content = JSON.parse(await readFile(absPath, 'utf-8')) as Record<string, any>;
        result.push({
          configPath: rel,
          name: String(content.name || path.basename(absPath, '.json')),
          description: String(content.description || ''),
          category: String(content.category || ''),
          type: String(content.type || 'single-source'),
          source: 'local',
        });
      } catch {
        result.push({
          configPath: rel,
          name: path.basename(absPath, '.json'),
          description: '',
          category: '',
          type: 'single-source',
          source: 'local',
        });
      }
    }

    return result.sort((a, b) => a.configPath.localeCompare(b.configPath));
  }

  private async listRemoteConfigs(): Promise<SkillSeekersConfigInfo[]> {
    try {
      const response = await axios.get(REMOTE_CONFIGS_API, { timeout: 12_000 });
      const configs = Array.isArray(response.data?.configs) ? response.data.configs : [];

      return configs.map((item: any) => ({
        configPath: String(item.path || item.file || `${item.name || 'unknown'}.json`),
        name: String(item.name || 'unknown'),
        description: String(item.description || ''),
        category: String(item.category || ''),
        type: String(item.type || 'single-source'),
        source: 'remote' as const,
      }));
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch remote Skill Seekers configs');
      return [];
    }
  }

  private validateConfigPath(configPath: string): string {
    const normalized = configPath.trim().replace(/^\/+/, '');
    if (!normalized) {
      throw new Error('configPath is required');
    }
    if (normalized.includes('..')) {
      throw new Error('configPath cannot contain ".."');
    }
    if (!normalized.endsWith('.json')) {
      throw new Error('configPath must point to a .json config file');
    }
    return normalized;
  }

  private async countLocalConfigs(): Promise<number> {
    const configs = await this.listLocalConfigs();
    return configs.length;
  }

  private async imageExists(): Promise<boolean> {
    const probe = await this.tryCommand('docker', ['image', 'inspect', this.imageTag]);
    return probe.ok;
  }

  private async walkJsonFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.walkJsonFiles(abs);
        result.push(...sub);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        result.push(abs);
      }
    }
    return result;
  }

  private async tryCommand(command: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    try {
      const res = await this.runCommand(command, args, { timeoutMs: 10_000 });
      return {
        ok: res.code === 0,
        stdout: res.stdout.trim(),
        stderr: res.stderr.trim(),
      };
    } catch (error: any) {
      return {
        ok: false,
        stdout: '',
        stderr: String(error?.message || error || ''),
      };
    }
  }

  private runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    const start = Date.now();
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const maxCapture = 2 * 1024 * 1024;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env || process.env,
      });

      let stdout = '';
      let stderr = '';
      let completed = false;

      const append = (origin: string, chunk: string) => {
        const merged = origin + chunk;
        if (merged.length > maxCapture) {
          return merged.slice(-maxCapture);
        }
        return merged;
      };

      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        stdout = append(stdout, d.toString());
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr = append(stderr, d.toString());
      });

      child.on('error', (error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        const result: CommandResult = {
          code: code ?? -1,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          command: [command, ...args],
        };
        if (result.code !== 0) {
          reject(new Error([
            `Command failed (${result.code}): ${result.command.join(' ')}`,
            result.stderr || result.stdout || '(no output)',
          ].join('\n')));
          return;
        }
        resolve(result);
      });
    });
  }

  private tail(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
      return content;
    }
    return content.slice(-maxChars);
  }
}

export const skillSeekersService = new SkillSeekersService();

