/* ============================================================
 * 视频解析 · 深度分析 / AI语义拆解 / 语音转写兜底
 * 全部在浏览器端运行：零 Key 本地分析（OCR+音频+检测）+ 智谱 GLM-4V-Flash 免费语义拆解
 * 依赖：主脚本已定义 VP / $ / $$ / autoVParse / vpDownload 等全局
 * ============================================================ */
(function () {
  'use strict';

  // ---- 全局状态 ----
  if (typeof VP !== 'undefined') {
    VP.deep = VP.deep || { ocr: [], audio: null, detect: null, whisper: null };
    VP.ai = VP.ai || null;
  }
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
  const CDN = {

    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    coco: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
    transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3'
  };
  const AI_PROMPT = `你是一名资深短视频投放创意分析师，擅长信息流广告素材拆解。下面是一段广告素材的若干均匀抽帧画面（按时间先后顺序排列），以及该素材在投放后台的真实数据。请结合画面与数据，输出一份「爆款视频拆解分析」风格的结构化结果，严格只输出如下 JSON（不要 markdown 代码块、不要任何解释文字）。

{
  "storyboard": [
    {"frame": "帧1 · 0-3s", "stage": "开场/钩子", "desc": "画面描述：黑底红字『请注意』+黄字『您已获得淘宝优惠福利』+大字『16卷卷纸1分钱』"},
    {"frame": "帧3 · 23s", "stage": "产品证明/信任状", "desc": "户外真人手持超大卷纸，左上角淘宝角标+¥0.01，字幕『本来以为是假的』制造反转"}
  ],
  "analysis": {
    "hook": "开头3秒用什么钩子、为什么能抓住注意力（1-3句）",
    "structure": "用『1. 0-3s：… 2. 3-10s：…』形式概括整条视频的分镜结构（4-6条）",
    "selling_points": ["价格锚点：¥0.01起/1分钱16卷", "产品卖点：生态原色加柔加厚", "信任背书：真人实拍+平台角标", "稀缺门槛：仅限一年未购用户"],
    "script_direction": "一段可直接参考的口播脚本方向（含时间节奏，3-6句）",
    "replicable": ["钩子公式：请注意+已获得+极端低价", "视觉公式：黑底大字报→真人开箱→超大道具", "信任公式：反套路字幕把怀疑变点击", "门槛公式：仅限XX用户既解释低价又催行动"]
  },
  "next_actions": ["用同样脚本模板替换不同品类测试钩子有效性", "做A/B：黑底大字报 vs 真人出镜开场", "跟踪下一周期指标，CPA上涨及时迭代结尾CTA"]
}

字段说明：
- storyboard：按时间顺序拆解画面，frame 用『帧N · 起止秒数』或『起止秒数』，stage 为阶段名，desc 为画面+字幕要点（2-6条）。
- analysis.hook：开头 3 秒钩子拆解（为什么抓注意力）。
- analysis.structure：整条视频的分镜结构，用编号列表概括（4-6条）。
- analysis.selling_points：3-6 个核心卖点/痛点。
- analysis.script_direction：可复刻的口播脚本方向（带时间节奏）。
- analysis.replicable：可复制的创意公式（钩子/视觉/信任/门槛等）。
- next_actions：3 条后续可执行动作。
若提供了口播时间轴，请优先结合时间轴理解素材节奏再拆解。

【严禁重复 · 必须严格遵守，否则结果无效】
1. 各字段内容必须彼此独立、互不重复：storyboard 讲"画面发生了什么"，analysis.structure 讲"整体编排逻辑"，两者不得写相同的镜头描述。
2. analysis.selling_points（卖点）与 analysis.replicable（可复制方向）必须各有侧重：前者讲"这个素材好在哪 / 卖了什么"，后者讲"别人怎么抄这个公式"，禁止出现相同或近似的句子。
3. 同一字段内的多条内容不得重复或高度相似；不得把同一句话换种说法写两遍。
4. analysis.hook / analysis.structure / analysis.script_direction 三段不要复述彼此的核心信息。
5. 字数克制：每个字段只写必要内容，宁少勿滥，绝不为了凑数而重复。`;

  // 复刻生产型 prompt：输出 decompose（拆解卡）/ scripts（复刻口播）/ jimeng（即梦提示词）三件套
  const REPLICATE_PROMPT = `你是一名有 8 年经验的短视频信息流投放操盘手，亲手拍剪过上千条跑量素材。下面是一段跑量素材的抽帧画面、投放后台真实数据、以及识别出的口播。

你的任务不是"分析评价"，而是帮用户**逐秒复刻出一条能直接拍 / 剪 / 生成的新素材**。请严格只输出如下 JSON（不要 markdown 代码块、不要任何解释文字）：

{
  "decompose": {
    "hook_type": "钩子类型（如：悬念反问 / 利益前置 / 反常识 / 恐吓痛点 / 身份代入）",
    "first3s": "前3秒钩子具体怎么做（画面+字幕+口播，1-2句）",
    "pain": ["目标人群核心痛点1", "痛点2"],
    "sell": ["核心卖点/利益点1", "卖点2", "卖点3"],
    "trust": ["信任背书方式1（真人/检测/销量/平台/权威）", "…"],
    "cta": "结尾行动号召怎么做的",
    "emotion": "整条情绪曲线（如：焦虑→好奇→信任→急迫）",
    "storyboard": [
      {"t":"0s","frame":"这一秒画面里具体有什么、镜头怎么动","subtitle":"这一秒字幕上写的原话（没有就空串）","voice":"这一秒口播说的原话（真人自然口吻，见下方话术要求）"},
      {"t":"1s","frame":"…","subtitle":"…","voice":"…"}
    ]
  },
  "scripts": [
    {"label":"复刻·换钩子","text":"全新口播，保留跑量公式换表达，150字内，口语化有钩子有CTA"},
    {"label":"复刻·换人群","text":"…"},
    {"label":"复刻·原公式","text":"…"}
  ],
  "jimeng": [
    {"label":"即梦·开篇钩子镜头","prompt":"可直接丢进即梦文生/图生视频的提示词：主体+场景+运镜+风格+时长+字幕位置，中文"},
    {"label":"即梦·产品展示镜头","prompt":"…"},
    {"label":"即梦·结尾CTA镜头","prompt":"…"}
  ]
}

字段要求：
- decompose 是复刻蓝本。
- **storyboard 必须逐秒拆解**：每一秒一个对象，t 用 "0s","1s","2s"… 一直排到整条结束；若素材超过 30 秒，前 30 秒严格逐秒，30 秒之后每 3 秒一个（t 标 "30-33s" 等）。覆盖整条时长，中间不得跳过任何一秒。
- storyboard 每个对象的 voice 是该秒口播**说的原话**（不是要点），subtitle 是该秒**字幕上的原话**，frame 是该秒**画面具体元素 + 镜头运动**。三者要能对上，像真人边展示边说。
- scripts 基于 decompose 的卖点与公式，生成 3 条差异化全新口播（换钩子/换人群/原公式各1条），每条≤150字、口语化、必须有钩子与 CTA、禁止照搬原素材口播。
- jimeng 给出 3 个可直接用于即梦(文生视频/图生视频)的镜头提示词，覆盖开篇钩子/产品展示/结尾CTA，中文，含主体、场景、运镜、风格、建议时长与字幕叠加位置。

【话术要求 · 最重要】口播 voice 与 scripts 的 text 必须像**真人投放操盘手 / 带货博主**自然说的话，严禁 AI 味：
- 禁止套话空话：不要"在这个快节奏的时代""想象一下""首先…其次…最后""总之""不难发现""值得一提的是""众所周知"。
- 禁止堆 emoji、禁止书面营销腔（"尊享""甄选""助力""赋能"这类能不用就不用）。
- 用短句、断句、口语词："你看""真的""说实话""咱""我家""我跟你讲""来"。
- 有互动感、像边拍边说："来，看这个""你猜怎么着""不是我吹""你仔细看"。
- 每句都要有具体信息（价格 / 数字 / 动作 / 场景），不许说空话套话。
- 允许口语瑕疵、允许关键卖点自然重复（真人带货就爱重复），但要自然不生硬。
若提供了口播时间轴，请优先结合它理解节奏与断句。各字段内容互不重复。`;


  // ---- 工具 ----
  function loadScript(src, timeoutMs) {
    return new Promise((res, rej) => {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing && existing.dataset.loaded === '1') { res(); return; }
      const s = document.createElement('script');
      let t = null;
      if (timeoutMs) t = setTimeout(() => { s.remove(); rej(new Error('加载超时: ' + src)); }, timeoutMs);
      s.src = src;
      s.onload = () => { if (t) clearTimeout(t); s.dataset.loaded = '1'; res(); };
      s.onerror = () => { if (t) clearTimeout(t); s.remove(); rej(new Error('CDN 加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function withTimeout(p, ms, label) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error((label || '操作') + ' 超时')), ms))]);
  }
  function showCard(id) { const e = document.getElementById(id); if (e) e.style.display = 'block'; }
  function showProg(on) { const e = document.getElementById('vpDeepProg'); if (e) e.style.display = on ? 'block' : 'none'; }
  function setProg(p, txt) {
    const bar = document.getElementById('vpDeepBar'), t = document.getElementById('vpDeepProgTxt');
    if (bar) bar.style.width = Math.max(0, Math.min(100, p)) + '%';
    if (t) t.textContent = txt || '';
  }
  let _hideTimer = null;
  function hideProgSoon() { clearTimeout(_hideTimer); _hideTimer = setTimeout(() => showProg(false), 2600); }
  function fmtSec(s) { return (s == null ? '0' : (+s).toFixed(1)) + 's'; }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // 语音识别后处理：繁简转换 + 电商口播常见错字纠正 + 重复词去重
  function correctAsrText(s) {
    if (!s) return s;
    // 1) 常用繁体 → 简体
    const ft = '獲點擊領請連結購買優惠運費寶貝親們時間動態權議現實體騰訊號關係絡紅綠藍黃門開來進過這說話認識讓覺處問題對錯難簡單個們為無論調節務準備復雜類級統計劃';
    const jt = '获点击领请连接购买优惠运费宝贝亲们时间动态权议现实体腾讯号关系络红绿蓝黄门开来进过这说话认识让觉处问题对错难简单个们为无论调节务准备复杂类级统计划';
    const ftMap = {}; for (let i = 0; i < ft.length; i++) ftMap[ft[i]] = jt[i];
    let t = s.split('').map(c => ftMap[c] || c).join('');
    // 2) 常见错字/同音替换（按长度降序，避免短词覆盖长词）
    const fixes = [
      ['鸭宝', '淘宝'], ['练接', '链接'], ['练结', '链接'], ['包油', '包邮'],
      ['鱼散', '雨伞'], ['鱼伞', '雨伞'], ['平单', '免单'], ['欣架', '下架'], ['砍架', '砍价'],
      ['新动', '心动'], ['点撃', '点击'], ['点擊', '点击'], ['领娶', '领取'],
      ['福利架', '福利价'], ['夹包油', '加包邮'], ['架包油', '加包邮'], ['倒加', '点击'],
      ['本天', '每天'], ['权蔡', '权限'], ['权议', '权益'], ['以鸭', '以淘'],
      ['动或', '活动'], ['具體', '具体'], ['情調', '情况'], ['住在左下角', '在左下角']
    ];
    fixes.sort((a, b) => b[0].length - a[0].length);
    for (const [bad, good] of fixes) {
      t = t.split(bad).join(good);
    }
    // 3) 连续重复词去重（如"链接链接"→"链接"，最多保留2次避免误判）
    t = t.replace(/([^\s，。！？；：,.!?;:\n\r]{2,})\1{2,}/g, '$1$1');
    t = t.replace(/([^\s，。！？；：,.!?;:\n\r]{2,})\1(?=[\s，。！？；：,.!?;:\n\r]|$)/g, '$1');
    return t;
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // 读取通用 AI 配置：未填自定义 base / model 时回退到所选服务商的预设默认值
  function aiConfGet() {
    const provider = lsGet(AI_PROV) || 'zhipu';
    const p = AI_PROVIDERS[provider] || AI_PROVIDERS.zhipu;
    const base = (lsGet(AI_BASE) || '').trim() || p.base;
    const model = (lsGet(AI_MODEL) || '').trim() || p.def;
    return { provider, base, key: lsGet(AI_KEY), model, vision: p.vision !== false };
  }
  function aiConfSet(o) {
    lsSet(AI_PROV, o.provider || 'zhipu');
    lsSet(AI_BASE, (o.base || '').trim());
    lsSet(AI_KEY, (o.key || '').trim());
    lsSet(AI_MODEL, (o.model || '').trim());
  }
  function aiConfReady() { return !!lsGet(AI_KEY); }

  function whisperModelGet() { try { return localStorage.getItem(WHISPER_MODEL_KEY) || 'Xenova/whisper-base'; } catch (e) { return 'Xenova/whisper-base'; } }
  function whisperModelSet(v) { try { localStorage.setItem(WHISPER_MODEL_KEY, v); } catch (e) {} }

  // ---- 音频解码 / 重采样 ----
  async function getAudioBuffer() {
    const resp = await fetch(VP.url);
    const buf = await resp.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    return await ctx.decodeAudioData(buf);
  }
  function mixToMono(ab) {
    if (ab.numberOfChannels === 1) return ab.getChannelData(0);
    const chs = [], len = ab.length;
    for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) { let s = 0; for (let c = 0; c < chs.length; c++) s += chs[c][i]; out[i] = s / chs.length; }
    return out;
  }
  function resampleTo16k(ab) {
    const ch = mixToMono(ab), sr = ab.sampleRate;
    const targetLen = Math.max(1, Math.floor(ch.length * 16000 / sr));
    const out = new Float32Array(targetLen);
    const ratio = sr / 16000;
    for (let i = 0; i < targetLen; i++) {
      const idx = i * ratio, i0 = Math.floor(idx), i1 = Math.min(i0 + 1, ch.length - 1), f = idx - i0;
      out[i] = ch[i0] * (1 - f) + ch[i1] * f;
    }
    return out;
  }
  function analyzeAudioBuffer(ab) {
    const ch = mixToMono(ab), sr = ab.sampleRate, win = Math.max(1, Math.floor(sr * 0.05));
    const nWin = Math.floor(ch.length / win);
    const rms = new Float32Array(nWin);
    let peak = 0;
    for (let i = 0; i < nWin; i++) { let s = 0; for (let j = 0; j < win; j++) { const v = ch[i * win + j]; s += v * v; } const r = Math.sqrt(s / win); rms[i] = r; if (r > peak) peak = r; }
    const thr = (peak * 0.15) || 0.005;
    let speech = 0, silenceRuns = 0, inSil = false;
    for (let i = 0; i < nWin; i++) {
      const active = rms[i] > thr;
      if (active) { speech++; inSil = false; } else if (!inSil) { silenceRuns++; inSil = true; }
    }
    const density = nWin ? speech / nWin : 0;
    const B = 48, bars = new Array(B).fill(0);
    for (let i = 0; i < nWin; i++) { const b = Math.min(B - 1, Math.floor(i / nWin * B)); bars[b] = Math.max(bars[b], Math.min(1, rms[i] / (peak || 1))); }
    return { density, silence: silenceRuns, peak, bars, dur: ch.length / sr };
  }

  // ---- 图片工具 ----
  function urlToImage(dataURL) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('图片加载失败'));
      img.src = dataURL;
    });
  }
  // 针对视频字幕优化：裁剪底部区域 + 放大 + 灰度二值化
  function preprocessForOCR(dataURL) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const srcW = img.width, srcH = img.height;
        const cropY = Math.floor(srcH * 0.55); // 取底部 45%（字幕常见位置）
        const cropH = Math.max(24, srcH - cropY);
        const scale = 1.8;
        const w = Math.max(100, Math.floor(srcW * scale)), h = Math.max(60, Math.floor(cropH * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, cropY, srcW, cropH, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        // Otsu 阈值自动二值化（简化版：计算均值后取 1.15 倍作为阈值）
        let sum = 0, n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); }
        const mean = sum / n;
        const thr = Math.min(200, Math.max(110, mean * 1.1));
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = g > thr ? 255 : 0;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        res(c.toDataURL('image/png'));
      };
      img.onerror = () => rej(new Error('预处理图片失败'));
      img.src = dataURL;
    });
  }
  function hasChinese(s) { return /[\u4e00-\u9fa5]/.test(s); }
  function cleanOcrText(s) {
    // 保留常见字符，去掉孤立乱码符号
    return String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9\u3000-\u303F\uFF00-\uFFEF\s，。！？、：""''（）【】《》]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function isGarbage(s) {
    if (!s) return true;
    if (hasChinese(s)) return false; // 有中文字就保留
    const letters = s.replace(/[^a-zA-Z]/g, '').length;
    return letters < 3; // 没有中文且英文字母少于3个视为垃圾
  }
  function similar(a, b) {
    // 简单相似度：共同中文字符比例
    const ca = a.replace(/[^\u4e00-\u9fa5]/g, ''), cb = b.replace(/[^\u4e00-\u9fa5]/g, '');
    if (!ca || !cb) return false;
    const m = new Set(cb.split(''));
    let hit = 0;
    for (const ch of ca) if (m.has(ch)) hit++;
    return hit / Math.max(ca.length, cb.length) > 0.6;
  }

  // ============================================================
  // 零 Key 深度分析：OCR 字幕 + 音频节奏 + 人物/物体检测
  // ============================================================
  async function vpRunDeep() {
    if (!VP.video || !VP.frames || !VP.frames.length) { alert('请先选择视频并抽帧（点「重新抽帧」）'); return; }
    showCard('vpDeep'); showProg(true); setProg(2, '准备零 Key 本地分析…');
    try {
      // 1) OCR 中文字幕
      setProg(4, '加载 OCR 引擎（Tesseract.js）…');
      await loadScript(CDN.tesseract);
      const ocr = await runOCR();
      VP.deep.ocr = ocr; renderDeepOcr();

      // 2) 音频节奏
      setProg(45, '解码并分析音轨…');
      try { const ab = await getAudioBuffer(); VP.deep.audio = analyzeAudioBuffer(ab); renderDeepAudio(); }
      catch (e) { const a = document.getElementById('vpAudio'); if (a) a.innerHTML = '<div class="vp-warn">音频分析跳过：' + escapeHtml(e.message) + '</div>'; }

      // 3) 人物 / 物体检测（带超时/失败跳过）
      await runDetectPhase();

      if (typeof autoVParse === 'function') autoVParse();
    } catch (e) {
      setProg(0, '深度分析中断：' + e.message);
    }
  }

  async function runOCR() {
    const frames = (VP.frames || []).filter(f => f.dataURL);
    const raw = [];
    for (let i = 0; i < frames.length; i++) {
      setProg(4 + Math.round(38 * i / frames.length), 'OCR 字幕识别 ' + (i + 1) + '/' + frames.length + '…');
      try {
        const processed = await withTimeout(preprocessForOCR(frames[i].dataURL), 8000, '图片预处理');
        const { data } = await withTimeout(Tesseract.recognize(processed, 'chi_sim+eng', { logger: () => {} }), 15000, 'OCR 识别');
        raw.push({ t: frames[i].t, text: cleanOcrText(data.text) });
      } catch (e) {
        console.warn('OCR 帧失败', e);
        raw.push({ t: frames[i].t, text: '' });
      }
    }
    VP.deep.ocrRaw = raw; // 保留全部原始帧，供「乱码→建议语音」判断
    // 过滤垃圾结果并合并连续相似字幕
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (!r.text || isGarbage(r.text)) continue;
      if (out.length && similar(out[out.length - 1].text, r.text)) continue;
      out.push(r);
    }
    return out;
  }

  async function vpRunOcrDebug() {
    if (!VP.video || !VP.frames || !VP.frames.length) { alert('请先选择视频并抽帧（点「重新抽帧」）'); return; }
    showCard('vpDeep');
    const grid = document.getElementById('vpOcrDebug');
    const box = document.getElementById('vpOcrDebugGrid');
    if (!grid || !box) return;
    grid.style.display = 'block';
    box.innerHTML = '<div class="muted">正在生成每帧预览…</div>';
    showProg(true); setProg(2, 'OCR 调试：逐帧生成预览…');
    const frames = (VP.frames || []).filter(f => f.dataURL);
    const items = [];
    try {
      await loadScript(CDN.tesseract);
      for (let i = 0; i < frames.length; i++) {
        setProg(2 + Math.round(90 * i / frames.length), '调试帧 ' + (i + 1) + '/' + frames.length + '…');
        let processed = '', rawText = '', err = '';
        try { processed = await withTimeout(preprocessForOCR(frames[i].dataURL), 8000, '预处理'); }
        catch (e) { err = '预处理失败'; }
        try {
          const { data } = await withTimeout(Tesseract.recognize(processed || frames[i].dataURL, 'chi_sim+eng', { logger: () => {} }), 15000, 'OCR');
          rawText = (data.text || '').replace(/\s+/g, ' ').trim();
        } catch (e) { err = (err ? err + '；' : '') + 'OCR失败'; }
        items.push({ t: frames[i].t, orig: frames[i].dataURL, proc: processed, raw: rawText, err });
      }
      box.innerHTML = items.map((it, i) => {
        const procImg = it.proc ? '<img src="' + it.proc + '">' : '<div class="muted">无</div>';
        const txt = it.raw ? escapeHtml(it.raw) : '<span class="muted">（空）</span>';
        return '<div class="vp-debug-cell">' +
          '<div class="vp-db-idx">帧 ' + (i + 1) + ' · ' + fmtSec(it.t) + (it.err ? ' · <span class="vp-warn-in">' + it.err + '</span>' : '') + '</div>' +
          '<div class="vp-db-imgs"><img src="' + it.orig + '" class="vp-db-orig"><div class="vp-db-sep">→</div>' + procImg + '</div>' +
          '<div class="vp-db-txt">' + txt + '</div>' +
          '</div>';
      }).join('');
      setProg(100, 'OCR 调试完成'); hideProgSoon();
    } catch (e) {
      box.innerHTML = '<div class="vp-warn">OCR 调试中断：' + escapeHtml(e.message) + '</div>';
      setProg(0, '调试中断');
    }
  }

  async function runDetect() {
    await withTimeout(tf.ready(), 15000, 'TensorFlow.js 初始化');
    const model = await withTimeout(cocoSsd.load({ base: 'lite_mobilenet_v2' }), 45000, 'COCO-SSD 模型加载');
    const frames = (VP.frames || []).filter(f => f.dataURL);
    const objCount = {}; let personMax = 0, personSum = 0;
    for (let i = 0; i < frames.length; i++) {
      setProg(68 + Math.round(28 * i / frames.length), '人物/物体检测 ' + (i + 1) + '/' + frames.length + '…');
      const img = await urlToImage(frames[i].dataURL);
      const preds = await model.detect(img);
      preds.forEach(p => { objCount[p.class] = (objCount[p.class] || 0) + 1; });
      const pers = preds.filter(p => p.class === 'person').length;
      personMax = Math.max(personMax, pers); personSum += pers;
    }
    const objects = Object.entries(objCount).filter(([k]) => k !== 'person').sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v }));
    return { persons: frames.length ? Math.round(personSum / frames.length) : 0, personsMax: personMax, objects };
  }

  async function runDetectPhase() {
    setProg(68, '加载检测模型（COCO-SSD）…'); showProg(true);
    try {
      await loadScript(CDN.tf, 20000); await loadScript(CDN.coco, 20000);
      VP.deep.detect = await runDetect(); renderDeepDetect();
      applyDeepHints();
      setProg(100, '深度分析完成'); hideProgSoon();
    } catch (e) {
      console.warn('人物/物体检测失败', e);
      VP.deep.detect = null;
      renderDeepDetectError('人物/物体检测模型加载失败或超时（常见原因：TensorFlow 模型服务器访问慢/被墙）。OCR 与音频节奏结果仍可用。');
      applyDeepHints();
      setProg(100, '深度分析完成（人物检测已跳过）'); hideProgSoon();
    }
  }

  // ---- 渲染 ----
  function renderDeepOcr() {
    const el = document.getElementById('vpOcr'); if (!el) return;
    const ocr = (VP.deep.ocr || []).filter(x => x.text);
    const whisper = VP.deep.whisper;
    const wb = document.getElementById('vpWhisperBtn');
    // OCR 出乱码但未过滤出有效字幕：提示改用语音识别
    const raw = (VP.deep.ocrRaw || []).filter(x => x.text && x.text.trim());
    if (!ocr.length && raw.length && !whisper) {
      el.innerHTML = '<div class="vp-warn" style="line-height:1.8">⚠️ 字幕 OCR 识别结果多为乱码（视频字幕字体/背景干扰大）。' +
        '建议改用 <b>🎙 语音识别</b>（浏览器端 Whisper 直接转写音轨，对中文更可靠）：' +
        '<br><button class="btn sm primary" id="vpOcrToWhisper" type="button" style="margin-top:8px">↪ 改用语音识别</button></div>';
      const b = document.getElementById('vpOcrToWhisper');
      if (b) b.onclick = () => vpRunWhisper();
      if (wb) wb.style.display = 'inline-block';
      const t = document.getElementById('vpOcrTag'); if (t) t.textContent = 'OCR乱码';
      return;
    }
    if (!ocr.length && !whisper) {
      el.innerHTML = '<div class="muted">未在画面上识别到字幕/口播文字。可点下方「🎙 语音识别」用浏览器端 Whisper 转写音轨。</div>';
      if (wb) wb.style.display = 'inline-block';
      const t = document.getElementById('vpOcrTag'); if (t) t.textContent = '未识别';
      return;
    }
    let html = '';
    if (ocr.length) ocr.forEach(f => { html += '<div class="vp-sub">' + fmtSec(f.t) + '　' + escapeHtml(f.text) + '</div>'; });
    if (whisper) html += '<div class="vp-sub" style="border-left-color:var(--brand2);background:var(--greenbg)"><b>🎙 语音转写：</b>' + escapeHtml(whisper) + '</div>';
    el.innerHTML = html;
    const t = document.getElementById('vpOcrTag'); if (t) t.textContent = ocr.length + ' 帧有字幕';
    if (wb && !whisper) wb.style.display = 'inline-block';
  }

  function renderDeepAudio() {
    const el = document.getElementById('vpAudio'); if (!el) return;
    const a = VP.deep.audio; if (!a) { el.innerHTML = '<div class="muted">无音频数据</div>'; return; }
    const bars = a.bars.map(v => '<i style="height:' + Math.max(2, Math.round(v * 100)) + '%"></i>').join('');
    const dens = Math.round(a.density * 100);
    const level = a.density > 0.6 ? '强口播型' : a.density > 0.3 ? '中等口播' : '弱口播/静音多';
    el.innerHTML =
      '<div class="vp-meter">' + bars + '</div>' +
      '<div>口播占比约 <b>' + dens + '%</b>（' + level + '） · 静音段 <b>' + a.silence + '</b> 段 · 时长 ' + fmtSec(a.dur) + '</div>';
    const t = document.getElementById('vpAudioTag'); if (t) t.textContent = dens + '% 口播';
  }

  function renderDeepDetect() {
    const el = document.getElementById('vpDetect'); if (!el) return;
    const d = VP.deep.detect; if (!d) { el.innerHTML = '<div class="muted">无检测数据</div>'; return; }
    let html = '<div>平均出镜人物 <b>' + d.persons + '</b> 人（单帧最多 ' + d.personsMax + ' 人）' + (d.persons >= 2 ? ' · 可能为对话/多人场景' : '') + '</div>';
    if (d.objects && d.objects.length) {
      html += '<div style="margin-top:8px">' + d.objects.slice(0, 10).map(o => '<span class="vp-detect-tag">' + escapeHtml(o.k) + ' ×' + o.v + '</span>').join('') + '</div>';
    } else { html += '<div class="muted" style="margin-top:6px">未检出明显物体</div>'; }
    el.innerHTML = html;
    const t = document.getElementById('vpDetectTag'); if (t) t.textContent = d.persons + ' 人';
  }
  function renderDeepDetectError(msg) {
    const el = document.getElementById('vpDetect'); if (!el) return;
    el.innerHTML = '<div class="vp-warn" style="line-height:1.7">' + escapeHtml(msg) +
      '<br><button class="btn sm" id="vpDetectRetry" type="button" style="margin-top:8px">重试人物检测</button></div>';
    const b = document.getElementById('vpDetectRetry');
    if (b) b.onclick = () => { VP.deep.detect = null; runDetectPhase(); };
    const t = document.getElementById('vpDetectTag'); if (t) t.textContent = '检测失败';
  }

  function applyDeepHints() {
    const d = VP.deep || {}; const dirEl = document.getElementById('vpDir'); if (!dirEl) return;
    const notes = [];
    if (d.detect && d.detect.persons != null) {
      notes.push('画面人物：' + d.detect.persons + ' 人出镜' + (d.detect.persons >= 2 ? '（多人/对话型）' : '') +
        '；主要物体：' + ((d.detect.objects || []).slice(0, 4).map(o => o.k).join('、') || '—'));
    }
    if (d.audio && d.audio.density != null) {
      notes.push('音频：口播占比约 ' + Math.round(d.audio.density * 100) + '%' + (d.audio.density > 0.6 ? '（强口播型）' : '') + '，静音段 ' + d.audio.silence + ' 段');
    }
    if (notes.length) {
      const add = '\n【深度分析提示】' + notes.join('；');
      const v = dirEl.value || '';
      if (v.indexOf('【深度分析提示】') < 0) dirEl.value = v + add;
    }
  }

  function vpDeepFill() {
    const ocr = (VP.deep.ocr || []).filter(x => x.text).map(x => fmtSec(x.t) + '：' + x.text).join('\n');
    const src = ocr || VP.deep.whisper || '';
    if (!src) { alert('还没有可填入的字幕/语音文字，请先运行「🔍 深度分析」或「🎙 语音转写兜底」。'); return; }
    const el = document.getElementById('vpScript');
    if (el) el.value = (el.value ? el.value + '\n' : '') + '【识别口播】\n' + src;
  }

  // ============================================================
  // 语音识别（transformers.js + Whisper-base，浏览器端 WASM，强制中文）
  // 比 tiny 对中文准确得多；HF 权重首次加载较慢（约 100-200MB），之后走缓存。
  // ============================================================
  const WHISPER_MODEL = 'Xenova/whisper-base'; // tiny 对中文很差，base 明显更准
  async function tryLoadAsr(pipeline, env, cfg, modelName) {
    if (env) {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.remoteHost = cfg.host;
      env.remotePathTemplate = cfg.template;
    }
    // transformers.js 默认 template 使用 {revision}，modelscope 用 master 分支
    return await pipeline('automatic-speech-recognition', modelName, { revision: cfg.revision });
  }

  async function vpRunWhisper() {
    if (!VP.url) { alert('请先选择视频'); return; }
    const btn = document.getElementById('vpWhisperBtn');
    const modelName = whisperModelGet();
    const sizeHint = modelName.indexOf('small') >= 0 ? '约480MB' : '约150MB';
    showCard('vpDeep'); showProg(true); setProg(5, '加载语音识别模型 ' + modelName.replace('Xenova/', '') + '（首次 ' + sizeHint + '，请耐心等待）…');
    let asr = null, lastErr = null;
    try {
      const mod = await import(CDN.transformers);
      const { pipeline, env } = mod;
      // 镜像顺序：ModelScope（阿里，国内最稳）→ hf-mirror（社区镜像）→ HuggingFace 官方
      const mirrors = [
        { name: 'ModelScope（阿里）', host: 'https://modelscope.cn', template: 'models/{model}/resolve/{revision}/', revision: 'master' },
        { name: 'hf-mirror', host: 'https://hf-mirror.com', template: '{model}/resolve/{revision}/', revision: 'main' },
        { name: 'HuggingFace 官方', host: 'https://huggingface.co', template: '{model}/resolve/{revision}/', revision: 'main' }
      ];
      for (const m of mirrors) {
        try {
          setProg(5, '尝试从 ' + m.name + ' 加载模型…');
          asr = await tryLoadAsr(pipeline, env, m, modelName);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          console.warn('语音识别模型源 ' + m.name + ' 失败：', e.message || e);
          continue;
        }
      }
      if (!asr) throw (lastErr || new Error('所有模型镜像均无法访问'));
      setProg(45, '解码音轨…');
      const ab = await getAudioBuffer();
      const samples = resampleTo16k(ab);
      setProg(70, '识别中（可能需 10-60 秒）…');
      const out = await asr(samples, {
        sampling_rate: 16000, language: 'chinese', task: 'transcribe',
        chunk_length_s: 30, stride_length_s: 5, return_timestamps: true
      });
      let segs = [];
      if (out && Array.isArray(out.segments)) {
        segs = out.segments.map(s => ({ start: s.start, end: s.end, text: (s.text || '').trim() }));
      } else if (out && Array.isArray(out.chunks)) {
        segs = out.chunks.map(c => {
          const ts = c.timestamp || [null, null];
          return { start: ts[0], end: ts[1], text: (c.text || '').trim() };
        });
      }
      segs = segs.filter(s => s.text);
      const rawLines = segs.map(s => fmtSec(s.start) + '-' + fmtSec(s.end) + '：' + s.text).join('\n');
      const text = correctAsrText(rawLines);
      VP.deep.whisper = text;
      VP.deep.whisperRaw = rawLines; // 保留原始识别结果供对照
      VP.deep.whisperSegs = segs;
      renderDeepOcr();
      if (text.trim()) setProg(100, '语音识别完成'); else setProg(0, '未识别到语音内容');
      hideProgSoon();
    } catch (e) {
      const isFetch = (e.message || '').toLowerCase().indexOf('fetch') >= 0 || (e.message || '').toLowerCase().indexOf('network') >= 0;
      const tip = isFetch
        ? '（模型下载失败：已依次尝试 ModelScope/阿里、hf-mirror、HuggingFace 官方，均无法访问。建议换网络，或使用下方「本地离线版」）'
        : '（识别过程出错，可刷新后重试）';
      setProg(0, '语音识别失败：' + (e.message || e) + tip);
    }
  }

  // ============================================================
  // 本次消耗预估（按所选模型单价估算 token / ¥，拆解前可见）
  // ============================================================
  // 已知模型单价（单位：元 / 百万 token；cur:'USD' 的按 7.2 折人民币显示）
  const AI_PRICE = {
    'glm-4v-flash': { in: 0, out: 0, free: true },
    'glm-4v-plus': { in: 0, out: 0, free: true },
    'glm-4v': { in: 0, out: 0, free: true },
    'glm-4-plus': { in: 0, out: 0, free: true },
    'qwen-vl-plus': { in: 0.8, out: 2 },
    'qwen-vl-max': { in: 1.6, out: 4 },
    'qwen-max': { in: 0.02, out: 0.06 },
    'qwen3-vl-plus': { in: 1, out: 10 },
    'qwen3-vl-flash': { in: 0.15, out: 1.5 },
    'deepseek-chat': { in: 1, out: 2 },
    'deepseek-reasoner': { in: 1, out: 4 },
    'moonshot-v1-8k-vision-preview': { in: 8.4, out: 21 },
    'moonshot-v1-32k-vision-preview': { in: 8.4, out: 21 },
    'gpt-4o': { in: 2.5, out: 10, cur: 'USD' },
    'gpt-4o-mini': { in: 0.15, out: 0.6, cur: 'USD' },
    'gpt-4-turbo': { in: 10, out: 30, cur: 'USD' }
  };
  const USD_CNY = 7.2;

  // 与 vpRunAI 完全一致的「送 AI 的抽帧子集」挑选逻辑
  function getAiPickFrames() {
    let frames = (VP.frames || []).filter(f => f.dataURL);
    if (!frames.length) return [];
    const cutEl = document.getElementById('vpCutDur');
    const cut = cutEl ? (parseFloat(cutEl.value) || 0) : 0;
    let cand = frames;
    if (cut > 0) { const flt = frames.filter(f => (f.t || 0) <= cut + 0.5); if (flt.length >= 2) cand = flt; }
    const span = cand.length ? ((cand[cand.length - 1].t || 0) - (cand[0].t || 0)) : 0;
    const target = Math.min(24, Math.max(4, Math.round(span / 12) + 1));
    const step = Math.max(1, Math.ceil(cand.length / target));
    return cand.filter((_, i) => i % step === 0).slice(0, target);
  }

  // 与 vpRunAI 完全一致的提示词构建
  function buildAiPromptText(promptPrefix) {
    let promptText = promptPrefix || AI_PROMPT;
    const durTxt = (VP.meta && VP.meta.duration) ? VP.meta.duration.toFixed(0) : '?';
    const cutEl = document.getElementById('vpCutDur');
    const cut = cutEl ? (parseFloat(cutEl.value) || 0) : 0;
    promptText += '\n\n【分析范围】' + (cut > 0 ? ('视频前 ' + cut + ' 秒') : ('整段视频（约 ' + durTxt + ' 秒）')) + '，请按时间顺序拆解画面，frame 用「起止秒数」标注，且必须覆盖所选时长的全部关键节点。';
    const m = VP.mat || {};
    const metricsParts = [];
    if (m.ctr != null) metricsParts.push('CTR=' + (+m.ctr).toFixed(2) + '%');
    if (m.cvr != null) metricsParts.push('CVR=' + (+m.cvr).toFixed(2) + '%');
    if (m.cost != null) metricsParts.push('消耗=' + (+m.cost).toFixed(2) + '元');
    if (m.cv != null) metricsParts.push('转化=' + (+m.cv));
    if (m.cpa != null) metricsParts.push('CPA=' + (+m.cpa).toFixed(2) + '元');
    if (m.cpm != null) metricsParts.push('CPM=' + (+m.cpm).toFixed(2) + '元');
    if (m.roi != null) metricsParts.push('ROI=' + (+m.roi).toFixed(2));
    if (metricsParts.length) promptText += '\n\n【素材投放数据（来自报表）】\n' + metricsParts.join('，');
    const segs = VP.deep && VP.deep.whisperSegs;
    const whisper = VP.deep && VP.deep.whisper;
    if (segs && segs.length) promptText += '\n\n【口播时间轴】\n' + whisper;
    else if (whisper) promptText += '\n\n【识别口播】\n' + whisper;
    const refCases = (caseGetAll() || []).filter(function (c) { return c.ref && c.content && c.content.trim(); });
    if (refCases.length) {
      promptText += '\n\n【参考案例（请严格参照以下拆解的粒度与风格，但必须基于本次素材的画面与数据独立分析，禁止照抄、禁止与案例内容重复）】\n' +
        refCases.map(function (c, i) { return '案例' + (i + 1) + '：' + (c.title || '') + '\n' + c.content.trim(); }).join('\n\n');
    }
    return promptText;
  }

  function estimateAiCost(outputTokOverride) {
    const conf = aiConfGet();
    const p = AI_PROVIDERS[conf.provider] || AI_PROVIDERS.zhipu;
    const pick = getAiPickFrames();
    // 图片 token：抽帧固定 300px 宽，按 1 token / 32×32 像素 估算
    let framePx = 300 * 168;
    if (VP.meta && VP.meta.w && VP.meta.h) framePx = 300 * Math.max(1, Math.round(300 * (VP.meta.h / VP.meta.w)));
    const perFrameTok = Math.ceil(framePx / 1024);
    const imgTok = p.vision ? pick.length * perFrameTok : 0;
    // 文本 token：按字符数 ×1.3 估算（中文为主）
    const promptText = buildAiPromptText();
    const textTok = Math.ceil(promptText.length * 1.3);
    const inputTok = imgTok + textTok;
    const outputTok = (outputTokOverride != null) ? outputTokOverride : 1024;
    const pr = AI_PRICE[conf.model] || AI_PRICE[p.def] || null;
    let inRate = 0, outRate = 0, free = false, cur = 'CNY', unknown = false;
    if (pr) { inRate = pr.in; outRate = pr.out; free = !!pr.free; cur = pr.cur || 'CNY'; }
    else { unknown = true; }
    let cnyIn = 0, cnyOut = 0;
    if (!free && !unknown) {
      const fx = (cur === 'USD') ? USD_CNY : 1;
      cnyIn = inputTok / 1e6 * inRate * fx;
      cnyOut = outputTok / 1e6 * outRate * fx;
    }
    return { model: conf.model, provider: conf.provider, vision: p.vision, frames: pick.length, perFrameTok: perFrameTok, imgTok: imgTok, textTok: textTok, inputTok: inputTok, outputTok: outputTok, free: free, unknown: unknown, cnyIn: cnyIn, cnyOut: cnyOut, total: cnyIn + cnyOut, hasKey: !!conf.key };
  }

  function renderCostLine(elId, e, label) {
    const elc = document.getElementById(elId); if (!elc) return;
    if (!e || !e.frames) { elc.className = 'vp-cost-est muted'; elc.innerHTML = '加载视频并抽帧后，这里显示本次' + (label || '拆解') + '的消耗预估（含送图帧数 / 估算 token / 预计 ¥）'; elc.title = ''; return; }
    let priceTxt;
    if (e.free) priceTxt = '免费模型（不计费）';
    else if (e.unknown) priceTxt = '单价未内置（以服务商账单为准）';
    else priceTxt = '约 ¥' + e.total.toFixed(4) + '（输入¥' + e.cnyIn.toFixed(4) + ' + 输出¥' + e.cnyOut.toFixed(4) + '）';
    elc.className = 'vp-cost-est' + (e.free ? ' free' : '');
    elc.innerHTML = '🤖 消耗预估 · <b>' + escapeHtml(e.model || '?') + '</b> · 将送 <b>' + e.frames + '</b> 帧' +
      (e.vision ? '（约 ' + e.imgTok + ' 图token）' : '（纯文本，无图）') +
      ' · 输入约 ' + e.inputTok + ' token · 输出≤' + e.outputTok +
      ' · <b>' + priceTxt + '</b>' +
      (e.hasKey ? '' : ' · <span class="warn">未配置 Key</span>');
    elc.title = '图片 token 为估算值（按 300px 宽抽帧、1 token/32×32px）；文本按字符×1.3 估算。改「拆解时长」或「AI 模型」会实时重算。实际以服务商账单为准。';
  }
  function renderCostEstimate() {
    const has = !!(VP.frames && VP.frames.length);
    renderCostLine('vpCostEst', has ? estimateAiCost(1024) : null, '拆解');
    renderCostLine('vpRepCostEst', has ? estimateAiCost(4000) : null, '复刻');
  }
  // 暴露给主脚本（index.html）在抽帧完成后触发
  window.updateVpCostEst = renderCostEstimate;

  // ============================================================
  // 智谱 GLM-4V-Flash 免费语义拆解（浏览器直连，无需后端）
  // ============================================================
  async function vpRunAI() {
    const conf = aiConfGet();
    if (!conf.key) { openAiModal(); return; }
    const pName = (AI_PROVIDERS[conf.provider] || {}).label || conf.provider;
    showCard('vpAi');
    const out = document.getElementById('vpAiOut');
    if (out) out.innerHTML = '<div class="muted">正在调用 ' + escapeHtml(pName) + ' 分析关键帧…</div>';
    try {
      const pick = getAiPickFrames();
      if (!pick.length) { if (out) out.innerHTML = '<div class="vp-warn">请先抽帧（点「重新抽帧」）再拆解。</div>'; return; }
      const promptText = buildAiPromptText();
      const content = [{ type: 'text', text: promptText }];
      // 仅视觉模型才附带截帧图片；纯文本模型（如 deepseek-chat）只发文字，避免报错
      if (conf.vision) pick.forEach(f => content.push({ type: 'image_url', image_url: { url: f.dataURL } }));
      const ep = conf.base.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.key },
        body: JSON.stringify({ model: conf.model, messages: [{ role: 'user', content }], temperature: 0.4, max_tokens: 1024 })
      });
      if (!resp.ok) {
        const t = await resp.text();
        if (resp.status === 401) throw new Error('401 鉴权失败：API Key 无效或已过期（' + pName + '）');
        if (resp.status === 404) throw new Error('404：接口地址不正确，请检查 Base URL（当前 ' + ep + '）');
        if (resp.status === 400) throw new Error('400：请求参数/模型名有误（' + pName + ' · ' + conf.model + '）');
        throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 200));
      }
      const j = await resp.json();
      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!txt) throw new Error('返回内容为空（可能为风控拦截或额度不足）');
      const ai = parseAi(txt);
      dedupeAi(ai);
      VP.ai = ai;
      renderAi(ai, txt);
      applyAiToParse(ai);
    } catch (e) {
      if (out) out.innerHTML = '<div class="vp-warn">AI 拆解失败：' + escapeHtml(e.message) +
        '<br><span class="muted">请检查 Key / Base URL / 模型是否正确，且浏览器能直连该服务（部分服务需经后端代理才能避免跨域 CORS）。</span></div>';
    }
  }
    // ============================================================
  // 🚀 一键复刻跑量素材：拆解卡 + 复刻口播 + 即梦提示词（生产型，非分析型）
  // ============================================================
  function arrOf(x) { return Array.isArray(x) ? x : (x ? [x] : []); }
  function parseReplicate(txt) {
    if (!txt) return null;
    let s = txt.trim();
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) s = m[1].trim();
    try {
      const o = JSON.parse(s);
      if (o.decompose || o.scripts || o.jimeng) {
        const d = o.decompose || {};
        return {
          decompose: {
            hook_type: d.hook_type || '',
            first3s: d.first3s || '',
            pain: arrOf(d.pain),
            sell: arrOf(d.sell),
            trust: arrOf(d.trust),
            cta: d.cta || '',
            emotion: d.emotion || '',
            storyboard: Array.isArray(d.storyboard) ? d.storyboard : []
          },
          scripts: Array.isArray(o.scripts) ? o.scripts : [],
          jimeng: Array.isArray(o.jimeng) ? o.jimeng : []
        };
      }
    } catch (e) {}
    return { raw: txt };
  }
  function repArrHtml(a) { return (Array.isArray(a) && a.length) ? a.map(function (x) { return escapeHtml(x); }).join('；') : '—'; }
  function repGenItem(it, prefix, i) {
    const genBtn = prefix === 'jc'
      ? ' <button type="button" class="btn xs primary" data-jcgen="' + i + '" title="把这条提示词送进本地「AI视频生成工具」（即创自动化）直接出片；需本机已启动工具（launch_tool.bat）">🎬 生成视频</button>'
      : '';
    return '<div class="vp-gen-item"><div class="gh"><span class="gt">' + escapeHtml(it.label || (prefix + '·' + (i + 1))) + '</span></div>' +
      '<div class="gtxt">' + escapeHtml(it.text || '') + '</div>' +
      '<div class="gbtns"><button type="button" class="btn xs" data-' + prefix + '="' + i + '">复制</button>' + genBtn + '</div></div>';
  }
  function repCopy(t, btn) { if (navigator.clipboard) navigator.clipboard.writeText(t); const o = btn.textContent; btn.textContent = '已复制'; setTimeout(function () { btn.textContent = o; }, 1200); }
  function renderReplicate(rep, raw) {
    const out = document.getElementById('vpReplicateOut'); if (!out) return;
    if (rep.raw) { out.innerHTML = '<div class="vp-warn">复刻结果未解析为结构化 JSON，原始返回：<pre style="white-space:pre-wrap;font-size:12px">' + escapeHtml(rep.raw) + '</pre></div>'; return; }
    const d = rep.decompose || {};
    const sb = Array.isArray(d.storyboard) ? d.storyboard : [];
    const storyRows = sb.map(function (s) {
      return '<tr><td class="vp-ss-t">' + escapeHtml(s.t || '') + '</td><td>' + escapeHtml(s.frame || '') + '</td><td>' + escapeHtml(s.subtitle || '') + '</td><td class="vp-ss-v">' + escapeHtml(s.voice || '') + '</td></tr>';
    }).join('');
    const storyCopy = sb.map(function (s) {
      return (s.t || '') + '｜画面：' + (s.frame || '') + '｜字幕：' + (s.subtitle || '') + '｜口播：' + (s.voice || '');
    }).join('\n');
    const decomposeHtml =
      '<div class="vp-rep-row"><span class="vp-rep-k">钩子类型</span><span>' + escapeHtml(d.hook_type || '—') + '</span></div>' +
      '<div class="vp-rep-row"><span class="vp-rep-k">前3秒</span><span>' + escapeHtml(d.first3s || '—') + '</span></div>' +
      '<div class="vp-rep-row"><span class="vp-rep-k">核心痛点</span><span>' + repArrHtml(d.pain) + '</span></div>' +
      '<div class="vp-rep-row"><span class="vp-rep-k">核心卖点</span><span>' + repArrHtml(d.sell) + '</span></div>' +
      '<div class="vp-rep-row"><span class="vp-rep-k">信任背书</span><span>' + repArrHtml(d.trust) + '</span></div>' +
      '<div class="vp-rep-row"><span class="vp-rep-k">结尾CTA</span><span>' + escapeHtml(d.cta || '—') + '</span></div>' +
      '<div class="vp-rep-row"><span class="vp-rep-k">情绪曲线</span><span>' + escapeHtml(d.emotion || '—') + '</span></div>' +
      (storyRows ? '<div class="vp-rep-story-wrap"><button type="button" class="btn xs ghost" id="vpCopyStory">📋 复制逐秒脚本</button><table class="vp-rep-story"><thead><tr><th>秒</th><th>画面（镜头/元素）</th><th>字幕原话</th><th>口播原话</th></tr></thead><tbody>' + storyRows + '</tbody></table></div>' : '');
    const scripts = Array.isArray(rep.scripts) ? rep.scripts : [];
    const jimeng = Array.isArray(rep.jimeng) ? rep.jimeng : [];
    const scriptHtml = scripts.length ? ('<div class="vp-gen-list">' + scripts.map(function (it, i) { return repGenItem(it, 'sc', i); }).join('') + '</div>') : '<div class="muted">未生成口播脚本</div>';
    const jimengHtml = jimeng.length ? ('<div class="vp-gen-list">' + jimeng.map(function (it, i) { return repGenItem(it, 'jc', i); }).join('') + '</div>') : '<div class="muted">未生成即梦提示词</div>';
    out.innerHTML =
      '<div class="vp-rep-blk"><div class="vp-rep-bh">🧩 爆款拆解卡 <span class="tag">逐秒复刻蓝本</span></div><div class="vp-rep-bd">' + decomposeHtml + '</div></div>' +
      '<div class="vp-rep-blk"><div class="vp-rep-bh">🎙 复刻口播脚本 <span class="tag">换表达·保留公式</span></div><div class="vp-rep-bd">' + scriptHtml + '</div></div>' +
      '<div class="vp-rep-blk"><div class="vp-rep-bh">🎬 即梦生成提示词 <span class="tag">文/图生视频</span></div><div class="vp-rep-bd">' + jimengHtml + '</div></div>';
    out.querySelectorAll('[data-sc]').forEach(function (btn) { btn.onclick = function () { repCopy(scripts[+btn.getAttribute('data-sc')].text, btn); }; });
    out.querySelectorAll('[data-jc]').forEach(function (btn) { btn.onclick = function () { repCopy(jimeng[+btn.getAttribute('data-jc')].text, btn); }; });
    // 🎬 即梦提示词一键送进本地 AI 视频生成工具（即创自动化）
    out.querySelectorAll('[data-jcgen]').forEach(function (btn) {
      btn.onclick = function () {
        var t = (jimeng[+btn.getAttribute('data-jcgen')] || {}).text || '';
        window.open('http://127.0.0.1:8899/?mode=jichuang&prompt=' + encodeURIComponent(t), '_blank');
      };
    });
    const cs = document.getElementById('vpCopyStory');
    if (cs) cs.onclick = function () { repCopy(storyCopy, cs); };
  }
  async function vpRunReplicate() {
    const conf = aiConfGet();
    if (!conf.key) { openAiModal(); return; }
    const pName = (AI_PROVIDERS[conf.provider] || {}).label || conf.provider;
    const out = document.getElementById('vpReplicateOut');
    if (out) out.innerHTML = '<div class="muted">🚀 正在调用 ' + escapeHtml(pName) + ' 生成复刻三件套（拆解卡 / 口播 / 即梦提示词）…</div>';
    try {
      const pick = getAiPickFrames();
      if (!pick.length) { if (out) out.innerHTML = '<div class="vp-warn">请先抽帧（点「重新抽帧」）再复刻。</div>'; return; }
      const promptText = buildAiPromptText(REPLICATE_PROMPT);
      const content = [{ type: 'text', text: promptText }];
      if (conf.vision) pick.forEach(f => content.push({ type: 'image_url', image_url: { url: f.dataURL } }));
      const ep = conf.base.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.key },
        body: JSON.stringify({ model: conf.model, messages: [{ role: 'user', content }], temperature: 0.6, max_tokens: 4000 })
      });
      if (!resp.ok) {
        const t = await resp.text();
        if (resp.status === 401) throw new Error('401 鉴权失败：API Key 无效或已过期（' + pName + '）');
        if (resp.status === 404) throw new Error('404：接口地址不正确，请检查 Base URL（当前 ' + ep + '）');
        if (resp.status === 400) throw new Error('400：请求参数/模型名有误（' + pName + ' · ' + conf.model + '）');
        throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 200));
      }
      const j = await resp.json();
      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!txt) throw new Error('返回内容为空（可能为风控拦截或额度不足）');
      const rep = parseReplicate(txt);
      VP.replicate = rep;
      renderReplicate(rep, txt);
    } catch (e) {
      if (out) out.innerHTML = '<div class="vp-warn">复刻失败：' + escapeHtml(e.message) +
        '<br><span class="muted">请检查 Key / Base URL / 模型是否正确，且浏览器能直连该服务。</span></div>';
    }
  }

