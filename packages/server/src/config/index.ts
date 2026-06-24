import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-key',
  databasePath: process.env.DATABASE_PATH || './data/remotecli.db',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  voice: {
    enabled: process.env.VOICE_ENABLED !== 'false',
    baiduAppId: process.env.BAIDU_APP_ID || '',
    baiduApiKey: process.env.BAIDU_API_KEY || '',
    baiduSecretKey: process.env.BAIDU_SECRET_KEY || '',
    sttLanguage: process.env.STT_LANGUAGE || 'zh',
    ttsVoice: process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural',
    ttsRate: process.env.TTS_RATE || '+10%',
    // 服务器端 LLM 配置（用于 UI 操作映射）
    llmProvider: process.env.VOICE_LLM_PROVIDER || 'baidu',  // 'openai' | 'baidu' | 'none'
    llmApiUrl: process.env.VOICE_LLM_API_URL || '',
    llmApiKey: process.env.VOICE_LLM_API_KEY || '',
    llmModel: process.env.VOICE_LLM_MODEL || 'ernie-speed-128k',
  },
};