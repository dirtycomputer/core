import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Key, Cpu, CheckCircle, XCircle, Loader2, Eye, EyeOff, Link } from 'lucide-react';
import { settingsApi } from '../../api/client';
import { clsx } from 'clsx';

interface LLMConfig {
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  hasApiKey: boolean;
  hasTavilyApiKey: boolean;
}

const PROVIDER_MODELS = {
  openai: ['gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'],
  anthropic: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307', 'claude-3-5-sonnet-20241022'],
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [showTavilyApiKey, setShowTavilyApiKey] = useState(false);
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('gpt-4');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.7);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [tavilyTestResult, setTavilyTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: config, isLoading } = useQuery<LLMConfig>({
    queryKey: ['settings', 'llm'],
    queryFn: settingsApi.getLLMConfig,
  });

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setBaseUrl(config.baseUrl || '');
      setMaxTokens(config.maxTokens);
      setTemperature(config.temperature);

      // 检查模型是否在预设列表中
      const isPresetModel = PROVIDER_MODELS[config.provider].includes(config.model);
      if (isPresetModel) {
        setModel(config.model);
        setUseCustomModel(false);
      } else {
        setCustomModel(config.model);
        setUseCustomModel(true);
      }
    }
  }, [config]);

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateLLMConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'llm'] });
      setApiKey('');
      setTavilyApiKey('');
    },
  });

  const llmTestMutation = useMutation({
    mutationFn: settingsApi.testLLMConnection,
    onSuccess: (data) => {
      setLlmTestResult({ success: true, message: data.message });
    },
    onError: (error: any) => {
      setLlmTestResult({
        success: false,
        message: error.response?.data?.error || '连接测试失败',
      });
    },
  });

  const tavilyTestMutation = useMutation({
    mutationFn: settingsApi.testTavilyConnection,
    onSuccess: (data) => {
      setTavilyTestResult({ success: true, message: data.message });
    },
    onError: (error: any) => {
      setTavilyTestResult({
        success: false,
        message: error.response?.data?.error || 'Tavily 连接测试失败',
      });
    },
  });

  const handleSave = () => {
    const data: any = {
      provider,
      baseUrl: baseUrl || undefined,
      model: useCustomModel ? customModel : model,
      maxTokens,
      temperature,
    };
    if (apiKey) {
      data.apiKey = apiKey;
    }
    if (tavilyApiKey) {
      data.tavilyApiKey = tavilyApiKey;
    }
    updateMutation.mutate(data);
    setLlmTestResult(null);
    setTavilyTestResult(null);
  };

  const handleTestLLM = () => {
    setLlmTestResult(null);
    llmTestMutation.mutate();
  };

  const handleTestTavily = () => {
    setTavilyTestResult(null);
    tavilyTestMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-8 h-8 text-gray-600" />
        <h1 className="text-2xl font-bold">设置</h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-2 mb-6">
          <Cpu className="w-5 h-5 text-primary-600" />
          <h2 className="text-lg font-semibold">LLM 配置</h2>
        </div>

        <div className="space-y-6">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              提供商
            </label>
            <select
              value={provider}
              onChange={(e) => {
                const newProvider = e.target.value as 'openai' | 'anthropic';
                setProvider(newProvider);
                if (!useCustomModel) {
                  setModel(PROVIDER_MODELS[newProvider][0]);
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="openai">OpenAI (兼容)</option>
              <option value="anthropic">Anthropic (兼容)</option>
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <Link className="w-4 h-4" />
                Base URL
                <span className="text-xs text-gray-400">(可选，用于兼容 API)</span>
              </div>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如: https://api.example.com/v1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                API Key
                {config?.hasApiKey && (
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                    已配置
                  </span>
                )}
              </div>
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.hasApiKey ? '输入新的 API Key 以更新' : '输入 API Key'}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Tavily API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                Tavily API Key
                {config?.hasTavilyApiKey && (
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                    已配置
                  </span>
                )}
              </div>
            </label>
            <div className="relative">
              <input
                type={showTavilyApiKey ? 'text' : 'password'}
                value={tavilyApiKey}
                onChange={(e) => setTavilyApiKey(e.target.value)}
                placeholder={config?.hasTavilyApiKey ? '输入新的 Tavily Key 以更新' : '输入 Tavily API Key'}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                type="button"
                onClick={() => setShowTavilyApiKey(!showTavilyApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showTavilyApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              模型
            </label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useCustomModel"
                  checked={useCustomModel}
                  onChange={(e) => setUseCustomModel(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="useCustomModel" className="text-sm text-gray-600">
                  使用自定义模型名称
                </label>
              </div>

              {useCustomModel ? (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="输入模型名称，例如: claude-3-5-sonnet-20241022"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              ) : (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  {PROVIDER_MODELS[provider].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              最大 Tokens: {maxTokens}
            </label>
            <input
              type="range"
              min="256"
              max="8192"
              step="256"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>256</span>
              <span>8192</span>
            </div>
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Temperature: {temperature.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0 (精确)</span>
              <span>1 (创意)</span>
            </div>
          </div>

          {/* LLM Test Result */}
          {llmTestResult && (
            <div
              className={clsx(
                'flex items-center gap-2 p-3 rounded-lg',
                llmTestResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              )}
            >
              {llmTestResult.success ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5" />
              )}
              <span>LLM: {llmTestResult.message}</span>
            </div>
          )}

          {/* Tavily Test Result */}
          {tavilyTestResult && (
            <div
              className={clsx(
                'flex items-center gap-2 p-3 rounded-lg',
                tavilyTestResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              )}
            >
              {tavilyTestResult.success ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5" />
              )}
              <span>Tavily: {tavilyTestResult.message}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t">
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className={clsx(
                'flex-1 px-4 py-2 rounded-lg font-medium transition-colors',
                'bg-primary-600 text-white hover:bg-primary-700',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {updateMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  保存中...
                </span>
              ) : (
                '保存配置'
              )}
            </button>
            <button
              onClick={handleTestLLM}
              disabled={llmTestMutation.isPending || !config?.hasApiKey}
              className={clsx(
                'px-4 py-2 rounded-lg font-medium transition-colors',
                'border border-gray-300 text-gray-700 hover:bg-gray-50',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {llmTestMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  LLM 测试中...
                </span>
              ) : (
                '测试 LLM'
              )}
            </button>
            <button
              onClick={handleTestTavily}
              disabled={tavilyTestMutation.isPending || !config?.hasTavilyApiKey}
              className={clsx(
                'px-4 py-2 rounded-lg font-medium transition-colors',
                'border border-gray-300 text-gray-700 hover:bg-gray-50',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {tavilyTestMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Tavily 测试中...
                </span>
              ) : (
                '测试 Tavily'
              )}
            </button>
          </div>

          {updateMutation.isSuccess && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" />
              配置已保存
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