function parseAi(txt) {

  if (!txt) return null;
  let s = txt.trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) s = m[1].trim();
  try {
    const o = JSON.parse(s);
    if (o.storyboard || (o.analysis && (o.analysis.hook || o.analysis.structure || o.analysis.script_direction))) {
      const an = o.analysis || {};
      return {
        storyboard: Array.isArray(o.storyboard) ? o.storyboard : [],
        analysis: {
          hook: an.hook || '',
          structure: an.structure || '',
          selling_points: Array.isArray(an.selling_points) ? an.selling_points : (an.selling_points ? [an.selling_points] : []),
          script_direction: an.script_direction || '',
          replicable: Array.isArray(an.replicable) ? an.replicable : (an.replicable ? [an.replicable] : [])
        },
        next_actions: Array.isArray(o.next_actions) ? o.next_actions : []
      };
    }
    // 兼容旧版 6 字段 / 诊断报告格式（尽量映射）
    if (o.hook || o.pain || o.script || o.data_analysis) {
      const da = o.data_analysis || {};
      return {
        storyboard: (o.structure && Array.isArray(o.structure.segments)) ? o.structure.segments.map(x => ({ frame: x.range || '', stage: x.stage || '', desc: x.desc || '' })) : [],
        analysis: {
          hook: o.hook || (da.insight ? da.insight : ''),
          structure: (o.structure && o.structure.type) ? (o.structure.type + (o.structure.suggestion ? '；' + o.structure.suggestion : '')) : '',
          selling_points: o.pain ? [o.pain] : [],
          script_direction: o.script || '',
          replicable: (o.optimization && Array.isArray(o.optimization.priority)) ? o.optimization.priority : []
        },
        next_actions: []
      };
    }
  } catch (e) {}
  return { raw: txt };
}


