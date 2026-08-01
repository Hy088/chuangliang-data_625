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
  const ZHIPU_KEY = 'vp_zhipu_key', ZHIPU_MODEL = 'vp_zhipu_model';
  const CDN = {
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    coco: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
    transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3'
  };
  const AI_PROMPT = `你是一名资深短视频投放创意分析师。下面是一段广告素材的若干均匀抽帧画面（按时间先后顺序排列）。请结合画面做结构化的「爆款拆解」，并严格只输出如下 JSON（不要 markdown 代码块、不要解释）：
{
  "hook": "前3秒钩子类型与具体手法（一句话）",
  "sells": ["核心卖点1","核心卖点2","核心卖点3"],
  "scene": "主要场景与画面风格",
  "audience": "目标人群画像",
  "cta": "行动号召方式与出现位置",
  "structure": "整体叙事结构（几段式、节奏快慢）",
  "direction": ["可复制的生产方向1","可复制的生产方向2","可复制的生产方向3"],
  "score": "0-100 爆款潜力评分 + 一句话理由"
}`;

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
  function aiKeyGet() { try { return localStorage.getItem(ZHIPU_KEY) || ''; } catch (e) { return ''; } }
  function aiKeySet(v) { try { localStorage.setItem(ZHIPU_KEY, v); } catch (e) {} }
  function aiModelGet() { try { return localStorage.getItem(ZHIPU_MODEL) || 'glm-4v-flash'; } catch (e) { return 'glm-4v-flash'; } }
  function aiModelSet(v) { try { localStorage.setItem(ZHIPU_MODEL, v); } catch (e) {} }

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
    const ocr = (VP.deep.ocr || []).filter(x => x.text).map(x => fmtSec(x.t) + ' ' + x.text).join('\n');
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
  async function vpRunWhisper() {
    if (!VP.url) { alert('请先选择视频'); return; }
    const btn = document.getElementById('vpWhisperBtn');
    showCard('vpDeep'); showProg(true); setProg(5, '加载语音识别模型（首次约 100-200MB，请耐心等待）…');
    try {
      const mod = await import(CDN.transformers);
      const { pipeline, env } = mod;
      if (env && env.allowLocalModels !== undefined) env.allowLocalModels = false;
      const asr = await pipeline('automatic-speech-recognition', WHISPER_MODEL);
      setProg(45, '解码音轨…');
      const ab = await getAudioBuffer();
      const samples = resampleTo16k(ab);
      setProg(70, '识别中（可能需 10-40 秒）…');
      const out = await asr(samples, {
        sampling_rate: 16000, language: 'chinese', task: 'transcribe',
        chunk_length_s: 30, stride_length_s: 5, return_timestamps: false
      });
      const text = (out && out.text) || '';
      VP.deep.whisper = text.trim();
      renderDeepOcr();
      if (text.trim()) setProg(100, '语音识别完成'); else setProg(0, '未识别到语音内容');
      hideProgSoon();
    } catch (e) {
      setProg(0, '语音识别失败：' + e.message + '（若卡在模型下载，多为 HuggingFace CDN 访问慢，可重试或用本地离线版）');
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
      const content = [{ type: 'text', text: AI_PROMPT }];
      pick.forEach(f => content.push({ type: 'image_url', image_url: { url: f.dataURL } }));
      const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.6, max_tokens: 1400 })
      });
      if (!resp.ok) { const t = await resp.text(); throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 200)); }
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
      const o = JSON.parse(s); const r = {};
      ['hook', 'sells', 'scene', 'audience', 'cta', 'structure', 'direction', 'score'].forEach(k => { if (o[k] !== undefined) r[k] = o[k]; });
      if (Object.keys(r).length) return r;
    } catch (e) {}
    return { raw: txt };
  }

  function renderAi(ai, raw) {
    const out = document.getElementById('vpAiOut'); if (!out) return;
    if (!ai) { out.innerHTML = '<div class="vp-warn">未解析到内容</div>'; return; }
    if (ai.raw) { out.innerHTML = '<div class="vp-ai-out">' + escapeHtml(ai.raw) + '</div>'; return; }
    const card = (t, v) => v ? '<div class="ai-card"><b>' + t + '：</b>' + escapeHtml(v) + '</div>' : '';
    let h = '';
    if (ai.hook) h += card('🪝 钩子', ai.hook);
    if (ai.sells && ai.sells.length) h += '<div class="ai-card"><b>💡 核心卖点：</b><ul>' + ai.sells.map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul></div>';
    if (ai.scene) h += card('🎬 场景/风格', ai.scene);
    if (ai.audience) h += card('🎯 人群', ai.audience);
    if (ai.cta) h += card('📣 行动号召', ai.cta);
    if (ai.structure) h += card('🧩 叙事结构', ai.structure);
    if (ai.direction && ai.direction.length) h += '<div class="ai-card"><b>♻ 可复制方向：</b><ul>' + ai.direction.map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul></div>';
    if (ai.score) h += card('🔥 爆款潜力', ai.score);
    out.innerHTML = h || '<div class="muted">模型未返回结构化字段</div>';
  }

  function applyAiToParse(ai) {
    if (!ai || ai.raw) return;
    const setV = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    if (ai.hook) setV('vpHook', ai.hook);
    if (ai.sells && ai.sells.length) setV('vpSells', ai.sells.join('\n'));
    let shots = '';
    if (ai.structure) shots += ai.structure + '\n';
    if (ai.scene) shots += '（场景：' + ai.scene + '）';
    if (ai.audience) shots += '（人群：' + ai.audience + '）';
    if (ai.cta) shots += '（CTA：' + ai.cta + '）';
    setV('vpShots', shots.trim());
    let dir = '';
    if (ai.direction) dir = (Array.isArray(ai.direction) ? ai.direction.join('\n') : ai.direction);
    if (ai.score) dir += '\n（爆款潜力：' + ai.score + '）';
    setV('vpDir', dir.trim());
  }

  // ---- AI 设置弹窗 ----
  function openAiModal() {
    const mask = document.getElementById('vpAiMask'); if (!mask) return;
    const k = document.getElementById('vpAiKey'); if (k) k.value = aiKeyGet();
    const md = document.getElementById('vpAiModel'); if (md) md.value = aiModelGet();
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
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '✅ 已保存（仅存于本机浏览器）';
    setTimeout(closeAiModal, 700);
  }
  function clearAiKey() {
    try { localStorage.removeItem(ZHIPU_KEY); } catch (e) {}
    const k = document.getElementById('vpAiKey'); if (k) k.value = '';
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '已清除 Key';
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
    b('vpAiClose', closeAiModal);
    b('vpAiSave', saveAiKey);
    b('vpAiClear', clearAiKey);
    const mask = document.getElementById('vpAiMask');
    if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeAiModal(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initVParseDeep);
  else initVParseDeep();

  // 暴露到全局，便于调试 / 其它脚本调用
  window.VPDeep = { runDeep: vpRunDeep, runAI: vpRunAI, runWhisper: vpRunWhisper, fill: vpDeepFill, ocrDebug: vpRunOcrDebug };
})();
