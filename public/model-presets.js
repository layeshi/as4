// Public operator configuration. Never put credentials here; model IDs remain editable by the user.
export const MODEL_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', variants: [{ id: 'general', name: '官方 API', provider: 'openai', baseURL: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'] }] },
  { id: 'glm', name: '智谱 GLM', variants: [
    { id: 'general', name: '通用 API', provider: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: [] },
    { id: 'coding', name: '编程套餐', provider: 'openai', baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', models: [] },
  ] },
  { id: 'qwen', name: '通义千问', hint: '默认北京地域；其他地域请按账户修改接口地址。', variants: [{ id: 'general', name: '北京 API', provider: 'openai', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus'] }] },
  { id: 'kimi', name: 'Kimi', variants: [{ id: 'general', name: '官方 API', provider: 'openai', baseURL: 'https://api.moonshot.cn/v1', models: [] }] },
  { id: 'doubao', name: '豆包', hint: '模型 ID 或接入点 ID 以火山方舟控制台为准。', variants: [{ id: 'general', name: '北京 API', provider: 'openai', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-2-1-pro-260628'] }] },
  { id: 'openai', name: 'OpenAI', variants: [
    { id: 'chat', name: 'Chat', provider: 'openai', baseURL: 'https://api.openai.com/v1', models: [] },
    { id: 'responses', name: 'Responses', provider: 'openai-responses', baseURL: 'https://api.openai.com/v1', models: [] },
  ] },
  { id: 'anthropic', name: 'Anthropic', variants: [{ id: 'general', name: '官方 API', provider: 'anthropic', baseURL: 'https://api.anthropic.com', models: [] }] },
  { id: 'custom', name: '自定义', variants: [{ id: 'general', name: '自定义接口', provider: 'openai', baseURL: '', models: [] }] },
];