function renderAi(ai, raw) {
  const out = document.getElementById('vpAiOut'); if (!out) return;
  const html = (!ai) ? '<div class="vp-warn">未解析到内容</div>'
    : (ai.raw ? '<div class="vp-ai-out">' + escapeHtml(ai.raw) + '</div>' : renderBoomReport(ai));
  const bar = (ai && !ai.raw)
    ? '<div class="vp-ai-bar" style="margin:0 0 10px;display:flex;gap:8px;align-items:center">' +
        '<button id="vpSaveCaseBtn" class="btn primary xs" type="button">＋ 保存为案例</button>' +
        '<span class="muted" style="font-size:12px">将本次 AI 拆解存入案例库，可在「案例库」查看 / 设为参考</span>' +
      '</div>'
    : '';
  out.innerHTML = bar + html;
  const sb = document.getElementById('vpSaveCaseBtn');
  if (sb) sb.onclick = saveAiAsCase;
  const rep = document.getElementById('vpParseAiReport');
  if (rep) { rep.innerHTML = html; rep.classList.remove('muted'); }
}

// 把 AI 解析结果序列化为纯文本，便于存入案例库
function aiToCaseText(ai) {
  if (!ai) return '';
  if (ai.raw) return ai.raw;
  const m = VP.mat || {};
  const an = ai.analysis || {};
  let t = '';
  t += '【素材ID】' + (VP.sid || '—') + '\n';
  if (m.proj) t += '【项目】' + m.proj + '\n';
  if (m.cat) t += '【品类】' + m.cat + '\n';
  if (m.cost != null) t += '【消耗】' + m.cost + '\n';
  if (m.imp != null) t += '【展示数】' + m.imp + '\n';
  if (m.clk != null) t += '【点击数】' + m.clk + '\n';
  if (m.cv != null) t += '【转化数】' + m.cv + '\n';
  if (m.cpa != null) t += '【CPA】' + m.cpa + '\n';
  if (m.ctr != null) t += '【CTR】' + m.ctr + '\n';
  if (m.cvr != null) t += '【CVR】' + m.cvr + '\n';
  if (m.opt) t += '【优化师】' + m.opt + '\n';
  if (m.edit) t += '【剪辑】' + m.edit + '\n';
  if (m.tags) t += '【标签】' + m.tags + '\n';
  const sb = ai.storyboard || [];
  if (sb.length) {
    t += '\n— 画面分镜 —\n';
    sb.forEach(function (s) { t += (s.frame || '') + ' ' + (s.stage || '') + '：' + (s.desc || '') + '\n'; });
  }
  t += '\n— 解析结论 —\n';
  if (an.hook) t += '1. Hook（开头3秒）：' + an.hook + '\n';
  if (an.structure) t += '2. 画面分镜结构：\n' + an.structure + '\n';
  if (an.selling_points && an.selling_points.length) t += '3. 核心卖点：\n- ' + an.selling_points.join('\n- ') + '\n';
  if (an.script_direction) t += '4. 口播脚本方向：' + an.script_direction + '\n';
  if (an.replicable && an.replicable.length) t += '5. 可复制方向：\n- ' + an.replicable.join('\n- ') + '\n';
  const na = ai.next_actions || [];
  if (na.length) t += '\n— 后续可执行动作 —\n- ' + na.join('\n- ') + '\n';
  return t.trim();
}

