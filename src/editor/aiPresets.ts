// 常见模型服务的预设。地址与模型名可能随服务商更新，均可在设置中修改。
export interface AiPreset {
  key: string
  name: string
  provider: 'openai' | 'anthropic'
  baseUrl: string
  model: string
  keyUrl?: string
  note?: string
}

export const AI_PRESETS: AiPreset[] = [
  { key: 'deepseek', name: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { key: 'qwen', name: '通义千问（阿里云百炼）', provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/' },
  { key: 'kimi', name: 'Kimi（月之暗面）', provider: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-latest', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { key: 'glm', name: '智谱 GLM', provider: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { key: 'doubao', name: '豆包（火山方舟）', provider: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '', keyUrl: 'https://console.volcengine.com/ark', note: '模型名填写方舟控制台中的模型 ID 或推理接入点 ID' },
  { key: 'minimax', name: 'MiniMax', provider: 'openai', baseUrl: 'https://api.minimaxi.com/v1', model: '', keyUrl: 'https://platform.minimaxi.com/', note: '模型名以控制台为准' },
  { key: 'mimo', name: '小米 MiMo', provider: 'openai', baseUrl: '', model: '', note: '请填写小米开放平台提供的 OpenAI 兼容地址与模型名' },
  { key: 'openai', name: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', keyUrl: 'https://platform.openai.com/api-keys' },
  { key: 'claude', name: 'Claude（Anthropic）', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/' },
  { key: 'gemini', name: 'Google Gemini', provider: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', keyUrl: 'https://aistudio.google.com/apikey' },
  { key: 'openrouter', name: 'OpenRouter（聚合多家模型）', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', keyUrl: 'https://openrouter.ai/keys' },
  { key: 'siliconflow', name: '硅基流动 SiliconFlow', provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: '', keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { key: 'ollama', name: 'Ollama（本机模型，无需密钥）', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b' },
  { key: 'custom', name: '自定义（任意 OpenAI 兼容接口）', provider: 'openai', baseUrl: '', model: '' },
]
