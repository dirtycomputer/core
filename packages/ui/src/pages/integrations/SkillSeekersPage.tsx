import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, Wrench, Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { skillSeekersApi } from '@/api/client';

interface SkillSeekersStatus {
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

interface SkillSeekersConfig {
  configPath: string;
  name: string;
  description: string;
  category: string;
  type: string;
  source: 'local' | 'remote';
}

interface SkillSeekersRunResult {
  runId: string;
  outputDir: string;
  expectedSkillDir: string;
  command: string;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
}

export default function SkillSeekersPage() {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('development');
  const [configPath, setConfigPath] = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [buildBeforeRun, setBuildBeforeRun] = useState(false);
  const [verbose, setVerbose] = useState(false);
  const [lastRun, setLastRun] = useState<SkillSeekersRunResult | null>(null);
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customSourceType, setCustomSourceType] = useState<'documentation' | 'github'>('documentation');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customRepo, setCustomRepo] = useState('');
  const [customConfigPath, setCustomConfigPath] = useState('');
  const [customMaxPages, setCustomMaxPages] = useState(200);

  const statusQuery = useQuery<SkillSeekersStatus>({
    queryKey: ['integrations', 'skill-seekers', 'status'],
    queryFn: skillSeekersApi.getStatus,
    refetchInterval: 10000,
  });

  const configsQuery = useQuery<{ total: number; data: SkillSeekersConfig[] }>({
    queryKey: ['integrations', 'skill-seekers', 'configs'],
    queryFn: skillSeekersApi.listConfigs,
    staleTime: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => skillSeekersApi.syncRepo({ branch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'skill-seekers'] });
      setActionMessage({ ok: true, text: '仓库同步完成' });
    },
    onError: (error: any) => {
      setActionMessage({ ok: false, text: error?.response?.data?.error || '仓库同步失败' });
    },
  });

  const buildMutation = useMutation({
    mutationFn: () => skillSeekersApi.buildImage({ force: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'skill-seekers'] });
      setActionMessage({ ok: true, text: '镜像构建完成' });
    },
    onError: (error: any) => {
      setActionMessage({ ok: false, text: error?.response?.data?.error || '镜像构建失败' });
    },
  });

  const runMutation = useMutation({
    mutationFn: () => skillSeekersApi.runScrape({
      configPath,
      maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
      buildImage: buildBeforeRun,
      verbose,
    }),
    onSuccess: (data: SkillSeekersRunResult) => {
      setLastRun(data);
      setActionMessage({ ok: true, text: 'Skill Seekers scrape 执行成功' });
      queryClient.invalidateQueries({ queryKey: ['integrations', 'skill-seekers', 'status'] });
    },
    onError: (error: any) => {
      setActionMessage({ ok: false, text: error?.response?.data?.error || '执行 scrape 失败' });
    },
  });

  const createCustomMutation = useMutation({
    mutationFn: () =>
      skillSeekersApi.createCustomConfig({
        name: customName.trim(),
        description: customDescription.trim() || undefined,
        sourceType: customSourceType,
        baseUrl: customSourceType === 'documentation' ? customBaseUrl.trim() : undefined,
        repo: customSourceType === 'github' ? customRepo.trim() : undefined,
        maxPages: customSourceType === 'documentation' ? (Number.isFinite(customMaxPages) ? customMaxPages : undefined) : undefined,
        configPath: customConfigPath.trim() || undefined,
      }),
    onSuccess: (data: SkillSeekersConfig) => {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'skill-seekers', 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['integrations', 'skill-seekers', 'status'] });
      setConfigPath(data.configPath);
      setActionMessage({ ok: true, text: `自定义 Skill 配置已创建: ${data.configPath}` });
      setCustomName('');
      setCustomDescription('');
      setCustomBaseUrl('');
      setCustomRepo('');
      setCustomConfigPath('');
    },
    onError: (error: any) => {
      setActionMessage({ ok: false, text: error?.response?.data?.error || '创建自定义 Skill 配置失败' });
    },
  });

  const configs = configsQuery.data?.data || [];
  const sortedConfigs = useMemo(
    () => [...configs].sort((a, b) => a.configPath.localeCompare(b.configPath)),
    [configs]
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!configPath.trim()) return;
    setActionMessage(null);
    runMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Skill Seekers 集成</h1>
        <p className="text-gray-500 mt-1">同步仓库、构建 Docker 镜像，并直接在 ROC 内执行 Skill Seekers 抓取流程。</p>
      </div>

      <section className="bg-white border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">运行状态</h2>
          <button
            type="button"
            onClick={() => {
              statusQuery.refetch();
              configsQuery.refetch();
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCcw className="w-4 h-4" />
            刷新
          </button>
        </div>

        {statusQuery.isLoading ? (
          <div className="text-sm text-gray-500">状态加载中...</div>
        ) : statusQuery.isError ? (
          <div className="text-sm text-red-600">状态获取失败</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded border">
              <div className="font-medium text-gray-700">仓库</div>
              <div className={clsx('mt-1', statusQuery.data?.repoReady ? 'text-green-700' : 'text-red-700')}>
                {statusQuery.data?.repoReady ? '已就绪' : '未同步'}
              </div>
              <div className="text-xs text-gray-500 mt-1 break-all">{statusQuery.data?.repoPath}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="font-medium text-gray-700">Docker 镜像</div>
              <div className={clsx('mt-1', statusQuery.data?.imageAvailable ? 'text-green-700' : 'text-amber-700')}>
                {statusQuery.data?.imageAvailable ? '已存在' : '未构建'}
              </div>
              <div className="text-xs text-gray-500 mt-1">{statusQuery.data?.imageTag}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="font-medium text-gray-700">Docker</div>
              <div className={clsx('mt-1', statusQuery.data?.dockerAvailable ? 'text-green-700' : 'text-red-700')}>
                {statusQuery.data?.dockerAvailable ? '可用' : '不可用'}
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="font-medium text-gray-700">配置数量</div>
              <div className="mt-1 text-gray-900">{statusQuery.data?.configsCount ?? 0}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="branch"
            className="px-3 py-2 border rounded-md text-sm"
          />
          <button
            type="button"
            onClick={() => {
              setActionMessage(null);
              syncMutation.mutate();
            }}
            disabled={syncMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 border rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {syncMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            同步仓库
          </button>
          <button
            type="button"
            onClick={() => {
              setActionMessage(null);
              buildMutation.mutate();
            }}
            disabled={buildMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 border rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {buildMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            构建镜像
          </button>
        </div>
      </section>

      <section className="bg-white border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">执行 Scrape</h2>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">配置文件</label>
            <select
              value={configPath}
              onChange={(e) => setConfigPath(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">请选择配置...</option>
              {sortedConfigs.map((cfg) => (
                <option key={cfg.configPath} value={cfg.configPath}>
                  {cfg.configPath} ({cfg.name})
                </option>
              ))}
            </select>
            {configPath && (
              <div className="text-xs text-gray-500 mt-1 break-all">
                {sortedConfigs.find((cfg) => cfg.configPath === configPath)?.description || '无描述'}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">max-pages</label>
              <input
                type="number"
                min={1}
                max={2000}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value) || 50)}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <label className="flex items-center gap-2 mt-6 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={buildBeforeRun}
                onChange={(e) => setBuildBeforeRun(e.target.checked)}
              />
              运行前构建镜像
            </label>
            <label className="flex items-center gap-2 mt-6 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={verbose}
                onChange={(e) => setVerbose(e.target.checked)}
              />
              verbose
            </label>
          </div>

          <button
            type="submit"
            disabled={runMutation.isPending || !configPath}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {runMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                执行中...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                开始执行
              </>
            )}
          </button>
        </form>
      </section>

      <section className="bg-white border rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">自定义添加 Skill</h2>
        <p className="text-sm text-gray-500">
          在本地 `configs/custom/` 下生成一个可直接运行的 Skill Seekers 配置，创建后会自动选中到“执行 Scrape”。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">技能名称</label>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="例如: my-product-docs"
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">配置文件名（可选）</label>
            <input
              value={customConfigPath}
              onChange={(e) => setCustomConfigPath(e.target.value)}
              placeholder="custom/my-skill.json 或 my-skill"
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
          <textarea
            value={customDescription}
            onChange={(e) => setCustomDescription(e.target.value)}
            rows={2}
            placeholder="这个 Skill 用于什么任务"
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">来源类型</label>
            <select
              value={customSourceType}
              onChange={(e) => setCustomSourceType(e.target.value as 'documentation' | 'github')}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="documentation">documentation</option>
              <option value="github">github</option>
            </select>
          </div>

          {customSourceType === 'documentation' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">文档 URL</label>
                <input
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder="https://docs.example.com"
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">max-pages</label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={customMaxPages}
                  onChange={(e) => setCustomMaxPages(Number(e.target.value) || 200)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">GitHub 仓库</label>
              <input
                value={customRepo}
                onChange={(e) => setCustomRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setActionMessage(null);
            createCustomMutation.mutate();
          }}
          disabled={
            createCustomMutation.isPending
            || !customName.trim()
            || (customSourceType === 'documentation' && !customBaseUrl.trim())
            || (customSourceType === 'github' && !customRepo.trim())
          }
          className="inline-flex items-center gap-2 px-4 py-2 border rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {createCustomMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          创建自定义 Skill 配置
        </button>
      </section>

      {actionMessage && (
        <div
          className={clsx(
            'p-3 rounded-lg text-sm flex items-center gap-2',
            actionMessage.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          )}
        >
          {actionMessage.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {actionMessage.text}
        </div>
      )}

      {lastRun && (
        <section className="bg-white border rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">最近一次执行结果</h2>
          <div className="text-sm text-gray-700 space-y-1">
            <div><span className="font-medium">Run ID:</span> {lastRun.runId}</div>
            <div><span className="font-medium">输出目录:</span> {lastRun.outputDir}</div>
            <div><span className="font-medium">预期技能目录:</span> {lastRun.expectedSkillDir}</div>
            <div><span className="font-medium">耗时:</span> {(lastRun.durationMs / 1000).toFixed(1)}s</div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1">命令</div>
            <pre className="bg-gray-50 border rounded p-2 text-xs overflow-auto whitespace-pre-wrap">{lastRun.command}</pre>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1">stdout (tail)</div>
            <pre className="bg-gray-50 border rounded p-2 text-xs overflow-auto whitespace-pre-wrap max-h-72">{lastRun.stdoutTail || '(empty)'}</pre>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1">stderr (tail)</div>
            <pre className="bg-gray-50 border rounded p-2 text-xs overflow-auto whitespace-pre-wrap max-h-56">{lastRun.stderrTail || '(empty)'}</pre>
          </div>
        </section>
      )}
    </div>
  );
}