function saveAiAsCase() {
  const ai = VP.ai;
  if (!ai) { alert('还没有解析结果可保存'); return; }
  const rawName = (VP.fileName || VP.sid || '视频解析案例');
  const title = rawName.replace(/\.[^.]+$/, '');
  const content = aiToCaseText(ai);
  const rec = {
    id: 'c' + Date.now(),
    title: title,
    content: content,
    ai: {
      mat: VP.mat || {},
      analysis: ai.analysis || {},
      storyboard: ai.storyboard || [],
      next_actions: ai.next_actions || []
    },
    sid: VP.sid || '',
    fileName: VP.fileName || '',
    videoName: VP.videoFile ? VP.videoFile.name : '',
    hasVideo: !!VP.videoFile,
    kind: 'ai',
    ts: Date.now(),
    ref: false
  };
  casePush(rec);
  if (VP.videoFile) saveVideo(rec.id, VP.videoFile, VP.videoFile.name).catch(function(){});
  if (typeof caseRender === 'function') caseRender();
  alert('已保存到案例库（' + title + '）。视频已一并缓存到浏览器，案例卡片可直接播放。');
}

// 去除 HTML 片段里的 <button>（案例快照里的"复制/重生成"等按钮在卡片中是无用死按钮）
function stripButtons(html) {
  if (!html) return html;
  const d = document.createElement('div'); d.innerHTML = html;
  const btns = d.querySelectorAll('button'); for (let i = 0; i < btns.length; i++) btns[i].remove();
  return d.innerHTML;
}
// 把当前视频的全部分析模块打包成一个案例，存进「我的解析案例」库（看板内直接可看）
function packAllAsCase() {
  function grab(id) { const e = document.getElementById(id); return e ? e.innerHTML : ''; }
  const report = stripButtons(grab('vpReport'));
  const boom = stripButtons(grab('vpParseAiReport'));
  const replicate = stripButtons(grab('vpReplicateOut'));
  const insight = stripButtons(grab('vpInsight'));
  const scriptOut = stripButtons(grab('vpScriptOut'));
  const scriptGen = stripButtons(grab('vpScriptGenOut'));
  function isEmpty(h) { return !h || !h.trim() || (h.indexOf('muted') >= 0 && (h.indexOf('点「') >= 0 || h.indexOf('还没有') >= 0 || h.indexOf('（未生成') >= 0)); }
  const anyContent = ![report, boom, replicate, insight, scriptOut, scriptGen].every(isEmpty);
  if (!anyContent) { alert('当前还没有可打包的分析内容。请先加载视频并生成「🚀 一键复刻 / 生成理解分析 / AI 语义拆解 / 脚本生成」中的任意一项，再打包为案例。'); return; }
  const sid = VP.sid || '';
  const rawName = (VP.fileName || sid || '视频解析案例');
  const title = rawName.replace(/\.[^.]+$/, '');
  const ai = VP.ai || null;
  const mat = VP.mat || {};
  // 文本版 content（用于导出 MD / 旧"展开全文"回退）
  const parts = [];
  if (sid) parts.push('【素材ID】' + sid);
  if (mat.proj) parts.push('【项目】' + mat.proj);
  if (mat.cat) parts.push('【品类】' + mat.cat);
  if (mat.cost != null) parts.push('【消耗】' + mat.cost);
  if (mat.ctr != null) parts.push('【CTR】' + mat.ctr + '%');
  if (mat.cpa != null) parts.push('【CPA】' + mat.cpa);
  if (ai) parts.push('\n' + aiToCaseText(ai));
  parts.push('\n（完整分析：投放数据 / 爆款拆解逐秒 / 一键复刻三件套 / 理解分析 / 脚本生成，已在看板「我的解析案例」卡片中「📂 展开完整分析」查看）');
  const content = parts.join('\n').trim();
  const rec = {
    id: 'c' + Date.now(),
    title: title,
    content: content,
    ai: { mat: mat, analysis: (ai && ai.analysis) || {}, storyboard: (ai && ai.storyboard) || [], next_actions: (ai && ai.next_actions) || [] },
    sections: { report: report, boom: boom, replicate: replicate, insight: insight, scriptOut: scriptOut, scriptGen: scriptGen },
    sid: sid,
    fileName: VP.fileName || '',
    videoName: VP.videoFile ? VP.videoFile.name : '',
    hasVideo: !!VP.videoFile,
    kind: 'ai',
    ts: Date.now(),
    ref: false,
    packed: true
  };
  casePush(rec);
  if (VP.videoFile) saveVideo(rec.id, VP.videoFile, VP.videoFile.name).catch(function () {});
  caseRender();
  alert('已打包为案例「' + title + '」，并存入「我的解析案例」库——刷新 / 重开看板都还在。\n\n视频已一并缓存，卡片可直接播放；点「📂 展开完整分析」即可在看板内直接看全部复刻 / 理解 / 脚本 / 投放 / 拆解内容。');
}

