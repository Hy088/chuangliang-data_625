  const WHISPER_MODEL_KEY = 'vp_whisper_model';

  // ---- AI 服务商注册表（通用可插拔：随时换 Key / 模型 / 任意 OpenAI 兼容接口）----
  const AI_PROVIDERS = {
    zhipu:    { label: '智谱 GLM (BigModel)', base: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4v-flash', 'glm-4v-plus', 'glm-4v', 'glm-4-plus'], def: 'glm-4v-flash', vision: true },
    openai:   { label: 'OpenAI',              base: 'https://api.openai.com/v1',            models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], def: 'gpt-4o-mini', vision: true },
    deepseek: { label: 'DeepSeek',            base: 'https://api.deepseek.com/v1',          models: ['deepseek-chat', 'deepseek-reasoner'], def: 'deepseek-chat', vision: false },
    moonshot: { label: 'Kimi (月之暗面)',     base: 'https://api.moonshot.cn/v1',           models: ['moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview'], def: 'moonshot-v1-8k-vision-preview', vision: true },
    qwen:     { label: '通义千问 (阿里)',     base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen-max'], def: 'qwen-vl-plus', vision: true },
    custom:   { label: '自定义 (OpenAI 兼容)', base: '', models: [], def: '', vision: true }
  };
  const AI_PROV = 'vp_ai_provider', AI_BASE = 'vp_ai_base', AI_KEY = 'vp_ai_key', AI_MODEL = 'vp_ai_model';
