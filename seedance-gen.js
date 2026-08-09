/* ============================================================
 * Seedance 2.0 / Seedream 生成面板
 * 挂载到「🎬 视频解析」标签，提供「解析模式 / 生成模式」切换。
 * 支持：文生视频 / 图生视频(首帧·首尾帧·参考图) / 文生图(Seedream)
 * 调用方式：本地代理(localhost:8788) 或 浏览器直连(填 ARK Key)
 * 视频为异步任务(提交后自动轮询)，图片为同步返回。
 * ============================================================ */
(function () {
  const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
  const PROXY = 'http://localhost:8788';
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const VID_MODELS = [
    'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615'
  ];
  const IMG_MODELS = [
    'doubao-seedream-4-0-250828', 'doubao-seedream-4-5-251128',
    'doubao-seedream-5-0-lite-260128'
  ];

  const state = {
    mode: 'parse',     // parse | gen
    type: 't2v',       // t2v | i2v-first | i2v-fl | i2v-ref | i2i
    call: 'proxy',     // proxy | direct
    refs: []           // {name, dataUrl}
  };
  let pollAbort = false;

  // ---------------- 注入样式 ----------------
  const STYLE = `
  .sdg-toggle{display:flex;gap:10px;align-items:center;margin:0 0 16px;flex-wrap:wrap}
  .sdg-toggle .sdg-tip{color:var(--muted);font-size:13px}
  .sdg-card{margin-bottom:16px}
  .sdg-row{display:flex;gap:12px;align-items:flex-start;margin:12px 0;flex-wrap:wrap}
  .sdg-row.sdg-col{flex-direction:column;align-items:stretch}
  .sdg-lb{min-width:84px;font-weight:600;color:var(--ink);font-size:13px;padding-top:6px}
  .sdg-input{flex:1;min-width:240px;max-width:680px;background:var(--panel);color:var(--ink);
    border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:13px;font-family:inherit;resize:vertical}
  .sdg-input:focus{outline:none;border-color:var(--brand)}
  textarea.sdg-input{line-height:1.5}
  .sdg-params .seg,.sdg-row .seg{margin:0}
  .sdg-params label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
  .sdg-params select,.sdg-params input[type=number]{background:var(--panel);color:var(--ink);
    border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:13px;font-family:inherit;min-width:96px}
  .sdg-chk{flex-direction:row!important;align-items:center!important;gap:6px!important;color:var(--ink)!important;font-size:13px!important}
  .sdg-refbox{border:1px dashed var(--line);border-radius:12px;padding:14px;flex:1;background:var(--panel)}
  .sdg-ref-add{display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--brand);
    border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600}
  .sdg-ref-add:hover{background:rgba(47,107,255,.06)}
  .sdg-ref-previews{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
  .sdg-ref-thumb{position:relative;width:96px;height:96px;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
  .sdg-ref-thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .sdg-ref-thumb .x{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;
    background:rgba(0,0,0,.6);color:#fff;display:flex;align-items:center;justify-content:center;
    cursor:pointer;font-size:13px;line-height:1}
  .sdg-ref-thumb .idx{position:absolute;bottom:3px;left:3px;background:rgba(0,0,0,.6);color:#fff;
    font-size:11px;padding:1px 6px;border-radius:6px}
  .sdg-actions{display:flex;gap:12px;align-items:center;margin-top:14px;flex-wrap:wrap}
  .sdg-status{flex:1;min-width:200px;font-size:13px;color:var(--muted)}
  .sdg-status.err{color:#ef4444}
  .sdg-status.ok{color:#12a06a}
  .sdg-result-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:6px}
  .sdg-result-item{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}
  .sdg-result-item video,.sdg-result-item img{width:100%;display:block;background:#000}
  .sdg-result-bar{display:flex;gap:8px;padding:8px 10px;align-items:center;flex-wrap:wrap}
  .sdg-result-bar a{font-size:12px}
  .sdg-result-bar .rz-tag{font-size:11px;color:var(--muted)}
  .sdg-copy{font-size:12px;color:var(--brand);cursor:pointer;border:1px solid var(--line);
    border-radius:7px;padding:4px 9px;background:transparent}
  .sdg-copy:hover{background:rgba(47,107,255,.06)}
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'sdg-style';
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ---------------- 注入切换条 + 面板 ----------------
  const TOGGLE = `
  <div class="sdg-toggle" id="sdgToggle">
    <div class="seg" id="sdgMode">
      <span class="seg-btn on" data-mode="parse">🔍 解析模式</span>
      <span class="seg-btn" data-mode="gen">🎨 生成模式 (Seedance 2.0)</span>
    </div>
    <span class="sdg-tip">生成模式：文生视频 / 图生视频 / 文生图，一键调用火山方舟</span>
  </div>`;

  const PANEL = `
  <div id="vpGen" style="display:none">
    <div class="card sdg-card">
      <h2>🎨 Seedance 2.0 生成 <span class="tag">文生视频 · 图生视频 · 文生图(Seedream)</span></h2>
      <div class="note">填好提示词与参数后一键生成。视频为异步任务（提交后自动轮询，约 1–5 分钟）；图片同步返回。密钥仅存本机浏览器（直连模式）或本地 <code>.env</code>（代理模式），不会上传任何第三方。</div>

      <div class="sdg-row">
        <label class="sdg-lb">生成类型</label>
        <div class="seg" id="sdgType">
          <span class="seg-btn on" data-type="t2v">文生视频</span>
          <span class="seg-btn" data-type="i2v-first">图生视频·首帧</span>
          <span class="seg-btn" data-type="i2v-fl">图生视频·首尾帧</span>
          <span class="seg-btn" data-type="i2v-ref">图生视频·参考图</span>
          <span class="seg-btn" data-type="i2i">文生图(Seedream)</span>
        </div>
      </div>

      <div class="sdg-row">
        <label class="sdg-lb">模型</label>
        <input list="sdgModels" id="sdgModel" class="sdg-input" value="doubao-seedance-2-0-260128" style="max-width:420px">
        <datalist id="sdgModels">
          <option value="doubao-seedance-2-0-260128">Seedance 2.0</option>
          <option value="doubao-seedance-2-0-fast-260128">Seedance 2.0 fast</option>
          <option value="doubao-seedream-4-0-250828">Seedream 4.0</option>
          <option value="doubao-seedream-4-5-251128">Seedream 4.5</option>
          <option value="doubao-seedream-5-0-lite-260128">Seedream 5.0 lite</option>
        </datalist>
        <span class="note" style="margin:0;flex-basis:100%">视频默认 Seedance 2.0；切到「文生图」会自动换 Seedream，可手动改。</span>
      </div>

      <div class="sdg-row sdg-col">
        <label class="sdg-lb">提示词 (Prompt)</label>
        <textarea id="sdgPrompt" rows="4" class="sdg-input" placeholder="例如：第一人称视角果茶宣传广告，手摘下带晨露的红苹果，雪克杯摇匀加冰，分层果茶倒入透明杯，粉色包装贴标，卡点轻快鼓点"></textarea>
      </div>

      <div class="sdg-row sdg-col" id="sdgRefWrap">
        <label class="sdg-lb">参考图</label>
        <div class="sdg-refbox">
          <label class="sdg-ref-add">＋ 添加图片<input type="file" id="sdgRefInput" accept="image/*" multiple hidden></label>
          <div id="sdgRefPreviews" class="sdg-ref-previews"></div>
        </div>
        <span class="note" style="margin:0" id="sdgRefHint">图生视频·首帧：上传 1 张首帧；首尾帧：上传 2 张（先首后尾）；参考图：可多张；文生图(参考)：可选 1 张作为垫图。</span>
      </div>

      <div class="sdg-row sdg-params" id="sdgParams">
        <div id="sdgVidParams">
          <label>时长(s)<input type="number" id="sdgDur" value="5" min="4" max="15"></label>
          <label>分辨率<select id="sdgRes"><option>480p</option><option selected>720p</option><option>1080p</option></select></label>
          <label>比例<select id="sdgRatio"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option><option>21:9</option></select></label>
          <label>帧率<select id="sdgFps"><option selected>24</option><option>30</option></select></label>
          <label class="sdg-chk"><input type="checkbox" id="sdgAudio" checked> 生成音频</label>
        </div>
        <div id="sdgImgParams" style="display:none">
          <label>尺寸<select id="sdgSize"><option>1K</option><option selected>2K</option><option>4K</option></select></label>
          <label>数量<input type="number" id="sdgCount" value="1" min="1" max="4"></label>
          <label class="sdg-chk"><input type="checkbox" id="sdgWatermark"> 加水印</label>
        </div>
      </div>

      <div class="sdg-row">
        <label class="sdg-lb">调用方式</label>
        <div class="seg" id="sdgCall">
          <span class="seg-btn on" data-call="proxy">本地代理(localhost:8788)</span>
          <span class="seg-btn" data-call="direct">浏览器直连(填 ARK Key)</span>
        </div>
      </div>
      <div class="sdg-row sdg-col" id="sdgKeyWrap" style="display:none">
        <label class="sdg-lb">ARK API Key</label>
        <input type="password" id="sdgKey" class="sdg-input" placeholder="volc-sk-xxxxxxxx（仅存本机浏览器 localStorage）" style="max-width:420px">
        <span class="note" style="margin:0">从 火山方舟控制台 获取；仅保存在本机，不上传。注意：方舟 API 大概率有跨域限制，直连可能被浏览器拦截，此时请改用「本地代理」。</span>
      </div>

      <div class="sdg-actions">
        <button class="btn primary" id="sdgGen">🎬 生成</button>
        <button class="btn ghost" id="sdgCancel" style="display:none">取消</button>
        <span id="sdgStatus" class="sdg-status"></span>
      </div>
    </div>

    <div class="card sdg-card" id="sdgResult" style="display:none">
      <h2>生成结果 <span class="tag" id="sdgResultTag"></span></h2>
      <div id="sdgResultBody"></div>
    </div>
  </div>`;

  const vsection = document.getElementById('vparse');
  vsection.insertAdjacentHTML('afterbegin', TOGGLE);
  vsection.insertAdjacentHTML('beforeend', PANEL);

  // ---------------- 元素引用 ----------------
  const modeSeg = $('#sdgMode');
  const typeSeg = $('#sdgType');
  const callSeg = $('#sdgCall');
  const refWrap = $('#sdgRefWrap');
  const refInput = $('#sdgRefInput');
  const refPrev = $('#sdgRefPreviews');
  const vidParams = $('#sdgVidParams');
  const imgParams = $('#sdgImgParams');
  const keyWrap = $('#sdgKeyWrap');
  const promptEl = $('#sdgPrompt');
  const modelEl = $('#sdgModel');
  const statusEl = $('#sdgStatus');
  const genBtn = $('#sdgGen');
  const cancelBtn = $('#sdgCancel');
  const resultCard = $('#sdgResult');
  const resultBody = $('#sdgResultBody');
  const resultTag = $('#sdgResultTag');

  // ---------------- 模式切换 ----------------
  function setMode(mode) {
    state.mode = mode;
    modeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    const cards = vsection.querySelectorAll(':scope > .card');
    if (mode === 'gen') {
      cards.forEach(c => c.style.display = 'none');
      $('#vpGen').style.display = 'block';
    } else {
      cards.forEach(c => c.style.display = '');
      $('#vpGen').style.display = 'none';
    }
  }
  modeSeg.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => setMode(b.dataset.mode));

  // ---------------- 类型切换 ----------------
  function applyTypeUI() {
    const isImg = state.type === 'i2i';
    const isVid = !isImg;
    vidParams.style.display = isVid ? '' : 'none';
    imgParams.style.display = isImg ? '' : 'none';
    // 参考图：文生视频(t2v)不需要；其余都需要
    refWrap.style.display = (state.type === 't2v') ? 'none' : '';
    const hint = {
      'i2v-first': '上传 1 张首帧图片，模型据此生成连贯视频。',
      'i2v-fl': '上传 2 张图片：第 1 张为首帧、第 2 张为尾帧（顺序即播放顺序）。',
      'i2v-ref': '可上传多张参考图（主体/风格/场景），模型综合生成。',
      'i2i': '可选 1 张垫图作为参考（留空则为纯文生图）。'
    }[state.type];
    $('#sdgRefHint').textContent = hint;
    // 模型默认值：切类型时仅在“同族未改”时自动填充，避免覆盖用户自定义
    const cur = modelEl.value.trim();
    const looksCustom = !VID_MODELS.includes(cur) && !IMG_MODELS.includes(cur);
    if (!looksCustom) {
      modelEl.value = isImg ? IMG_MODELS[0] : VID_MODELS[0];
    }
  }
  typeSeg.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
    state.type = b.dataset.type;
    typeSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
    applyTypeUI();
  });

  // ---------------- 调用方式切换 ----------------
  callSeg.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
    state.call = b.dataset.call;
    callSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
    keyWrap.style.display = (state.call === 'direct') ? '' : 'none';
  });

  // ---------------- 参考图 ----------------
  refInput.onchange = () => {
    const files = Array.from(refInput.files || []);
    files.forEach(f => {
      const r = new FileReader();
      r.onload = () => {
        state.refs.push({ name: f.name, dataUrl: r.result });
        renderRefs();
      };
      r.readAsDataURL(f);
    });
    refInput.value = '';
  };
  function renderRefs() {
    refPrev.innerHTML = '';
    state.refs.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'sdg-ref-thumb';
      d.innerHTML = `<img src="${r.dataUrl}"><span class="idx">${i + 1}</span><span class="x" title="移除">×</span>`;
      d.querySelector('.x').onclick = () => { state.refs.splice(i, 1); renderRefs(); };
      refPrev.appendChild(d);
    });
  }

  // ---------------- 构建请求体 ----------------
  function buildPayload() {
    const prompt = promptEl.value.trim();
    const model = modelEl.value.trim();
    const isImg = state.type === 'i2i';
    if (isImg) {
      const p = {
        model,
        prompt,
        size: $('#sdgSize').value,
        response_format: 'url',
        watermark: $('#sdgWatermark').checked,
        sequential_image_generation: 'auto',
        sequential_image_generation_options: { max_images: Math.max(1, Math.min(4, +$('#sdgCount').value || 1)) }
      };
      if (state.refs.length) p.image = state.refs[0].dataUrl; // I2I 垫图
      return { isImg: true, endpoint: '/images/generations', payload: p };
    }
    const content = [{ type: 'text', text: prompt }];
    if (['i2v-first', 'i2v-fl', 'i2v-ref'].includes(state.type)) {
      state.refs.forEach(r => content.push({ type: 'image_url', image_url: { url: r.dataUrl } }));
    }
    const p = {
      model,
      content,
      parameters: {
        duration: Math.max(4, Math.min(15, +$('#sdgDur').value || 5)),
        resolution: $('#sdgRes').value,
        fps: +$('#sdgFps').value || 24,
        ratio: $('#sdgRatio').value,
        generate_audio: $('#sdgAudio').checked
      }
    };
    return { isImg: false, endpoint: '/contents/generations/tasks', payload: p };
  }

  // ---------------- 状态提示 ----------------
  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'sdg-status' + (kind ? ' ' + kind : '');
  }

  // ---------------- 生成主流程 ----------------
  genBtn.onclick = async () => {
    const prompt = promptEl.value.trim();
    if (!prompt) { setStatus('请先填写提示词', 'err'); return; }
    const needsRef = ['i2v-first', 'i2v-fl', 'i2v-ref'].includes(state.type);
    if (needsRef && !state.refs.length) {
      const want = state.type === 'i2v-fl' ? '首尾帧各 1 张' : '至少 1 张参考图';
      setStatus('「' + typeSeg.querySelector('.on').textContent + '」需要' + want, 'err');
      return;
    }
    let key = null;
    if (state.call === 'direct') {
      key = ($('#sdgKey').value.trim() || localStorage.getItem('sdg_ark_key') || '');
      if (!key) { setStatus('请填写 ARK API Key（或改用本地代理）', 'err'); return; }
      localStorage.setItem('sdg_ark_key', key);
    }

    pollAbort = false;
    genBtn.disabled = true;
    cancelBtn.style.display = 'inline-block';
    resultCard.style.display = 'none';
    resultBody.innerHTML = '';

    const { isImg, endpoint, payload } = buildPayload();
    try {
      if (isImg) {
        await genImage(endpoint, payload, key);
      } else {
        const taskId = await createVideo(endpoint, payload, key);
        await pollVideo(taskId, key);
      }
    } catch (e) {
      setStatus('❌ ' + (e.message || e), 'err');
    } finally {
      genBtn.disabled = false;
      cancelBtn.style.display = 'none';
    }
  };

  cancelBtn.onclick = () => { pollAbort = true; setStatus('已请求取消，将在下一轮询点停止…', ''); };

  // 视频：创建任务
  async function createVideo(endpoint, payload, key) {
    setStatus('提交视频生成任务…');
    const res = await callArk('POST', endpoint, payload, key);
    const j = await res.json();
    if (!res.ok) throw new Error('创建失败(' + res.status + ')：' + errText(j));
    if (!j.id) throw new Error('未返回任务 ID：' + errText(j));
    return j.id;
  }

  // 视频：轮询状态
  async function pollVideo(taskId, key) {
    setStatus('生成中…（视频为异步任务，正在轮询，约 1–5 分钟）');
    const deadline = Date.now() + 5 * 60 * 1000;
    let waited = 0;
    while (Date.now() < deadline) {
      if (pollAbort) throw new Error('已取消');
      await sleep(5000);
      waited += 5;
      if (pollAbort) throw new Error('已取消');
      const res = await callArk('GET', '/contents/generations/tasks/' + encodeURIComponent(taskId), null, key);
      const j = await res.json();
      const st = (j && j.status) || 'running';
      if (st === 'succeeded') {
        const url = extractVideoUrl(j);
        if (!url) throw new Error('任务成功但未找到视频 URL：' + errText(j));
        showVideo(url, taskId);
        setStatus('✅ 视频生成完成', 'ok');
        return;
      } else if (st === 'failed') {
        throw new Error('生成失败：' + (j.error || errText(j)));
      } else {
        setStatus('生成中… 状态：' + st + '（已等待 ' + waited + 's）');
      }
    }
    throw new Error('轮询超时（5 分钟）。任务 ID：' + taskId + '，可在火山方舟控制台查看结果。');
  }

  // 图片：同步生成
  async function genImage(endpoint, payload, key) {
    setStatus('生成图片中…');
    const res = await callArk('POST', endpoint, payload, key);
    const j = await res.json();
    if (!res.ok) throw new Error('图片生成失败(' + res.status + ')：' + errText(j));
    const urls = (j.data || []).map(d => d.url).filter(Boolean);
    if (!urls.length) throw new Error('未返回图片 URL：' + errText(j));
    showImages(urls);
    setStatus('✅ 图片生成完成（' + urls.length + ' 张）', 'ok');
  }

  // 统一调用：代理 or 直连
  async function callArk(method, targetPath, bodyObj, key) {
    if (state.call === 'proxy') {
      const url = PROXY + (targetPath.startsWith('/api/') ? targetPath : ('/api' + targetPath));
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (bodyObj) opts.body = JSON.stringify(bodyObj);
      try {
        return await fetch(url, opts);
      } catch (e) {
        throw new Error('无法连接本地代理 ' + PROXY + '。请先运行 start-offline.bat 启动本地服务（看板离线模式）。' + (String(e.message || '').includes('Failed') ? '' : ' ' + e.message));
      }
    } else {
      const url = ARK_BASE + targetPath;
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }
      };
      if (bodyObj) opts.body = JSON.stringify(bodyObj);
      try {
        return await fetch(url, opts);
      } catch (e) {
        // 多为 CORS 拦截
        throw new Error('直连方舟失败（极可能是浏览器跨域 CORS 拦截）。请改用「本地代理(localhost:8788)」模式，或自行配置跨域代理。');
      }
    }
  }

  // 视频 URL 提取（兼容多种返回结构）
  function extractVideoUrl(j) {
    const c = j && j.content;
    if (Array.isArray(c)) {
      for (const it of c) {
        if (it && it.video_url && it.video_url.url) return it.video_url.url;
        if (it && it.type === 'video_url' && it.url) return it.url;
        if (it && it.url && /\.mp4/i.test(it.url)) return it.url;
      }
    }
    if (j && j.video_url && j.video_url.url) return j.video_url.url;
    if (j && j.video_url) return j.video_url;
    return null;
  }

  function errText(j) {
    if (!j) return '';
    if (j.error) return (typeof j.error === 'string') ? j.error : JSON.stringify(j.error);
    return JSON.stringify(j).slice(0, 240);
  }

  // ---------------- 结果展示 ----------------
  function showVideo(url, taskId) {
    resultCard.style.display = 'block';
    resultTag.textContent = '视频 · ' + (modelEl.value.trim());
    resultBody.innerHTML = `
      <div class="sdg-result-grid">
        <div class="sdg-result-item">
          <video src="${url}" controls autoplay muted loop playsinline></video>
          <div class="sdg-result-bar">
            <a class="btn sm primary" href="${url}" target="_blank" download>⬇ 下载视频</a>
            <button class="sdg-copy" data-url="${url}">复制链接</button>
            <span class="rz-tag">task: ${taskId || ''}</span>
          </div>
        </div>
      </div>
      <div class="note">视频直链 24 小时内有效，请及时下载或转存。</div>`;
    bindCopy();
  }
  function showImages(urls) {
    resultCard.style.display = 'block';
    resultTag.textContent = '图片 · ' + (modelEl.value.trim());
    const items = urls.map((u, i) => `
      <div class="sdg-result-item">
        <img src="${u}" alt="生成图${i + 1}">
        <div class="sdg-result-bar">
          <a class="btn sm primary" href="${u}" target="_blank" download>⬇ 下载</a>
          <button class="sdg-copy" data-url="${u}">复制链接</button>
        </div>
      </div>`).join('');
    resultBody.innerHTML = `<div class="sdg-result-grid">${items}</div>
      <div class="note">图片直链 24 小时内有效，请及时下载或转存。</div>`;
    bindCopy();
  }
  function bindCopy() {
    resultBody.querySelectorAll('.sdg-copy').forEach(b => b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.url).then(
        () => { b.textContent = '已复制'; setTimeout(() => b.textContent = '复制链接', 1500); },
        () => { b.textContent = '复制失败'; }
      );
    });
  }

  // ---------------- 初始化 ----------------
  applyTypeUI();
  // 直连模式若已存过 key，回填
  const savedKey = localStorage.getItem('sdg_ark_key');
  if (savedKey) $('#sdgKey').value = savedKey;
})();