function fmtInt(n){ return (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('zh-CN'); }
function renderBoomReport(ai) {
  const m = VP.mat || {};
  const an = (ai && ai.analysis) || {};
  const sb = (ai && ai.storyboard) || [];
  const a = VP.analysis || {};
  let h = '<div class="vp-boom">';

  // ===== 顶部概览 =====
  const life = (typeof computeMatLifecycle === 'function') ? computeMatLifecycle(VP.sid) : null;
  const stageTxt = life ? life.status : '未关联数据';
  const daysTxt = life && life.days != null ? life.days + ' 天' : '—';
  const scoreEl = document.getElementById('vpScore');
  const score = scoreEl ? parseFloat(scoreEl.value) : NaN;
  const pill = (txt, lv) => '<span class="vp-pill-' + lv + '">' + txt + '</span>';
  const ctrv = m.ctr != null ? +m.ctr : NaN;
  const cvrv = m.cvr != null ? +m.cvr : NaN;
  const cpav = m.cpa != null ? +m.cpa : NaN;
  const cpmv = (m.cost != null && m.imp) ? m.cost / m.imp * 1000 : NaN;
  const ovPills = [];
  if (!isNaN(ctrv)) ovPills.push('CTR ' + ctrv.toFixed(2) + '% ' + (ctrv >= 2 ? pill('优', 'green') : ctrv >= 1 ? pill('中', 'yellow') : pill('偏低', 'red')));
  if (!isNaN(cvrv)) ovPills.push('CVR ' + cvrv.toFixed(2) + '% ' + (cvrv >= 3 ? pill('优', 'green') : cvrv >= 2 ? pill('中', 'yellow') : pill('偏低', 'red')));
  if (!isNaN(cpav)) ovPills.push('CPA ¥' + cpav.toFixed(1));
  if (!isNaN(cpmv)) ovPills.push('CPM ¥' + cpmv.toFixed(1));
  h += '<div class="vp-boom-hero">';
  h += '<div class="vp-boom-hero-row">';
  h += '<div class="vp-boom-title">🎯 ' + escapeHtml(VP.sid || '未识别素材') + (m.name ? ' <span style="font-weight:400;font-size:13px;color:#5b6478">' + escapeHtml(String(m.name).slice(0, 30)) + '</span>' : '') + '</div>';
  h += '<div class="vp-boom-stage">生命周期：<b>' + escapeHtml(stageTxt) + '</b> · 已跑 ' + escapeHtml(daysTxt) + (m.proj ? ' · 项目 ' + escapeHtml(m.proj) : '') + (m.cat ? ' · ' + escapeHtml(m.cat) : '') + '</div>';
  h += '</div>';
  h += '<div class="vp-boom-pills">' + (ovPills.length ? ovPills.join('　') : '<span class="muted">（未关联投放数据）</span>');
  if (!isNaN(score)) h += '　综合跑量评分 <b>' + score + '/10</b> ' + (score >= 7 ? pill('母本', 'green') : score >= 5 ? pill('中规', 'yellow') : pill('谨慎', 'red'));
  h += '</div></div>';

  // ===== 一、数据表现（真实报表）=====
  h += '<div class="vp-boom-sec"><div class="vp-boom-h">一、数据表现（真实报表）</div>';
  if (m && (m.cost != null || m.cv != null || m.ctr != null)) {
    h += '<table class="vp-boom-tbl"><tbody>';
    const row = (k, v) => '<tr><td class="vp-bt-k">' + k + '</td><td class="vp-bt-v">' + v + '</td></tr>';
    h += row('素材ID', escapeHtml(VP.sid || '—'));
    if (m.proj) h += row('项目', escapeHtml(m.proj));
    if (m.cat) h += row('品类', escapeHtml(m.cat));
    if (m.cost != null) h += row('消耗', fmtMoney(m.cost));
    if (m.imp != null) h += row('展示数', fmtInt(m.imp));
    if (m.clk != null) h += row('点击数', fmtInt(m.clk));
    if (m.cv != null) h += row('转化数', fmtInt(m.cv));
    if (m.cpa != null) h += row('CPA', fmtMoney(m.cpa));
    if (m.ctr != null) h += row('CTR', fmtPct(m.ctr));
    if (m.cvr != null) h += row('CVR', fmtPct(m.cvr));
    if (m.opt) h += row('优化师', escapeHtml(m.opt));
    if (m.edit) h += row('剪辑', escapeHtml(m.edit));
    if (m.tags) h += row('标签', escapeHtml(m.tags));
    h += '</tbody></table>';
  } else {
    h += '<div class="muted">未在报表匹配到该素材ID。可用上方「🔗 关联素材」按名称/ID 关联，或手动在下方填写投放数据，报告即会带上数据表现。</div>';
  }
  h += '</div>';

  // ===== 二、视频结构（画面 + 口播）=====
  h += '<div class="vp-boom-sec"><div class="vp-boom-h">二、视频结构（画面 + 口播）</div>';
  if (a && a.changes !== undefined) {
    const rhythm = a.shotLen < 2 ? '快节奏/信息密度高' : a.shotLen < 4 ? '中节奏' : '慢节奏/留白多';
    h += '<div class="vp-boom-blk"><div class="vp-boom-bh">画面节奏</div><div class="vp-boom-bd">⏱ 时长 ' + (VP.meta ? vpDur(VP.meta.duration) : '—') + ' · 镜头切换 <b>' + a.changes + '</b> 次 · 平均镜头 ' + (a.shotLen ? vpDur(a.shotLen) : '—') + '（' + rhythm + '）· 前3秒钩子 ' + (a.hook ? '<b>有强切换，开场抓人</b>' : '无明显切换，偏平稳') + ' · ' + escapeHtml(a.style || '') + '·' + escapeHtml(a.color || '') + '</div></div>';
  }
  if (sb.length) {
    h += '<div class="vp-boom-blk"><div class="vp-boom-bh">分镜（AI 读帧）</div><div class="vp-boom-sb">';
    sb.forEach(function (s) {
      h += '<div class="vp-sb-item"><div class="vp-sb-frame">' + escapeHtml(s.frame || '') + '</div><div class="vp-sb-body"><div class="vp-sb-stage">' + escapeHtml(s.stage || '') + '</div><div class="vp-sb-desc">' + escapeHtml(s.desc || '') + '</div></div></div>';
    });
    h += '</div></div>';
  } else if (VP.frames && VP.frames.length) {
    h += '<div class="vp-boom-blk"><div class="vp-boom-bh">抽帧预览</div><div class="vp-boom-sb">';
    VP.frames.forEach(function (f) { h += '<div class="vp-sb-item"><div class="vp-sb-frame">' + f.t.toFixed(1) + 's</div><div class="vp-sb-body"><img src="' + f.dataURL + '" style="max-width:120px;border-radius:6px"></div></div>'; });
    h += '</div></div>';
  }
  const ocrTxt = (VP.deep && VP.deep.ocr || []).filter(x => x.text).map(x => x.text).join(' ');
  const spch = VP.deep && VP.deep.whisper || '';
  const scriptTxt = spch || ocrTxt;
  if (scriptTxt) h += '<div class="vp-boom-blk"><div class="vp-boom-bh">口播 / 字幕原文</div><div class="vp-script">' + escapeHtml(scriptTxt.slice(0, 600)) + (scriptTxt.length > 600 ? '…' : '') + '</div></div>';
  h += '</div>';

  // ===== 三、优化建议（数据 + 内容双驱动）=====
  h += '<div class="vp-boom-sec"><div class="vp-boom-h">三、优化建议（数据 + 内容双驱动）</div><div class="vp-boom-bd"><ul class="vp-boom-ul">';
  const tips = [];
  if (!isNaN(ctrv) && ctrv < 1) tips.push('CTR 偏低：前 3 秒画面/封面吸引力不够，建议强化反差、利益点前置，或换首帧缩略图。');
  if (!isNaN(cvrv) && cvrv < 2) tips.push('CVR 偏低：落地页承接或信任背书弱，建议加限时/赠品钩子、强信任元素（销量/资质）。');
  if (!isNaN(cpmv) && cpmv > 80) tips.push('CPM 偏高：竞争激烈或定向过窄，建议放宽受众、优化出价、提升完播率拉低单价。');
  if (a && a.hook === false) tips.push('前3秒无明显切换：偏平稳开场，建议把钩子压缩到 0-3 秒制造反差/好奇。');
  if (an.replicable && an.replicable.length) an.replicable.forEach(function (p) { tips.push('可复制：' + p); });
  if (an.script_direction) tips.push('脚本方向：' + an.script_direction);
  if (life && (life.status === '已衰退' || (life.days != null && life.days > 12))) tips.push('已处衰退：单素材生命周期通常 7-14 天，建议尽快产出 2-3 条迭代版（换钩子/换场景/换口播）接力。');
  if (!tips.length) tips.push('各项指标健康，维持当前投放节奏，持续监控衰退信号即可。');
  h += tips.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul></div></div>';

  // ===== 四、分时段建议（按视频时间线）=====
  h += buildTimelineAdvice(m, a, an);

  // ===== 五、后续可执行动作 =====
  const na = ai && ai.next_actions || [];
  h += '<div class="vp-boom-sec"><div class="vp-boom-h">五、后续可执行动作</div>';
  if (na.length) h += '<ul class="vp-boom-ul">' + na.map(function (x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
  else h += '<div class="muted">（无）</div>';
  h += '</div>';

  h += '</div>';
  return h;
}

function buildTimelineAdvice(m, a, an) {
  const dur = VP.meta ? VP.meta.duration : 0;
  let h = '<div class="vp-boom-sec"><div class="vp-boom-h">四、分时段建议（按视频时间线）</div><div class="vp-boom-bd">';
  if (!dur) { h += '<span class="muted">（无视频时长信息，加载视频并抽帧后显示分时段建议）</span></div></div>'; return h; }
  const ctrv = m.ctr != null ? +m.ctr : NaN, cvrv = m.cvr != null ? +m.cvr : NaN;
  const hookOk = a && a.hook;
  const segs = [
    { name: '0-3s 开场钩子', focus: '钩子' },
    { name: '3s-' + Math.max(3, Math.round(dur * 0.7)) + 's 中段卖点', focus: '卖点' },
    { name: Math.round(dur * 0.7) + 's-' + Math.round(dur) + 's 结尾行动', focus: 'CTA' }
  ];
  segs.forEach(function (s) {
    const adv = [];
    if (s.focus === '钩子') {
      adv.push(hookOk ? '前3秒已有强画面切换，开场有效，保持并前置利益点。' : '前3秒偏平稳，建议用反差/价格冲击/痛点直击做钩子，0-3秒抓人。');
      if (!isNaN(ctrv) && ctrv < 1) adv.push('CTR 偏低，开场画面与首帧缩略图需更强吸引力。');
    } else if (s.focus === '卖点') {
      adv.push('中段集中放核心卖点（' + (an.selling_points && an.selling_points.length ? an.selling_points.length : 1) + ' 条以内），每 5-8 秒一个信息点。');
      if (!isNaN(cvrv) && cvrv < 2) adv.push('CVR 偏低，此段补强信任背书（销量/资质/限时）。');
    } else {
      adv.push('结尾给明确行动指令（点击/下单/领券），呼应钩子形成闭环。');
    }
    h += '<div class="vp-tl-item"><div class="vp-tl-time">' + s.name + '</div><div class="vp-tl-adv">' + adv.map(function (x) { return '· ' + escapeHtml(x); }).join('<br>') + '</div></div>';
  });
  h += '</div></div>';
  return h;
}


function applyAiToParse(ai) {
  if (!ai || ai.raw) return;
  const setV = function (id, v) { const e = document.getElementById(id); if (e && v != null && v !== '') e.value = v; };
  const an = ai.analysis || {};
  if (an.hook) setV('vpHook', an.hook);
  if (an.selling_points && an.selling_points.length) setV('vpSells', an.selling_points.join('\n'));
  if (an.structure) setV('vpLogic', an.structure);
  if (an.script_direction) setV('vpDir', an.script_direction);
  const rep = document.getElementById('vpParseAiReport');
  if (rep) { rep.innerHTML = renderBoomReport(ai); rep.classList.remove('muted'); }
}


  // ---- AI 设置弹窗（通用服务商配置）----
  function openAiModal() {
    const mask = document.getElementById('vpAiMask'); if (!mask) return;
    const conf = aiConfGet();
    const pv = document.getElementById('vpAiProvider'); if (pv) pv.value = conf.provider;
    const bs = document.getElementById('vpAiBase'); if (bs) bs.value = lsGet(AI_BASE);
    const k = document.getElementById('vpAiKey'); if (k) k.value = conf.key;
    const md = document.getElementById('vpAiModel'); if (md) { md.value = lsGet(AI_MODEL); fillModelDatalist(conf.provider); }
    const wm = document.getElementById('vpWhisperModel'); if (wm) wm.value = whisperModelGet();
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '';
    mask.style.display = 'flex';
    updateAiTag();
    renderCostEstimate();
  }
  function fillModelDatalist(provider) {
    const dl = document.getElementById('vpAiModelList'); if (!dl) return;
    const p = AI_PROVIDERS[provider];
    dl.innerHTML = (p && p.models ? p.models : []).map(function (x) { return '<option value="' + x + '">'; }).join('');
  }
  function onProviderChange() {
    const pv = document.getElementById('vpAiProvider'); if (!pv) return;
    const p = AI_PROVIDERS[pv.value] || AI_PROVIDERS.zhipu;
    const bs = document.getElementById('vpAiBase');
    if (bs && !bs.value.trim()) bs.value = p.base;
    const md = document.getElementById('vpAiModel');
    if (md && !md.value.trim()) md.value = p.def;
    fillModelDatalist(pv.value);
    updateAiTag();
    renderCostEstimate();
  }
  function closeAiModal() { const m = document.getElementById('vpAiMask'); if (m) m.style.display = 'none'; }
  function saveAiKey() {
    const pv = document.getElementById('vpAiProvider');
    const bs = document.getElementById('vpAiBase');
    const k = document.getElementById('vpAiKey');
    const md = document.getElementById('vpAiModel');
    if (!k) return;
    const v = (k.value || '').trim();
    if (!v) { const h = document.getElementById('vpAiHint'); if (h) h.textContent = '请输入 API Key'; return; }
    aiConfSet({ provider: pv ? pv.value : 'zhipu', base: bs ? bs.value : '', key: v, model: md ? md.value : '' });
    const wm = document.getElementById('vpWhisperModel'); if (wm) whisperModelSet(wm.value);
    const pName = (AI_PROVIDERS[(pv ? pv.value : 'zhipu')] || {}).label || '';
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '✅ 已保存（' + pName + '，Key 仅存于本机浏览器）';
    renderCostEstimate();
    setTimeout(closeAiModal, 800);
  }
  function clearAiKey() {
    try { localStorage.removeItem(AI_KEY); } catch (e) {}
    const k = document.getElementById('vpAiKey'); if (k) k.value = '';
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '已清除 Key（服务商 / Base 配置保留）';
  }
  // ---- 解析案例库（静态 cases.json 发布版 + 本机 localStorage 草稿） ----
  const CASE_KEY = 'vp_cases';        // 本地工作副本（新增/编辑，未发布）
  const CASE_HIDE_KEY = 'vp_cases_hidden'; // 本地已隐藏的 published id（已删除的发布案例）
  const CASE_URL = './cases.json?v=' + (window.SEED_VER || Date.now());
  let PUBLISHED_CASES = [];           // 来自 cases.json（部署即发布，跨设备可见）
  function caseGetLocal() { try { return JSON.parse(localStorage.getItem(CASE_KEY) || '[]'); } catch (e) { return []; } }
  function caseSaveLocal(arr) { try { localStorage.setItem(CASE_KEY, JSON.stringify(arr)); } catch (e) {} }
  function caseGetHidden() { try { return JSON.parse(localStorage.getItem(CASE_HIDE_KEY) || '[]'); } catch (e) { return []; } }
  function caseSaveHidden(arr) { try { localStorage.setItem(CASE_HIDE_KEY, JSON.stringify(arr)); } catch (e) {} }
  // 合并 published（排除已隐藏）与本地工作副本，本地 id 优先覆盖
  function caseGetAll() {
    const hidden = caseGetHidden();
    const map = {};
    PUBLISHED_CASES.filter(function (c) { return c && c.id && hidden.indexOf(c.id) < 0; })
      .forEach(function (c) { map[c.id] = Object.assign({}, c, { _src: 'pub' }); });
    caseGetLocal().forEach(function (c) { if (c && c.id) map[c.id] = Object.assign({}, c, { _src: 'local' }); });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  // 通用数组去重：去掉完全相同的、以及彼此包含（一个完全是另一个子串）的项
  function caseNormArr(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    const norm = function (s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s，。、；：,.!?;:！？\-—_'"'’“”()（）\[\]【】]/g, ''); };
    for (let i = 0; i < arr.length; i++) {
      const s = String(arr[i] == null ? '' : arr[i]).trim();
      if (!s) continue;
      const n = norm(s); if (!n) continue;
      let dup = false;
      for (let j = 0; j < out.length; j++) {
        const on = norm(out[j]);
        if (n === on || n.indexOf(on) >= 0 || on.indexOf(n) >= 0) { dup = true; break; }
      }
      if (!dup) out.push(s);
    }
    return out;
  }
  // AI 解析结果去重（防止模型输出重复条目）
  function dedupeAi(ai) {
    if (!ai || ai.raw) return ai;
    if (ai.storyboard && ai.storyboard.length) {
      const seen = {}, keep = [];
      for (const s of ai.storyboard) {
        const k = ((s.frame || '') + '|' + (s.desc || '')).trim().toLowerCase().replace(/\s+/g, '');
        if (k && !seen[k]) { seen[k] = 1; keep.push(s); }
      }
      ai.storyboard = keep;
    }
    const an = ai.analysis || {};
    if (an.selling_points) an.selling_points = caseNormArr(an.selling_points);
    if (an.replicable) an.replicable = caseNormArr(an.replicable);
    if (ai.next_actions) ai.next_actions = caseNormArr(ai.next_actions);
    return ai;
  }
  // AI 拆解结果卡片：整齐呈现指标 + 卖点 + 可复制 + 后续动作，可展开全文
  function renderAiCaseCard(c) {
    const ai = c.ai || {};
    const badge = c._src === 'pub' ? '<span class="vp-src pub">已发布</span>' : '<span class="vp-src local">本地草稿</span>';
    const m = ai.mat || {};
    const an = ai.analysis || {};
    const sb = ai.storyboard || [];
    const na = ai.next_actions || [];
    const title = escapeHtml(c.title || '(无标题)');
    const sid = escapeHtml(c.sid || '—');
    const fname = escapeHtml(c.fileName || '');
    const chips = [];
    if (m.cost != null) chips.push('消耗 ' + fmtInt(m.cost));
    if (m.imp != null) chips.push('展示 ' + fmtInt(m.imp));
    if (m.clk != null) chips.push('点击 ' + fmtInt(m.clk));
    if (m.cv != null) chips.push('转化 ' + fmtInt(m.cv));
    if (m.ctr != null) chips.push('CTR ' + m.ctr + '%');
    if (m.cpa != null) chips.push('CPA ' + m.cpa);
    if (m.cvr != null) chips.push('CVR ' + m.cvr + '%');
    if (m.tags) chips.push('标签 ' + m.tags);
    const sp = (an.selling_points || []).slice(0, 4);
    const rep = (an.replicable || []).slice(0, 4);
    const spHtml = sp.length ? '<div class="vp-ai-sub"><span class="vp-ai-k">核心卖点</span>' + sp.map(function (s) { return '<span class="vp-tag">' + escapeHtml(s) + '</span>'; }).join('') + '</div>' : '';
    const repHtml = rep.length ? '<div class="vp-ai-sub"><span class="vp-ai-k">可复制</span>' + rep.map(function (s) { return '<span class="vp-tag ok">' + escapeHtml(s) + '</span>'; }).join('') + '</div>' : '';
    const naHtml = na.length ? '<div class="vp-ai-sub"><span class="vp-ai-k">后续动作</span>' + na.map(function (s) { return '<span class="vp-tag warn">' + escapeHtml(s) + '</span>'; }).join('') + '</div>' : '';
    // 打包案例的完整分析区块（投放数据 / 爆款拆解 / 复刻 / 理解 / 脚本），看板内直接可看
    const sections = c.sections || {};
    const hasSec = !!(sections.report || sections.boom || sections.replicate || sections.insight || sections.scriptOut || sections.scriptGen);
    const fullAnaHtml = hasSec ? ('<div class="vp-case-fullana"><button class="btn xs ghost" data-act="fullana" data-id="' + c.id + '">📂 展开完整分析（复刻 / 理解 / 脚本 / 投放 / 拆解）</button><div id="vpCaseFullAna-' + c.id + '" style="display:none" class="vp-case-fullana-body">' +
      (sections.report ? '<div class="vp-cfa-sec"><div class="vp-cfa-h">📊 投放数据</div>' + sections.report + '</div>' : '') +
      (sections.boom ? '<div class="vp-cfa-sec"><div class="vp-cfa-h">🎯 爆款拆解 / 逐秒分析</div>' + sections.boom + '</div>' : '') +
      (sections.replicate ? '<div class="vp-cfa-sec"><div class="vp-cfa-h">🚀 一键复刻三件套</div>' + sections.replicate + '</div>' : '') +
      ((sections.insight || sections.scriptOut) ? '<div class="vp-cfa-sec"><div class="vp-cfa-h">💡 理解分析 / 文案口播</div>' + (sections.insight || '') + (sections.scriptOut || '') + '</div>' : '') +
      (sections.scriptGen ? '<div class="vp-cfa-sec"><div class="vp-cfa-h">🎯 脚本生成器</div>' + sections.scriptGen + '</div>' : '') +
      '</div></div>') : '';
    const sbHtml = sb.length ? '<div class="vp-ai-sub"><span class="vp-ai-k">分镜</span><span class="vp-chip">' + sb.length + ' 个</span>' + (sb[0] ? ('<span class="vp-muted">首镜：' + escapeHtml((sb[0].frame || '') + ' ' + (sb[0].desc || '')) + '</span>') : '') + '</div>' : '';
    const hasVideoUrl = !!(c.videoUrl || '').trim();
    const hasLocalVideo = !!c.hasVideo;
    const relVideoUrl = hasLocalVideo ? ('./videos/' + c.id + '.mp4') : '';
    const showWrap = hasVideoUrl || hasLocalVideo;
    const videoHint = hasLocalVideo ? '视频已随案例保存，卡片加载后自动播放' : '点按钮选择你电脑上的原视频，即可在卡片内播放';
    const videoHtml = '<div class="vp-case-video" style="margin:8px 0 14px">' +
      '<div class="vp-case-video-wrap" id="vpCaseVideoWrap-' + c.id + '" style="display:' + (showWrap ? 'block' : 'none') + '">' +
        '<video id="vpCaseVideo-' + c.id + '" controls preload="metadata" playsinline style="width:100%;max-width:520px;border-radius:10px;background:#000;max-height:320px"' + (hasVideoUrl ? ' src="' + escapeHtml(c.videoUrl) + '"' : (relVideoUrl ? ' src="' + escapeHtml(relVideoUrl) + '"' : '')) + '></video>' +
      '</div>' +
      '<div class="vp-case-video-ctrl" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
        '<input type="file" accept="video/*" style="display:none" data-video-for="' + c.id + '" id="vpCaseFile-' + c.id + '" onchange="return false">' +
        '<button class="btn xs ghost" data-act="loadVideo" data-id="' + c.id + '">▶️ 预览视频</button>' +
        '<span class="vp-muted" style="font-size:12px" id="vpCaseVideoHint-' + c.id + '">' + videoHint + '</span>' +
      '</div>' +
    '</div>';
    return '<div class="vp-case-item vp-case-ai' + (c.ref ? ' is-ref' : '') + '">' +
      '<div class="vp-case-top"><span class="vp-case-title">🎬 ' + title + '</span>' + badge +
      '<span class="vp-case-acts">' +
      '<button class="btn xs ' + (c.ref ? 'primary' : 'ghost') + '" data-act="ref" data-id="' + c.id + '">' + (c.ref ? '★ 参考中' : '☆ 设为参考') + '</button>' +
      '<button class="btn xs ghost" data-act="expand" data-id="' + c.id + '">展开全文</button>' +
      '<button class="btn xs ghost" data-act="del" data-id="' + c.id + '">删除</button>' +
      '</span></div>' +
      '<div class="vp-ai-meta">素材ID ' + sid + (fname ? ' · ' + fname : '') + (c.ts ? ' · ' + new Date(c.ts).toLocaleString('zh-CN') : '') + '</div>' +
      videoHtml +
      (chips.length ? '<div class="vp-ai-chips">' + chips.map(function (x) { return '<span class="vp-chip">' + escapeHtml(x) + '</span>'; }).join('') + '</div>' : '') +
      sbHtml + spHtml + repHtml + naHtml + fullAnaHtml +
      '<div class="vp-ai-full" id="vpCaseFull-' + c.id + '" style="display:none"><pre class="vp-ai-pre">' + escapeHtml(c.content || '') + '</pre></div>' +
      '</div>';
  }
  function caseRender() {
    const box = document.getElementById('vpCaseList'); if (!box) return;
    const list = caseGetAll();
    if (!list.length) { box.innerHTML = '<div class="muted">还没有案例。点「＋ 添加案例」粘贴你的爆款拆解范本，或解析视频后点「＋ 保存为案例」；标星后可在 AI 拆解时作为参考示例。</div>'; return; }
    box.innerHTML = list.map(function (c) {
      if (c.kind === 'ai' && c.ai) return renderAiCaseCard(c);
      const title = escapeHtml(c.title || '(无标题)');
      const preview = escapeHtml((c.content || '').replace(/\n/g, ' ').slice(0, 90));
      const badge = c._src === 'pub' ? '<span class="vp-src pub">已发布</span>' : '<span class="vp-src local">本地草稿</span>';
      return '<div class="vp-case-item' + (c.ref ? ' is-ref' : '') + '">' +
        '<div class="vp-case-top"><span class="vp-case-title">' + title + '</span>' + badge +
        '<span class="vp-case-acts">' +
        '<button class="btn xs ' + (c.ref ? 'primary' : 'ghost') + '" data-act="ref" data-id="' + c.id + '">' + (c.ref ? '★ 参考中' : '☆ 设为参考') + '</button>' +
        '<button class="btn xs ghost" data-act="edit" data-id="' + c.id + '">编辑</button>' +
        '<button class="btn xs ghost" data-act="del" data-id="' + c.id + '">删除</button>' +
        '</span></div>' +
        '<div class="vp-case-prev">' + preview + '</div>' +
        '</div>';
    }).join('');
    // 对带视频缓存的案例，把 Blob 回填到 video 标签
    setTimeout(caseRenderVideos, 0);
  }
  // 从 IndexedDB 读出视频 Blob，赋值给案例卡片里的 <video>
  function caseRenderVideos() {
    const list = caseGetAll().filter(function (c) { return c.kind === 'ai' && c.ai && c.hasVideo; });
    list.forEach(function (c) {
      loadVideo(c.id).then(function (v) {
        if (!v || !v.blob) return;
        const video = document.getElementById('vpCaseVideo-' + c.id);
        const wrap = document.getElementById('vpCaseVideoWrap-' + c.id);
        const hint = document.getElementById('vpCaseVideoHint-' + c.id);
        if (!video || !wrap) return;
        const old = video.src;
        video.src = URL.createObjectURL(v.blob);
        if (old && old.startsWith('blob:')) { try { URL.revokeObjectURL(old); } catch (e) {} }
        wrap.style.display = 'block';
        if (hint) hint.textContent = '视频已缓存于浏览器，可直接播放';
      }).catch(function () {});
    });
  }
  function caseAddOrEdit(id, title, content) {
    const list = caseGetLocal();
    if (id) { const it = list.find(function (x) { return x.id === id; }); if (it) { it.title = title; it.content = content; } }
    else list.push({ id: 'c' + Date.now(), title: title, content: content, ref: false });
    caseSaveLocal(list); caseRender();
  }
  function caseToggleRef(id) {
    const a = caseGetLocal(); const it = a.find(function (x) { return x.id === id; });
    if (it) { it.ref = !it.ref; caseSaveLocal(a); }
    caseRender();
  }
  function caseDel(id) {
    const loc = caseGetLocal();
    const idx = loc.findIndex(function (x) { return x.id === id; });
    if (idx >= 0) { loc.splice(idx, 1); caseSaveLocal(loc); }
    else { const h = caseGetHidden(); if (h.indexOf(id) < 0) { h.push(id); caseSaveHidden(h); } }
    if (typeof deleteVideo === 'function') deleteVideo(id).catch(function(){});
    caseRender();
  }

  // ===== IndexedDB 视频缓存：案例保存时把原视频文件一起持久化到浏览器 =====
  const VIDEO_DB_NAME = 'vp_case_videos';
  const VIDEO_STORE_NAME = 'videos';
  function openVideoDB() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(VIDEO_DB_NAME, 1);
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(VIDEO_STORE_NAME)) db.createObjectStore(VIDEO_STORE_NAME, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
    });
  }
  function saveVideo(id, blob, name) {
    if (!id || !blob) return Promise.resolve();
    return openVideoDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
        tx.objectStore(VIDEO_STORE_NAME).put({ id: id, blob: blob, name: name || (id + '.mp4'), ts: Date.now() });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function loadVideo(id) {
    if (!id) return Promise.resolve(null);
    return openVideoDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(VIDEO_STORE_NAME, 'readonly');
        const req = tx.objectStore(VIDEO_STORE_NAME).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function deleteVideo(id) {
    if (!id) return Promise.resolve();
    return openVideoDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
        tx.objectStore(VIDEO_STORE_NAME).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function casePush(rec) { const list = caseGetLocal(); list.push(rec); caseSaveLocal(list); }
  // 导出案例库为 Markdown，便于离线看板 / 沉淀
  function caseExportMd() {
    const list = caseGetAll();
    if (!list.length) { alert('案例库为空，暂无可导出内容'); return; }
    let md = '# 视频解析案例库\n\n> 导出时间 ' + new Date().toLocaleString('zh-CN') + '，共 ' + list.length + ' 条\n\n';
    list.forEach(function (c, i) {
      md += '## ' + (i + 1) + '. ' + (c.title || '(无标题)') + (c.ref ? ' ★参考' : '') + '\n';
      if (c.kind === 'ai' && c.sid) md += '- 素材ID：' + c.sid + '\n';
      if (c.fileName) md += '- 视频：' + c.fileName + '\n';
      if (c.ts) md += '- 保存时间：' + new Date(c.ts).toLocaleString('zh-CN') + '\n';
      md += '\n' + (c.content || '') + '\n\n---\n\n';
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '解析案例库_' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a); a.click(); a.remove();
  }
  // 导出案例库为 cases.json（合并 published 与本地），用于部署到离线看板 / 跨设备共享
  function caseExportJson() {
    const list = caseGetAll().map(function (c) { const o = Object.assign({}, c); delete o._src; return o; });
    if (!list.length) { alert('案例库为空，暂无可导出内容'); return; }
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cases.json';
    document.body.appendChild(a); a.click(); a.remove();
    alert('已下载 cases.json（共 ' + list.length + ' 条）。把它发给我，我会部署到离线看板，他人打开即可看到你的案例。');
  }
  // 从导出的 cases.json 导入案例库：合并进本机 localStorage，离线看板立即可见并保存
  function caseImportJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) { alert('文件格式不正确：cases.json 应是一个案例数组'); return; }
        const local = caseGetLocal();
        const byId = {};
        local.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
        let added = 0, updated = 0, skipped = 0;
        arr.forEach(function (c) {
          if (!c || !c.id) { skipped++; return; }
          const clean = Object.assign({}, c); delete clean._src;
          if (byId[c.id]) { byId[c.id] = clean; updated++; } else { local.push(clean); byId[c.id] = clean; added++; }
        });
        caseSaveLocal(local);
        caseRender();
        alert('✅ 已导入案例库：新增 ' + added + ' 条，更新 ' + updated + ' 条' + (skipped ? '（跳过 ' + skipped + ' 条无效记录）' : '') + '。\n最新案例现在就能在离线看板看到了，并自动保存在本机。');
      } catch (e) {
        alert('解析 cases.json 失败：' + (e && e.message ? e.message : e));
      }
    };
    reader.onerror = function () { alert('读取文件失败，请重试'); };
    reader.readAsText(file, 'utf-8');
  }
  // 导出完整离线包：cases.json + videos/ 文件夹，便于部署到 GitHub Pages 或离线看板
  async function caseExportFull() {
    const list = caseGetAll().map(function (c) { const o = Object.assign({}, c); delete o._src; return o; });
    if (!list.length) { alert('案例库为空，暂无可导出内容'); return; }
    const withVideo = list.filter(function (c) { return c.hasVideo; });
    if (!withVideo.length) { alert('当前没有带视频缓存的案例。请先解析视频并「保存为案例」，或给已有案例点「预览视频」补选原视频。'); return; }
    if (typeof showDirectoryPicker !== 'function') {
      alert('你的浏览器不支持「文件夹保存」API，无法一键导出 videos/ 文件夹。\n\n请换用 Chrome / Edge，或：\n1) 点「导出案例库(JSON)」下载 cases.json；\n2) 手动把视频文件复制到同目录的 videos/ 文件夹（按 {案例ID}.mp4 命名）。');
      return;
    }
    try {
      const dir = await showDirectoryPicker();
      // 写 cases.json
      const jsonBlob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json;charset=utf-8' });
      const jsonHandle = await dir.getFileHandle('cases.json', { create: true });
      const jsonWriter = await jsonHandle.createWritable();
      await jsonWriter.write(jsonBlob);
      await jsonWriter.close();
      // 写 videos/ 文件夹
      const videosDir = await dir.getDirectoryHandle('videos', { create: true });
      let saved = 0;
      for (const c of withVideo) {
        const v = await loadVideo(c.id);
        if (!v || !v.blob) continue;
        const ext = String(v.name || '').split('.').pop() || 'mp4';
        const fileName = c.id + '.' + ext;
        const fh = await videosDir.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(v.blob);
        await w.close();
        saved++;
      }
      alert('离线包已导出：\n• cases.json（' + list.length + ' 条）\n• videos/ 文件夹（' + saved + ' 个视频）\n\n把它们和 index.html 一起部署到 GitHub Pages 或任意静态托管，即可在线/离线播放视频。');
    } catch (e) {
      console.error(e);
      if (e.name !== 'AbortError') alert('导出失败：' + (e.message || e));
    }
  }
  function caseFillForm(id) {
    const f = document.getElementById('vpCaseForm'); if (f) f.style.display = 'block';
    const t = document.getElementById('vpCaseTitle'), c = document.getElementById('vpCaseContent');
    if (id) {
      const it = caseGetAll().find(function (x) { return x.id === id; });
      if (it) { if (t) t.value = it.title || ''; if (c) c.value = it.content || ''; f.dataset.edit = id; }
    } else { if (t) t.value = ''; if (c) c.value = ''; if (f) delete f.dataset.edit; }
    if (t) t.focus();
  }
  function updateAiTag() {
    const t = document.getElementById('vpAiTag'); if (!t) return;
    const conf = aiConfGet();
    const p = AI_PROVIDERS[conf.provider] || AI_PROVIDERS.zhipu;
    const short = (conf.model || p.def || '').split('/').pop();
    t.textContent = p.label + ' · ' + short + (conf.provider === 'zhipu' ? ' · 免费' : '');
  }
  function vpGenerateInsight() {

    const g = id => (document.getElementById(id).value || '').trim();
    const num = id => { const v = parseFloat(g(id)); return isNaN(v) ? null : v; };
    const cost = num('vpCost'), imp = num('vpImp'), clk = num('vpClk'), cv = num('vpCv');
    const ctr = num('vpCtr'), cvr = num('vpCvr'), cpa = num('vpCpa'), cpm = num('vpCpm');
    const roi = num('vpRoi'), days = num('vpDays'), score = num('vpScore');
    const status = g('vpStatus'), name = g('vpMatName'), platform = g('vpPlatform');
    const el = document.getElementById('vpInsight'); if (!el) return;
    if (cost == null && imp == null && clk == null && cv == null && !status && !name) {
      el.className = 'vp-insight muted';
      el.innerHTML = '还没有录入数据。请在上方 ①②③ 区填写素材信息与投放数据，再点「生成理解分析」。';
      return;
    }
    // 自动补算 CPM / CTR / CVR
    let cpmv = cpm, ctrv = ctr, cvrv = cvr;
    if (cpmv == null && cost != null && imp) cpmv = cost / imp * 1000;
    if (ctrv == null && clk != null && imp) ctrv = clk / imp * 100;
    if (cvrv == null && cv != null && clk) cvrv = cv / clk * 100;
    const pill = (txt, lv) => '<span class="pill vp-pill-' + lv + '">' + txt + '</span>';
    const diag = [];
    if (ctrv != null) diag.push('CTR ' + ctrv.toFixed(2) + '% ' + (ctrv >= 2 ? pill('优', 'green') : ctrv >= 1 ? pill('中', 'yellow') : pill('偏低', 'red')));
    if (cvrv != null) diag.push('CVR ' + cvrv.toFixed(2) + '% ' + (cvrv >= 3 ? pill('优', 'green') : cvrv >= 2 ? pill('中', 'yellow') : pill('偏低', 'red')));
    if (cpmv != null) diag.push('CPM ¥' + cpmv.toFixed(1) + ' ' + (cpmv <= 40 ? pill('优', 'green') : cpmv <= 80 ? pill('中', 'yellow') : pill('偏高', 'red')));
    if (cpa != null) diag.push('转化成本 ¥' + cpa.toFixed(1));
    if (roi != null) diag.push('ROI ' + roi.toFixed(2) + ' ' + (roi >= 1 ? pill('回正', 'green') : pill('亏损', 'red')));

    // 阶段判断
    let stage = '未知';
    if (status === '测试中') stage = '测试期（素材未起量，重点看完播与首轮转化信号）';
    else if (status === '跑量中') stage = '跑量期（已验证模型，重点控成本、扩量、防衰退）';
    else if (status === '已衰退') stage = '衰退期（素材疲劳，需换血/迭代新素材）';
    else if (status === '已停止') stage = '停止期（已关停，作复盘沉淀）';
    else if (days != null) stage = days <= 3 ? '测试期' : days <= 10 ? '跑量期' : '衰退/长尾期';

    // 优化建议（信息流经验规则）
    const tips = [];
    if (ctrv != null && ctrv < 1) tips.push('CTR 偏低：前 3 秒画面/封面吸引力不够，建议强化反差、利益点前置，或换首帧缩略图。');
    if (cvrv != null && cvrv < 2) tips.push('CVR 偏低：落地页承接或信任背书弱，建议加限时/赠品钩子、强信任元素（销量/资质）。');
    if (cpmv != null && cpmv > 80) tips.push('CPM 偏高：竞争激烈或定向过窄，建议放宽受众、优化出价策略、提升完播率拉低单价。');
    if (status === '已衰退' || (days != null && days > 12)) tips.push('已处衰退：单素材生命周期通常 7-14 天，建议尽快产出 2-3 条迭代版（换钩子/换场景/换口播）接力。');
    if (score != null && score >= 8) tips.push('跑量评分高（≥8）：是优质母本，建议围绕它做系列化复刻（同钩子不同场景、同结构不同卖点）。');
    else if (score != null && score <= 4) tips.push('跑量评分低（≤4）：建议先小预算测试或放弃，重点用「复刻脚本」做差异化改编后再测。');
    if (!tips.length) tips.push('各项指标健康，维持当前投放节奏，持续监控衰退信号即可。');

    let html = '<h4>📊 效率诊断</h4><div>' + (diag.length ? diag.join('　') : '（暂无投放数据，填入 ② 区后刷新）') + '</div>';
    html += '<h4>🧭 生命周期阶段</h4><div>' + stage + (days != null ? '（已跑 ' + days + ' 天）' : '') + '</div>';
    html += '<h4>💡 信息流优化建议</h4><ul>' + tips.map(t => '<li>' + t + '</li>').join('') + '</ul>';
    if (score != null) html += '<div style="margin-top:6px">综合跑量评分：<b>' + score + ' / 10</b>' + (score >= 7 ? '（建议作为母本重点复刻）' : score >= 5 ? '（中规中矩，可优化后放量）' : '（谨慎，先测试再决定）') + '</div>';
    el.className = 'vp-insight';
    el.innerHTML = html;
  }

  // ---- 初始化绑定 ----
  // ===== 文案口播分析（零Key 本地结构化）=====
  function analyzeScript() {
    const out = document.getElementById('vpScriptOut'); if (!out) return;
    const ta = document.getElementById('vpScript');
    const text = (ta ? ta.value : '').trim();
    if (!text) { out.innerHTML = '<div class="vp-note-inline">请先在「素材文案 / 逐字稿」框填入口播文字（可点「🎙 语音识别」或「🔍 深度分析」获取，再「↧ 填入口播脚本」）。</div>'; return; }
    const chars = text.replace(/\s/g, '').length;
    const dur = chars / 4;
    const speedLabel = dur < 8 ? '偏快' : (dur > 45 ? '偏长' : '适中');
    const sentences = text.split(/[。！？!?；;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    const clsOf = function (s) {
      if (/注意|别再|终于|揭秘|为什么|原来|听我说|小心|竟然|万万|千万别|只需|只要|看这里|重磅/.test(s)) return 'hook';
      if (/烦恼|麻烦|难|累|贵|怕|坑|乱|脏|旧|烦|愁|焦虑|踩雷|后悔/.test(s)) return 'pain';
      if (/采用|材质|功能|送|免费|元|折|轻|薄|厚|大|小|快|强|省|多|少|智能|科技|专利|加厚|亲肤|可机洗/.test(s)) return 'sell';
      if (/品牌|认证|明星|销量|口碑|平台|官方|万|同款|专柜|权威|央视|检测|保障|正品|老字号/.test(s)) return 'trust';
      if (/点击|立即|下单|购买|领|抢|扫码|链接|现在|小黄车|加购|预约|咨询|私信/.test(s)) return 'cta';
      return 'other';
    };
    const tagName = { hook: '钩子', pain: '痛点', sell: '卖点', trust: '信任', cta: 'CTA', other: '其他' };
    const segHtml = sentences.map(function (s) { const c = clsOf(s); return '<div class="vp-sa-row ' + c + '"><span class="vp-sa-tag">' + tagName[c] + '</span><span class="t">' + escapeHtml(s) + '</span></div>'; }).join('');
    const head = text.replace(/\s/g, '').slice(0, 12);
    const hookHit = /注意|别再|终于|揭秘|为什么|原来|听我说|小心|竟然|万万|千万别|只需|只要|看这里|重磅|烦恼|麻烦|难|累|贵|怕|坑/.test(head);
    const counts = { hook: 0, pain: 0, sell: 0, trust: 0, cta: 0, other: 0 };
    sentences.forEach(function (s) { counts[clsOf(s)]++; });
    let score = 0;
    if (hookHit) score += 20;
    if (counts.sell > 0) score += Math.min(30, counts.sell * 12);
    if (counts.cta > 0) score += 25;
    if (chars >= 40 && chars <= 320) score += 15; else if (chars > 320) score += 8;
    if (counts.pain > 0) score += 10;
    score = Math.min(100, score);
    const scoreCol = score >= 75 ? '#1f8a70' : (score >= 50 ? '#e8a33d' : '#e0533d');
    const sells = (VP.ai && VP.ai.analysis && VP.ai.analysis.selling_points) || [];
    let covHtml = '';
    if (sells.length) {
      covHtml = '<div style="font-weight:600;margin:4px 0 2px;font-size:12.5px;color:#556">与 AI 拆解卖点覆盖对照</div><div class="vp-sa-cover">' +
        sells.map(function (p) { const key = p.replace(/[，。、\s]/g, '').slice(0, 4); const hit = key && text.indexOf(key) >= 0; return '<div class="vp-sa-cov"><span class="dot" style="background:' + (hit ? '#1f8a70' : '#cbd5e1') + '"></span>' + (hit ? '已覆盖' : '未覆盖') + '：' + escapeHtml(p) + '</div>'; }).join('') + '</div>';
    }
    const effN = counts.hook + counts.pain + counts.sell + counts.trust + counts.cta;
    out.innerHTML = '<div class="vp-sa">' +
      '<div class="vp-sa-metrics">' +
        '<div class="vp-sa-metric"><div class="l">字数</div><div class="v">' + chars + '</div></div>' +
        '<div class="vp-sa-metric"><div class="l">预估时长</div><div class="v">' + dur.toFixed(0) + 's</div></div>' +
        '<div class="vp-sa-metric"><div class="l">语速</div><div class="v">' + speedLabel + '</div></div>' +
        '<div class="vp-sa-metric"><div class="l">前3秒钩子</div><div class="v" style="color:' + (hookHit ? '#1f8a70' : '#e0533d') + '">' + (hookHit ? '命中' : '缺失') + '</div></div>' +
      '</div>' +
      '<div><div style="font-weight:600;margin:2px 0;font-size:12.5px;color:#556">口播结构拆解（' + effN + ' 句有效）</div><div class="vp-sa-rows">' + segHtml + '</div></div>' +
      '<div class="vp-sa-score"><span style="font-size:12.5px;color:#556">口播评分</span><div class="bar"><div class="fill" style="width:' + score + '%;background:' + scoreCol + '"></div></div><b style="color:' + scoreCol + '">' + score + '</b></div>' +
      covHtml + '</div>';
  }

  // ===== 生成衍生跑量口播（零Key + AI 双模式）=====
  function vpCallAi(text) {
    const conf = aiConfGet();
    if (!conf.key) return null;
    const ep = conf.base.replace(/\/+$/, '') + '/chat/completions';
    return fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.key }, body: JSON.stringify({ model: conf.model, messages: [{ role: 'user', content: text }], temperature: 0.8, max_tokens: 1400 }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; });
  }
  const GEN_HOOKS = ['注意！', '别再花冤枉钱了', '终于被我找到了', '揭秘一个冷知识', '为什么你总买错？', '听我说一句', '小心这个坑', '只需这一步'];
  const GEN_CTA = ['点击下方小黄车带回家', '现在下单立享优惠', '赶紧点链接抢购', '限量秒杀中手慢无', '点击下方立即领取'];
  const GEN_CROWD = ['宝妈', '上班族', '租房党', '长辈', '学生党', '新手妈妈'];
  const GEN_SCENE = ['早起赶时间', '下班回家', '周末大扫除', '朋友聚餐', '换季收纳', '熬夜追剧'];
  function zeroKeyGen(modes, sells, cat) {
    const tpl = (typeof VP_TEMPLATES !== 'undefined' && VP_TEMPLATES[cat]) || (typeof VP_TEMPLATES !== 'undefined' ? VP_TEMPLATES['default'] : { sells: '核心卖点', hook: '' });
    const sellList = sells.length ? sells : (tpl.sells ? tpl.sells.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : ['核心卖点']);
    const items = [];
    const pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    if (modes.indexOf('hook') >= 0) GEN_HOOKS.slice(0, 3).forEach(function (h, i) { items.push({ label: '换钩子·' + (i + 1), text: h + '，' + pick(sellList) + '。' + pick(GEN_CTA) + '。' }); });
    if (modes.indexOf('crowd') >= 0) GEN_CROWD.slice(0, 3).forEach(function (c, i) { items.push({ label: '换人群·' + c, text: c + '注意了：' + pick(sellList) + '。' + pick(GEN_CTA) + '。' }); });
    if (modes.indexOf('scene') >= 0) GEN_SCENE.slice(0, 3).forEach(function (sc, i) { items.push({ label: '换场景·' + (i + 1), text: sc + '的时候，' + pick(sellList) + '。' + pick(GEN_CTA) + '。' }); });
    if (modes.indexOf('short') >= 0) items.push({ label: '浓缩版', text: sellList.slice(0, 2).join('，') + '。' + pick(GEN_CTA) + '。' });
    if (modes.indexOf('long') >= 0) items.push({ label: '扩写版', text: (tpl.hook || GEN_HOOKS[0]) + '。' + pick(sellList) + '。' + pick(sellList) + '。' + pick(GEN_CTA) + '。' });
    return items;
  }
  function genDerivativeScripts() {
    const out = document.getElementById('vpScriptOut'); if (!out) return;
    const ta = document.getElementById('vpScript'); const base = (ta ? ta.value : '').trim();
    const sells = (VP.ai && VP.ai.analysis && VP.ai.analysis.selling_points) || [];
    const cat = (VP.mat && VP.mat.cat) || '';
    const modes = [].slice.call(document.querySelectorAll('#vpGenModes .vp-mode.on')).map(function (b) { return b.dataset.m; });
    const useModes = modes.length ? modes : ['hook', 'crowd', 'scene'];
    const conf = aiConfGet();
    if (conf.key) {
      const sellTxt = sells.length ? sells.join('；') : (((typeof VP_TEMPLATES !== 'undefined' && VP_TEMPLATES[cat]) || VP_TEMPLATES['default']).sells || '核心卖点');
      const modeTxt = useModes.map(function (m) { return ({ hook: '换不同类型钩子', crowd: '换目标人群', scene: '换使用场景', short: '浓缩成一句话', long: '扩写成完整版' })[m] || m; }).join('、');
      const prompt = '你是有10年经验的短视频信息流投放脚本写手。基于以下素材信息，生成若干条不同的跑量口播文案，每条控制在120字以内，口语化、有钩子有CTA。\n素材品类：' + (cat || '未指定') + '\n核心卖点：' + sellTxt + '\n原口播参考：' + (base || '无') + '\n请按以下角度各生成1条：' + modeTxt + '。\n严格只输出 JSON 数组，格式：[{"label":"角度名","text":"口播文案"}]，不要任何解释文字。';
      out.innerHTML = '<div class="vp-note-inline">🤖 调用 AI 生成中…</div>';
      vpCallAi(prompt).then(function (txt) {
        let items = [];
        try { const m = txt.match(/\[[\s\S]*\]/); if (m) items = JSON.parse(m[0]); } catch (e) {}
        if (!items.length) items = zeroKeyGen(useModes, sells, cat);
        renderGen(out, items);
      }).catch(function () { renderGen(out, zeroKeyGen(useModes, sells, cat)); });
    } else {
      renderGen(out, zeroKeyGen(useModes, sells, cat));
    }
  }
  function renderGen(out, items) {
    if (!items.length) { out.innerHTML = '<div class="vp-note-inline">暂无可生成的变体，请先有卖点（AI 拆解或品类模板）或选择变体模式。</div>'; return; }
    out.innerHTML = '<div class="vp-gen-list">' + items.map(function (it, i) {
      return '<div class="vp-gen-item"><div class="gh"><span class="gt">' + escapeHtml(it.label || ('变体' + (i + 1))) + '</span></div><div class="gtxt">' + escapeHtml(it.text) + '</div><div class="gbtns"><button type="button" class="btn xs" data-gc="' + i + '">复制</button><button type="button" class="btn xs" data-gf="' + i + '">填入口播</button></div></div>';
    }).join('') + '</div>';
    const nodes = out.querySelectorAll('.vp-gen-item');
    nodes.forEach(function (node, i) {
      const cb = node.querySelector('[data-gc]'), fb = node.querySelector('[data-gf]');
      if (cb) cb.onclick = function () { if (navigator.clipboard) navigator.clipboard.writeText(items[i].text); cb.textContent = '已复制'; setTimeout(function () { cb.textContent = '复制'; }, 1200); };
      if (fb) fb.onclick = function () { const ta = document.getElementById('vpScript'); if (ta) ta.value = items[i].text; fb.textContent = '已填入'; setTimeout(function () { fb.textContent = '填入口播'; }, 1200); };
    });
  }
  function toggleGenModes() {
    const m = document.getElementById('vpGenModes');
    if (m) m.style.display = (m.style.display === 'none' || !m.style.display) ? 'inline-flex' : 'none';
    genDerivativeScripts();
  }

  // ===== 脚本生成器：参考当前素材脚本生成全新口播文案 =====
  function zeroKeyGenFromRef(modes, sells, cat, ref) {
    const tpl = (typeof VP_TEMPLATES !== 'undefined' && VP_TEMPLATES[cat]) || (typeof VP_TEMPLATES !== 'undefined' ? VP_TEMPLATES['default'] : { sells: '核心卖点', hook: '' });
    const sellList = sells.length ? sells : (tpl.sells ? tpl.sells.split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : ['核心卖点']);
    const pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    const sentences = (ref || '').split(/[。！？!?；;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    const origHook = sentences[0] || '';
    const body = sentences.slice(1).join('。') || pick(sellList);
    const items = [];
    if (modes.indexOf('hook') >= 0) GEN_HOOKS.slice(0, 3).forEach(function (h, i) { items.push({ label: '换钩子·' + (i + 1), text: h + '，' + body + '。' + pick(GEN_CTA) + '。' }); });
    if (modes.indexOf('crowd') >= 0) GEN_CROWD.slice(0, 3).forEach(function (c, i) { items.push({ label: '换人群·' + c, text: c + '注意了：' + body + '。' + pick(GEN_CTA) + '。' }); });
    if (modes.indexOf('scene') >= 0) GEN_SCENE.slice(0, 3).forEach(function (sc, i) { items.push({ label: '换场景·' + (i + 1), text: sc + '的时候，' + body + '。' + pick(GEN_CTA) + '。' }); });
    if (modes.indexOf('short') >= 0) items.push({ label: '浓缩版', text: (origHook ? origHook + '，' : '') + sellList.slice(0, 2).join('，') + '。' + pick(GEN_CTA) + '。' });
    if (modes.indexOf('long') >= 0) items.push({ label: '扩写版', text: (origHook || pick(GEN_HOOKS)) + '。' + body + '。' + pick(sellList) + '。' + pick(GEN_CTA) + '。' });
    return items;
  }
  function vpRunScriptGen() {
    const out = document.getElementById('vpScriptGenOut'); if (!out) return;
    const refTa = document.getElementById('vpGenRef');
    const srcTa = document.getElementById('vpScript');
    let ref = (refTa ? refTa.value : '').trim() || (srcTa ? srcTa.value : '').trim();
    if (!ref) { out.innerHTML = '<div class="vp-note-inline">请先在「素材文案/逐字稿」框填入参考脚本，或在本面板参考脚本框中粘贴。</div>'; return; }
    const sells = (VP.ai && VP.ai.analysis && VP.ai.analysis.selling_points) || [];
    const cat = (VP.mat && VP.mat.cat) || '';
    const modes = [].slice.call(document.querySelectorAll('#vpScriptGenModes .vp-mode.on')).map(function (b) { return b.dataset.m; });
    const useModes = modes.length ? modes : ['hook', 'crowd', 'scene'];
    const conf = aiConfGet();
    if (conf.key) {
      const sellTxt = sells.length ? sells.join('；') : ((typeof VP_TEMPLATES !== 'undefined' && (VP_TEMPLATES[cat] || VP_TEMPLATES['default'])) ? (VP_TEMPLATES[cat] || VP_TEMPLATES['default']).sells : '核心卖点');
      const modeTxt = useModes.map(function (m) { return ({ hook: '换不同类型钩子', crowd: '换目标人群', scene: '换使用场景', short: '浓缩成一句话', long: '扩写成完整版' })[m] || m; }).join('、');
      const prompt = '你是有10年经验的短视频信息流投放脚本写手。请基于以下「参考脚本」，生成若干条全新的跑量口播文案，要求保留原脚本的核心卖点与叙事节奏，但在钩子、人群、场景或篇幅上做出差异化。每条控制在120字以内，口语化、有钩子有CTA，禁止照搬原句。\n素材品类：' + (cat || '未指定') + '\n核心卖点：' + sellTxt + '\n参考脚本：' + ref + '\n请按以下角度各生成1条：' + modeTxt + '。\n严格只输出 JSON 数组，格式：[{"label":"角度名","text":"口播文案"}]，不要任何解释文字。';
      out.innerHTML = '<div class="vp-note-inline">🤖 调用 AI 生成中…</div>';
      vpCallAi(prompt).then(function (txt) {
        let items = [];
        try { const m = txt.match(/\[[\s\S]*\]/); if (m) items = JSON.parse(m[0]); } catch (e) {}
        if (!items.length) items = zeroKeyGenFromRef(useModes, sells, cat, ref);
        renderGen(out, items);
      }).catch(function () { renderGen(out, zeroKeyGenFromRef(useModes, sells, cat, ref)); });
    } else {
      renderGen(out, zeroKeyGenFromRef(useModes, sells, cat, ref));
    }
  }

  function initVParseDeep() {
    const b = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
    b('vpDeepBtn', vpRunDeep);
    b('vpAiBtn', vpRunAI);
    b('vpReplicateBtn', vpRunReplicate);
    b('vpRepSave', function () { exportSectionHtml({ ids: ['vpReplicateOut'], title: '🚀 一键复刻跑量素材', prefix: '复刻案例' }); });
    b('vpInsightSave', function () { exportSectionHtml({ ids: ['vpInsight', 'vpScriptOut'], title: '💡 信息流投放理解分析', prefix: '理解分析' }); });
    b('vpScriptGenSave', function () { exportSectionHtml({ ids: ['vpScriptGenOut'], title: '🎯 脚本生成器', prefix: '脚本生成' }); });
    b('vpExportOffline', exportOfflineHtml);
    b('vpAiSetBtn', openAiModal);
    b('vpWhisperBtn', vpRunWhisper);
    b('vpOcrDebugBtn', vpRunOcrDebug);
    b('vpDeepFill', vpDeepFill);
    b('vpAnalyzeBtn', vpGenerateInsight);
    b('vpAnalyseScript', analyzeScript);
    b('vpGenScript', toggleGenModes);
    const _gm = document.getElementById('vpGenModes'); if (_gm) { _gm.querySelectorAll('.vp-mode').forEach(function (mb) { mb.onclick = function () { mb.classList.toggle('on'); genDerivativeScripts(); }; }); }
    b('vpScriptGenBtn', vpRunScriptGen);
    const _sgm = document.getElementById('vpScriptGenModes'); if (_sgm) { _sgm.querySelectorAll('.vp-mode').forEach(function (mb) { mb.onclick = function () { mb.classList.toggle('on'); }; }); }
    b('vpAiClose', closeAiModal);
    b('vpAiSave', saveAiKey);
    b('vpAiClear', clearAiKey);
    // 解析案例库
    b('vpCaseAdd', () => caseFillForm(null));
    b('vpCaseExport', caseExportMd);
    b('vpCaseExportJson', caseExportJson);
    b('vpCaseExportFull', caseExportFull);
    // 导入案例库（从导出的 cases.json 合并进本机）
    b('vpCaseImport', function () { const inp = document.getElementById('vpCaseImportFile'); if (inp) inp.click(); });
    const _imp = document.getElementById('vpCaseImportFile');
    if (_imp) _imp.addEventListener('change', function () {
      if (_imp.files && _imp.files[0]) caseImportJson(_imp.files[0]);
      _imp.value = '';
    });
    b('vpPackCase', packAllAsCase);
    b('vpPackCaseBar', packAllAsCase);
    // 🎬 打开本地 AI 视频生成工具（即创自动化，含提示词模板）
    b('vpAigenBtn', function () { window.open('http://127.0.0.1:8899/?mode=jichuang', '_blank'); });
    b('vpCaseCancel', () => { const f = document.getElementById('vpCaseForm'); if (f) f.style.display = 'none'; });
    b('vpCaseSave', () => {
      const t = document.getElementById('vpCaseTitle'), c = document.getElementById('vpCaseContent'), f = document.getElementById('vpCaseForm');
      if (!t || !c) return;
      const title = t.value.trim() || '(无标题)';
      const content = c.value.trim();
      if (!content) { t.focus(); return; }
      caseAddOrEdit(f && f.dataset.edit, title, content);
      if (f) { f.style.display = 'none'; f.dataset.edit = ''; }
    });
    const cl = document.getElementById('vpCaseList');
    if (cl) cl.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]'); if (!btn) return;
      const id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
      if (act === 'ref') caseToggleRef(id);
      else if (act === 'edit') caseFillForm(id);
      else if (act === 'del') { if (confirm('确定删除该案例？')) caseDel(id); }
      else if (act === 'expand') {
        const full = document.getElementById('vpCaseFull-' + id);
        if (full) { const open = full.style.display !== 'none'; full.style.display = open ? 'none' : 'block'; btn.textContent = open ? '展开全文' : '收起'; }
      }
      else if (act === 'fullana') {
        const full = document.getElementById('vpCaseFullAna-' + id);
        if (full) { const open = full.style.display !== 'none'; full.style.display = open ? 'none' : 'block'; btn.textContent = open ? '📂 展开完整分析（复刻 / 理解 / 脚本 / 投放 / 拆解）' : '📁 收起完整分析'; }
      }
      else if (act === 'loadVideo') {
        const fin = document.getElementById('vpCaseFile-' + id); if (fin) fin.click();
      }
    });
    if (cl) cl.addEventListener('change', e => {
      const input = e.target.closest('input[type="file"][data-video-for]'); if (!input) return;
      const file = input.files && input.files[0]; if (!file) return;
      const id = input.getAttribute('data-video-for');
      const wrap = document.getElementById('vpCaseVideoWrap-' + id);
      const video = document.getElementById('vpCaseVideo-' + id);
      const hint = document.getElementById('vpCaseVideoHint-' + id);
      if (!video || !wrap) return;
      const url = URL.createObjectURL(file);
      const old = video.src; video.src = url;
      if (old && old.startsWith('blob:')) { try { URL.revokeObjectURL(old); } catch (e) {} }
      wrap.style.display = 'block';
      video.play().catch(function () {});
      // 同时把用户补选的视频文件持久化到 IndexedDB，并更新案例记录
      saveVideo(id, file, file.name).then(function () {
        const loc = caseGetLocal();
        const it = loc.find(function (x) { return x.id === id; });
        if (it) { it.hasVideo = true; it.videoName = file.name; caseSaveLocal(loc); }
        if (hint) hint.textContent = '视频已缓存于浏览器，可直接播放';
      }).catch(function () {});
    });
    // 加载已发布案例（cases.json），支持离线看板跨设备展示；失败（如本地 file:// 打开）则仅用 localStorage
    try {
      fetch(CASE_URL).then(function (r) { return r.ok ? r.json() : []; }).then(function (j) {
        if (Array.isArray(j)) { PUBLISHED_CASES = j; caseRender(); }
      }).catch(function () {});
    } catch (e) {}
    caseRender();
    updateAiTag();
    const _pv = document.getElementById('vpAiProvider'); if (_pv) _pv.addEventListener('change', onProviderChange);
    const _cd = document.getElementById('vpCutDur'); if (_cd) _cd.addEventListener('input', renderCostEstimate);
    renderCostEstimate();
    const mask = document.getElementById('vpAiMask');
    if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeAiModal(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initVParseDeep);
  else initVParseDeep();

  // 暴露到全局，便于调试 / 其它脚本调用
  window.VPDeep = { runDeep: vpRunDeep, runAI: vpRunAI, runWhisper: vpRunWhisper, fill: vpDeepFill, ocrDebug: vpRunOcrDebug, insight: vpGenerateInsight };

  // ===== 导出离线版（轻量 HTML + 同目录视频文件）=====
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} try { a.remove(); } catch (e) {} }, 1500);
  }
  // 收集文档内所有含 'vp' 的 CSS 规则，内联进离线 HTML，保证离线样式与线上一致
  function collectVpCss() {
    let css = '';
    try {
      const sheets = document.styleSheets;
      for (let i = 0; i < sheets.length; i++) {
        let rules; try { rules = sheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (let j = 0; j < rules.length; j++) {
          const r = rules[j];
          const sel = r.selectorText || '';
          if (sel && sel.indexOf('vp') >= 0) css += r.cssText + '\n';
        }
      }
    } catch (e) {}
    return css;
  }
  function exportOfflineHtml() {
    if (!VP.videoFile) { alert('请先加载视频，再导出离线版。'); return; }
    const sid = VP.sid || '';
    const baseName = '视频解析-' + (sid || (VP.fileName || 'video').replace(/\.[^.]+$/, ''));
    const vfName = VP.videoFile.name || (baseName + '.mp4');
    const ext = vfName.lastIndexOf('.') >= 0 ? vfName.slice(vfName.lastIndexOf('.')) : '.mp4';
    const videoRel = baseName + ext; // HTML 用相对路径引用，与下载的视频文件名严格一致

    function grab(id) { const e = document.getElementById(id); return e ? e.innerHTML : ''; }
    const reportHtml = grab('vpReport');
    const boomHtml = grab('vpParseAiReport');
    const repHtml = grab('vpReplicateOut');
    const scriptHtml = grab('vpScriptOut');
    const genHtml = grab('vpScriptGenOut');
    const insightHtml = grab('vpInsight');
    const meta = VP.meta || {};
    const now = new Date().toLocaleString('zh-CN');
    const frameCount = (VP.frames || []).filter(function (f) { return f.dataURL; }).length;
    const vpCss = collectVpCss();

    const html = [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>视频解析离线版 · ' + escapeHtml(sid || VP.fileName || 'video') + '</title>',
      '<style>',
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#1f2430;margin:0;padding:24px;}',
      '.off-wrap{max-width:1000px;margin:0 auto;background:#fff;border-radius:14px;padding:22px 26px;box-shadow:0 2px 14px rgba(0,0,0,.06);}',
      '.off-head{border-bottom:1px solid #eef0f3;padding-bottom:14px;margin-bottom:18px;}',
      '.off-head h1{font-size:20px;margin:0 0 6px}',
      '.off-meta{color:#6b7280;font-size:13px;line-height:1.7}',
      '.off-video{margin:14px 0 22px}',
      '.off-video video{width:100%;max-height:520px;background:#000;border-radius:10px;}',
      '.off-note{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;border-radius:8px;padding:8px 12px;font-size:13px;margin:8px 0 18px;}',
      '.off-sec{margin:22px 0;}',
      '.off-sec-h{font-size:16px;font-weight:700;margin:0 0 10px;color:#2563eb;}',
      '.off-empty{color:#9aa1ad;font-size:13px;}',
      vpCss,
      '</style></head><body><div class="off-wrap">',
      '<div class="off-head"><h1>🎬 视频解析离线版</h1>',
      '<div class="off-meta">素材ID：' + escapeHtml(sid || '（未识别）') + '　|　文件名：' + escapeHtml(VP.fileName || '—') + '<br>',
      '时长：' + (meta.duration ? meta.duration.toFixed(1) + 's' : '—') + '　|　分辨率：' + (meta.w ? meta.w + '×' + meta.h : '—') + '　|　抽帧：' + frameCount + ' 张<br>',
      '导出时间：' + now + '</div></div>',
      '<div class="off-video"><video src="./' + escapeHtml(videoRel) + '" controls preload="metadata"></video>',
      '<div class="off-note">⚠️ 请把本 HTML 与视频文件 <b>' + escapeHtml(videoRel) + '</b> 放在<b>同一个文件夹</b>，用浏览器打开 HTML 即可离线播放与查看分析。</div></div>',
      '<div class="off-sec"><div class="off-sec-h">📊 投放数据</div>' + (reportHtml || '<div class="off-empty">（未生成投放数据，请先在看板点「匹配报表」）</div>') + '</div>',
      '<div class="off-sec"><div class="off-sec-h">🎯 爆款拆解 / 逐秒分析</div>' + (boomHtml || '<div class="off-empty">（未生成，请先点「生成理解分析」或 AI 语义拆解）</div>') + '</div>',
      '<div class="off-sec"><div class="off-sec-h">🚀 一键复刻三件套</div>' + (repHtml || '<div class="off-empty">（未生成，请先点「🚀 一键复刻」）</div>') + '</div>',
      '<div class="off-sec"><div class="off-sec-h">💡 理解分析 / 文案口播</div>' + (insightHtml || '') + (scriptHtml || '') + (genHtml || '') + ((insightHtml || scriptHtml || genHtml) ? '' : '<div class="off-empty">（未生成）</div>') + '</div>',
      '</div></body></html>'
    ].join('\n');

    try {
      downloadBlob(VP.videoFile, videoRel);
      setTimeout(function () {
        downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName + '.html');
        alert('已导出 2 个文件到下载目录：\n\n• ' + baseName + '.html\n• ' + videoRel + '\n\n把它们放在同一个文件夹，双击 HTML 即可离线查看（视频会自动加载）。');
      }, 600);
    } catch (e) {
      alert('导出失败：' + (e && e.message ? e.message : e));
    }
  }
  // 单个/组合分析模块"保存为案例"：导出该模块内容为独立、离线可看的 HTML 文件（自带样式，双击即看，可丢进案例库文件夹）
  function exportSectionHtml(opts) {
    var ids = opts.ids || [];
    function grab(id) { var e = document.getElementById(id); return e ? e.innerHTML : ''; }
    var parts = ids.map(grab);
    var allEmpty = parts.every(function (h) {
      if (!h || !h.trim()) return true;
      return h.indexOf('muted') >= 0 && (h.indexOf('点「') >= 0 || h.indexOf('还没有') >= 0 || h.indexOf('（未生成') >= 0);
    });
    if (allEmpty) { alert('该模块还没有生成内容，请先点击生成后再保存案例。'); return; }
    var sid = VP.sid || '';
    var baseName = opts.prefix + '-' + (sid || (VP.fileName || 'video').replace(/\.[^.]+$/, ''));
    var meta = VP.meta || {};
    var now = new Date().toLocaleString('zh-CN');
    var vpCss = collectVpCss();
    var body = parts.join('\n');
    var html = [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>' + escapeHtml(opts.title) + ' · ' + escapeHtml(sid || VP.fileName || 'video') + '</title>',
      '<style>',
      'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#1f2430;margin:0;padding:24px;}',
      '.sec-wrap{max-width:1000px;margin:0 auto;background:#fff;border-radius:14px;padding:22px 26px;box-shadow:0 2px 14px rgba(0,0,0,.06);}',
      '.sec-head{border-bottom:1px solid #eef0f3;padding-bottom:14px;margin-bottom:18px;}',
      '.sec-head h1{font-size:20px;margin:0 0 6px}',
      '.sec-badge{display:inline-block;background:#eef2ff;color:#2563eb;border-radius:8px;padding:3px 10px;font-size:13px;font-weight:700;margin-bottom:10px}',
      '.sec-meta{color:#6b7280;font-size:13px;line-height:1.7}',
      vpCss,
      '</style></head><body><div class="sec-wrap">',
      '<div class="sec-head"><span class="sec-badge">' + escapeHtml(opts.title) + '</span>',
      '<h1>📁 素材分析案例</h1>',
      '<div class="sec-meta">素材ID：' + escapeHtml(sid || '（未识别）') + '　|　文件名：' + escapeHtml(VP.fileName || '—') + '<br>',
      '时长：' + (meta.duration ? meta.duration.toFixed(1) + 's' : '—') + '　|　分辨率：' + (meta.w ? meta.w + '×' + meta.h : '—') + '<br>',
      '保存时间：' + now + '</div></div>',
      body,
      '</div></body></html>'
    ].join('\n');
    try {
      downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName + '.html');
      alert('已保存：' + baseName + '.html\n（独立 HTML，离线双击即可查看，可放进你的案例库文件夹）');
    } catch (e) {
      alert('保存失败：' + (e && e.message ? e.message : e));
    }
  }
})();
