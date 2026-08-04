const fs = require('fs');
let raw = fs.readFileSync('vparse-deep.js', 'utf8');
const hasCRLF = raw.indexOf('\r\n') >= 0;
let s = raw.replace(/\r\n/g, '\n');

function splice(begin, end, inject, tag) {
  const i = s.indexOf(begin);
  if (i < 0) throw new Error('NOT FOUND begin: ' + tag + ' -> ' + begin.slice(0, 40));
  const j = s.indexOf(end, i + begin.length);
  if (j < 0) throw new Error('NOT FOUND end: ' + tag + ' -> ' + end.slice(0, 40));
  s = s.slice(0, i) + inject + s.slice(j + end.length);
}
const read = f => fs.readFileSync(f, 'utf8');

// 1) 常量：ZHIPU_KEY/ZHIPU_MODEL 行 -> 通用注册表 + 配置键
splice(
  "  const ZHIPU_KEY = 'vp_zhipu_key', ZHIPU_MODEL = 'vp_zhipu_model', WHISPER_MODEL_KEY = 'vp_whisper_model';",
  "  const CDN = {",
  read('_s_const.js') + "\n",
  'const'
);

// 2) 旧 aiKey* 函数 -> 通用 aiConf*
splice(
  "  function aiKeyGet() { try { return localStorage.getItem(ZHIPU_KEY) || ''; } catch (e) { return ''; } }",
  "  function aiModelSet(v) { try { localStorage.setItem(ZHIPU_MODEL, v); } catch (e) {} }",
  read('_s_conf.js'),
  'conf'
);

// 3) vpRunAI 整段 -> 通用调用
splice(
  "  async function vpRunAI() {",
  "  function parseAi(txt) {",
  read('_s_runai.js') + "\n",
  'runai'
);

// 4) AI 设置弹窗函数 -> 通用服务商配置
splice(
  "  // ---- AI 设置弹窗 ----",
  "  // ============================================================\n  // 信息流投放理解分析",
  read('_s_modal.js') + "\n",
  'modal'
);

// 5) initVParseDeep 增加 provider 切换绑定
splice(
  "    b('vpAiClear', clearAiKey);",
  "    const mask = document.getElementById('vpAiMask');",
  "    b('vpAiClear', clearAiKey);\n    const _pv = document.getElementById('vpAiProvider'); if (_pv) _pv.addEventListener('change', onProviderChange);\n",
  'bind'
);

if (hasCRLF) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync('vparse-deep.js', s);
console.log('vparse-deep.js patched OK');
