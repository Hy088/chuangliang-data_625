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
  const ZHIPU_KEY = 'vp_zhipu_key', ZHIPU_MODEL = 'vp_zhipu_model', WHISPER_MODEL_KEY = 'vp_whisper_model';
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
若提供了口播时间轴，请优先结合时间轴理解素材节奏再拆解。`;


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
  function aiKeyGet() { try { return localStorage.getItem(ZHIPU_KEY) || ''; } catch (e) { return ''; } }
  function aiKeySet(v) { try { localStorage.setItem(ZHIPU_KEY, v); } catch (e) {} }
  function aiModelGet() { try { return localStorage.getItem(ZHIPU_MODEL) || 'glm-4v-flash'; } catch (e) { return 'glm-4v-flash'; } }
  function aiModelSet(v) { try { localStorage.setItem(ZHIPU_MODEL, v); } catch (e) {} }
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
  // 智谱 GLM-4V-Flash 免费语义拆解（浏览器直连，无需后端）
  // ============================================================
  async function vpRunAI() {
    const key = aiKeyGet();
    if (!key) { openAiModal(); return; }
    const model = aiModelGet();
    showCard('vpAi');
    const out = document.getElementById('vpAiOut');
    if (out) out.innerHTML = '<div class="muted">抽取关键帧送 GLM-4V-Flash 分析中…</div>';
    try {
      const frames = (VP.frames || []).filter(f => f.dataURL);
      if (!frames.length) { if (out) out.innerHTML = '<div class="vp-warn">请先抽帧（点「重新抽帧」）再拆解。</div>'; return; }
      const step = Math.max(1, Math.ceil(frames.length / 6));
      const pick = frames.filter((_, i) => i % step === 0).slice(0, 6);
      let promptText = AI_PROMPT;
      // 追加可用投放数据，帮助 AI 做真实数据表现分析
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
      if (segs && segs.length) {
        promptText += '\n\n【口播时间轴】\n' + whisper;
      } else if (whisper) {
        promptText += '\n\n【识别口播】\n' + whisper;
      }
      const content = [{ type: 'text', text: promptText }];
      pick.forEach(f => content.push({ type: 'image_url', image_url: { url: f.dataURL } }));
      const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.6, max_tokens: 1024 })
      });
      if (!resp.ok) { const t = await resp.text(); throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 200)); }
      if (resp.status === 400) {
        const t = await resp.text();
        // 智谱常见 400：max_tokens 超限、参数非法
        if (t.indexOf('max_tokens') >= 0 || t.indexOf('1210') >= 0) {
          throw new Error('max_tokens 参数非法（智谱限制 1-1024），请刷新页面使用最新脚本');
        }
        throw new Error('HTTP 400 ' + t.slice(0, 200));
      }
      const j = await resp.json();
      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      const ai = parseAi(txt);
      VP.ai = ai;
      renderAi(ai, txt);
      applyAiToParse(ai);
    } catch (e) {
      if (out) out.innerHTML = '<div class="vp-warn">AI 拆解失败：' + escapeHtml(e.message) + '（请检查 Key 是否正确、网络是否可访问 open.bigmodel.cn）</div>';
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
  out.innerHTML = html;
  const rep = document.getElementById('vpParseAiReport');
  if (rep) { rep.innerHTML = html; rep.classList.remove('muted'); }
}

function fmtInt(n){ return (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('zh-CN'); }
function renderBoomReport(ai) {
  const m = VP.mat || {};
  const an = ai.analysis || {};
  let h = '<div class="vp-boom">';

  h += '<div class="vp-boom-sec"><div class="vp-boom-h">一、报表数据（真实）</div>';
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
    h += '<div class="muted">未在报表匹配到该素材ID，以下仅视频侧分析。</div>';
  }
  h += '</div>';

  const sb = ai.storyboard || [];
  h += '<div class="vp-boom-sec"><div class="vp-boom-h">二、画面分镜（AI 读帧）</div>';
  if (sb.length) {
    h += '<div class="vp-boom-sb">';
    sb.forEach(function (s) {
      h += '<div class="vp-sb-item">';
      h += '<div class="vp-sb-frame">' + escapeHtml(s.frame || '') + '</div>';
      h += '<div class="vp-sb-body"><div class="vp-sb-stage">' + escapeHtml(s.stage || '') + '</div><div class="vp-sb-desc">' + escapeHtml(s.desc || '') + '</div></div>';
      h += '</div>';
    });
    h += '</div>';
  } else {
    h += '<div class="muted">AI 未返回分镜（可重新拆解或手动在下方填写）。</div>';
  }
  h += '</div>';

  h += '<div class="vp-boom-sec"><div class="vp-boom-h">三、解析结论</div>';
  if (an.hook) h += '<div class="vp-boom-blk"><div class="vp-boom-bh">1. Hook（开头3秒）</div><div class="vp-boom-bd">' + escapeHtml(an.hook) + '</div></div>';
  if (an.structure) h += '<div class="vp-boom-blk"><div class="vp-boom-bh">2. 画面分镜结构</div><div class="vp-boom-bd">' + escapeHtml(an.structure).replace(/\n/g, '<br>') + '</div></div>';
  if (an.selling_points && an.selling_points.length) h += '<div class="vp-boom-blk"><div class="vp-boom-bh">3. 核心卖点</div><div class="vp-boom-bd">' + an.selling_points.map(function (p) { return '<div class="vp-boom-li">' + escapeHtml(p) + '</div>'; }).join('') + '</div></div>';
  if (an.script_direction) h += '<div class="vp-boom-blk"><div class="vp-boom-bh">4. 口播脚本方向</div><div class="vp-boom-bd">' + escapeHtml(an.script_direction).replace(/\n/g, '<br>') + '</div></div>';
  if (an.replicable && an.replicable.length) h += '<div class="vp-boom-blk"><div class="vp-boom-bh">5. 可复制方向</div><div class="vp-boom-bd">' + an.replicable.map(function (p) { return '<div class="vp-boom-li">' + escapeHtml(p) + '</div>'; }).join('') + '</div></div>';
  h += '</div>';

  const na = ai.next_actions || [];
  h += '<div class="vp-boom-sec"><div class="vp-boom-h">四、后续可执行动作</div>';
  if (na.length) h += '<ul class="vp-boom-ul">' + na.map(function (a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('') + '</ul>';
  else h += '<div class="muted">（无）</div>';
  h += '</div>';

  h += '</div>';
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


  // ---- AI 设置弹窗 ----
  function openAiModal() {
    const mask = document.getElementById('vpAiMask'); if (!mask) return;
    const k = document.getElementById('vpAiKey'); if (k) k.value = aiKeyGet();
    const md = document.getElementById('vpAiModel'); if (md) md.value = aiModelGet();
    const wm = document.getElementById('vpWhisperModel'); if (wm) wm.value = whisperModelGet();
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '';
    mask.style.display = 'flex';
  }
  function closeAiModal() { const m = document.getElementById('vpAiMask'); if (m) m.style.display = 'none'; }
  function saveAiKey() {
    const k = document.getElementById('vpAiKey'); if (!k) return;
    const v = (k.value || '').trim();
    if (!v) { const h = document.getElementById('vpAiHint'); if (h) h.textContent = '请输入 Key'; return; }
    aiKeySet(v);
    const md = document.getElementById('vpAiModel'); if (md) aiModelSet(md.value);
    const wm = document.getElementById('vpWhisperModel'); if (wm) whisperModelSet(wm.value);
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '✅ 已保存（仅存于本机浏览器）';
    setTimeout(closeAiModal, 700);
  }
  function clearAiKey() {
    try { localStorage.removeItem(ZHIPU_KEY); } catch (e) {}
    const k = document.getElementById('vpAiKey'); if (k) k.value = '';
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '已清除 Key';
  }

  // ============================================================
  // 信息流投放理解分析（基于录入数据 + 经验阈值自动生成）
  // ============================================================
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
  function initVParseDeep() {
    const b = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
    b('vpDeepBtn', vpRunDeep);
    b('vpAiBtn', vpRunAI);
    b('vpAiSetBtn', openAiModal);
    b('vpWhisperBtn', vpRunWhisper);
    b('vpOcrDebugBtn', vpRunOcrDebug);
    b('vpDeepFill', vpDeepFill);
    b('vpAnalyzeBtn', vpGenerateInsight);
    b('vpAiClose', closeAiModal);
    b('vpAiSave', saveAiKey);
    b('vpAiClear', clearAiKey);
    const mask = document.getElementById('vpAiMask');
    if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeAiModal(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initVParseDeep);
  else initVParseDeep();

  // 暴露到全局，便于调试 / 其它脚本调用
  window.VPDeep = { runDeep: vpRunDeep, runAI: vpRunAI, runWhisper: vpRunWhisper, fill: vpDeepFill, ocrDebug: vpRunOcrDebug, insight: vpGenerateInsight };
})();
