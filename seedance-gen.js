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
    'doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128'
  ];
  const IMG_MODELS = [
    'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828',
    'doubao-seedream-5-0-lite-260128'
  ];

  // ---------------- 硅基流动 SiliconFlow（免费/低成本通道） ----------------
  const SF_IMG_MODELS = [
    'black-forest-labs/FLUX.1-schnell', 'Kwai-Kolors/Kolors',
    'black-forest-labs/FLUX.1-dev'
  ];
  const SF_VID_MODELS = [
    'Wan-AI/Wan2.2-T2V-A14B', 'Wan-AI/Wan2.2-I2V-A14B',
    'Wan-AI/Wan2.1-T2V-14B-720P'
  ];
  const SF_IMG_SIZES = ['1024x1024', '768x1344', '1344x768'];
  function sfVideoSize(ratio) {
    return ({ '16:9': '1280x720', '9:16': '720x1280', '1:1': '960x960' })[ratio] || '1280x720';
  }
  // 各通道的「生成类型」选项
  const TYPE_OPTS = {
    ark: [
      { t: 't2v', label: '文生视频' },
      { t: 'i2v-first', label: '图生视频·首帧' },
      { t: 'i2v-fl', label: '图生视频·首尾帧' },
      { t: 'i2v-ref', label: '图生视频·参考图' },
      { t: 'i2i', label: '文生图(Seedream)' }
    ],
    sf: [
      { t: 'sf-i2i', label: '文生图(FLUX/Kolors)' },
      { t: 'sf-t2v', label: '文生视频(Wan)' },
      { t: 'sf-i2v', label: '图生视频(Wan)' }
    ]
  };

  // ---------------- 预估费用（火山方舟视频，付费） ----------------
  // 单价（Seedance 2.0-mini 折后价）：不含视频输入 9.2 元/百万tokens；含视频输入 5.6 元/百万tokens
  // Token 估算 ≈ (输入时长+输出时长) × 宽 × 高 × 帧率 / 1024
  function estimateArkCost() {
    const res = $('#sdgRes').value;
    const dur = Math.max(4, Math.min(15, +$('#sdgDur').value || 5));
    const fps = +$('#sdgFps').value || 24;
    const hasVideoIn = ['i2v-first', 'i2v-fl', 'i2v-ref'].includes(state.type);
    const dim = ({ '480p': [848, 480], '720p': [1280, 720], '1080p': [1920, 1080] })[res] || [1280, 720];
    const outTokens = (dur * dim[0] * dim[1] * fps) / 1024;
    const inTokens = hasVideoIn ? outTokens : 0;
    const totalTokens = Math.ceil(inTokens + outTokens);
    const unit = hasVideoIn ? 5.6 : 9.2; // mini 版折后价
    return { totalTokens, cost: (totalTokens / 1e6) * unit, hasVideoIn, unit };
  }
  function updateCost() {
    const box = $('#sdgCost');
    if (state.provider !== 'ark' || state.type === 'i2i') { box.style.display = 'none'; return; }
    const c = estimateArkCost();
    box.style.display = '';
    box.innerHTML = `💰 预估费用（方舟 mini）：<b>${c.totalTokens.toLocaleString()} tokens ≈ ¥${c.cost.toFixed(3)}</b> ` +
      `<span class="note" style="margin:0">（${c.hasVideoIn ? '含视频输入 5.6' : '纯文/图输入 9.2'} 元/百万tokens，mini 版折后价；超免费额度自动暂停）</span>`;
  }

  // ---------------- 爆款范本库（对齐 爆款 DNA：形式/钩子/卖点/CTA/画面） ----------------
  const TEMPLATES = [
    { id: 'koubo', name: '口播种草', form: '口播',
      desc: '真人/第一人称视角，3秒钩子→卖点递进→引导转化',
      build: s => `第一人称真人出镜视角，${P(s.product)}种草短视频，电影感写实广告质感。开头3秒用「${s.hook || '直击痛点 / 引发好奇'}」强钩子抓住注意力；中段贴近产品特写，自然展示${P(s.product)}的${P(s.sellpoint)}，穿插${SC(s)}使用画面；结尾给出明确行动指引（${s.cta || '点击了解详情 / 下单'}）。${ST(s)}，运镜：缓慢推近 + 轻微手持晃动增强真实感，节奏明快卡点，适配${DUR(s)}秒、9:16 竖屏短视频。` },
    { id: 'pain', name: '痛点反转', form: '口播/剧情',
      desc: '开场焦虑痛点→反转解决，情绪对比强',
      build: s => `剧情向短视频：开场呈现${s.audience || '用户'}在${SC(s)}中遭遇的尴尬 / 焦虑痛点（画面压抑、冷色调），随即反转——使用${P(s.product)}后问题解决、情绪转为轻松愉悦（画面变暖变亮）。突出${P(s.sellpoint)}带来的改变，结尾${s.cta || '引导尝试'}。${ST(s)}，运镜：从固定远景切到产品特写再拉回人物表情，情绪对比强烈，适配${DUR(s)}秒、9:16。` },
    { id: 'compare', name: '对比测评', form: '混剪',
      desc: '使用前 vs 使用后强烈对比',
      build: s => `左右分屏对比短视频：左侧「使用前」灰暗、杂乱、低效；右侧「使用后」${P(s.product)}带来${P(s.sellpoint)}，明亮通透、秩序感强。中间用箭头 / 光效过渡强调差异，节奏紧凑。${ST(s)}，运镜：横向平移扫过对比、产品居中高光，适配${DUR(s)}秒、9:16 或 1:1。` },
    { id: 'scene', name: '场景代入', form: '剧情/口播',
      desc: '生活化沉浸，像朋友分享好物',
      build: s => `生活化沉浸式短视频：在${SC(s)}中自然使用${P(s.product)}，无生硬口播感，像朋友分享好物。镜头跟随人物动线，捕捉${P(s.sellpoint)}的真实细节与微表情。${ST(s)}，运镜：手持跟拍 + 偶尔特写，自然光，节奏舒缓可信，适配${DUR(s)}秒、9:16。` },
    { id: 'story', name: '剧情种草', form: '剧情',
      desc: '微剧情，产品作为关键道具登场',
      build: s => `微剧情短视频：${s.audience || '主角'}在${SC(s)}遇到小状况，恰巧${P(s.product)}作为关键道具登场化解窘境，顺势带出${P(s.sellpoint)}。轻喜剧基调，结尾${s.cta || '自然露出品牌'}。${ST(s)}，运镜：过肩 + 中近景切换，节奏轻快，适配${DUR(s)}秒、9:16。` },
    { id: 'tutorial', name: '教程演示', form: '口播/混剪',
      desc: '分步骤演示用法与效果',
      build: s => `步骤演示类短视频：以清晰字幕 / 画外音分步骤展示${P(s.product)}的用法与${P(s.sellpoint)}效果，镜头对准双手操作与成果特写。${ST(s)}，运镜：俯拍 + 特写切换，节奏稳定不拖沓，适配${DUR(s)}秒、9:16 或 1:1。` }
  ];
  // 槽位缺省兜底
  function P(v) { return (v && v.trim()) ? v.trim() : '产品'; }
  function SC(s) { return (s.scene && s.scene.trim()) ? s.scene.trim() : '日常场景'; }
  function ST(s) { return (s.style && s.style.trim()) ? s.style.trim() + '风格' : '明亮清新、生活化广告风格'; }
  function DUR(s) { const d = parseInt(s.dur, 10); return (d >= 4 && d <= 15) ? d : 5; }

  // 导入的爆款拆解 JSON → 提示词（对接 material-decompose-loop 的「可复制方向」字段）
  function composeImported(d) {
    const prod = d.产品 || d.product || d.素材名 || d.素材ID || '产品';
    const parts = [`基于爆款可复制方向生成「${prod}」短视频：`];
    const pick = (...ks) => ks.map(k => d[k]).find(v => v != null && String(v).trim());
    const dir = pick('可复制方向', 'dir', '方向');
    const sell = pick('核心卖点', 'sellpoint', '卖点');
    const hook = pick('钩子', '开头3秒', 'hook');
    const shots = pick('画面分镜', '分镜', 'shots');
    const script = pick('口播脚本', '脚本', 'script');
    if (dir) parts.push(String(dir));
    if (sell) parts.push('核心卖点：' + sell);
    if (hook) parts.push('开头钩子：' + hook);
    if (shots) parts.push('画面分镜：' + shots);
    if (script) parts.push('口播基调：' + script);
    const dd = parseInt(pick('时长', '时长秒') || '5', 10);
    parts.push('电影感写实广告质感，运镜贴合内容节奏，适配' + (dd >= 4 && dd <= 15 ? dd : 5) + '秒、9:16 竖屏。');
    return parts.join('。');
  }

  const state = {
    mode: 'parse',     // parse | gen
    provider: 'ark',   // ark | sf
    type: 't2v',       // ark: t2v|i2v-first|i2v-fl|i2v-ref|i2i ; sf: sf-i2i|sf-t2v|sf-i2v
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
  .sdg-tpl-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .sdg-tpl-chips{display:flex;gap:8px;flex-wrap:wrap}
  .sdg-tpl-chips .chip{cursor:pointer;border:1px solid var(--line);border-radius:999px;padding:6px 13px;
    font-size:13px;color:var(--ink);background:var(--panel);white-space:nowrap}
  .sdg-tpl-chips .chip:hover{border-color:var(--brand);color:var(--brand)}
  .sdg-tpl-chips .chip.on{background:var(--brand);color:#fff;border-color:var(--brand)}
  .sdg-tb{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:2px}
  .sdg-tpl-slots{margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--panel)}
  .sdg-tpl-slotgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
  .sdg-tpl-slotgrid .sdg-input{min-width:0;max-width:none}
  .sdg-tpl-slotgrid .sdg-input.full{grid-column:1/-1}
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
        <label class="sdg-lb">生成通道</label>
        <div class="seg" id="sdgProvider">
          <span class="seg-btn on" data-provider="ark">🔥 火山方舟 (Seedance/Seedream)</span>
          <span class="seg-btn" data-provider="sf">🆓 硅基流动 免费</span>
        </div>
        <span class="note" id="sdgProviderNote" style="margin:0;flex-basis:100%"></span>
      </div>

      <div class="sdg-row">
        <label class="sdg-lb">生成类型</label>
        <div class="seg" id="sdgType"></div>
      </div>

      <div class="sdg-row">
        <label class="sdg-lb">模型</label>
        <input list="sdgModels" id="sdgModel" class="sdg-input" style="max-width:420px">
        <datalist id="sdgModels"></datalist>
        <span class="note" id="sdgModelNote" style="margin:0;flex-basis:100%"></span>
      </div>

      <div class="sdg-row" id="sdgCost" style="display:none"></div>

      <div class="sdg-row sdg-col" style="border-top:1px dashed var(--line);padding-top:14px">
        <label class="sdg-lb">📚 爆款范本</label>
        <div class="sdg-tb">
          <div id="sdgTplChips" class="sdg-tpl-chips" title="内置 6 类爆款结构，点选后填槽位一键生成提示词"></div>
          <label class="sdg-ref-add" style="margin-left:auto">＋ 导入爆款拆解 JSON<input type="file" id="sdgTplImport" accept=".json,application/json" hidden></label>
        </div>
        <div id="sdgTplSlots" class="sdg-tpl-slots" style="display:none">
          <div class="sdg-tpl-slotgrid">
            <input class="sdg-input" id="sdgTplProduct" placeholder="产品名（如 果茶 / 扫地机）">
            <input class="sdg-input" id="sdgTplSell" placeholder="核心卖点（如 0糖0卡）">
            <input class="sdg-input" id="sdgTplAud" placeholder="目标人群（选填）">
            <input class="sdg-input" id="sdgTplScene" placeholder="使用场景（选填）">
            <input class="sdg-input" id="sdgTplStyle" placeholder="风格基调（选填，如 电影感/清新）">
            <input class="sdg-input" id="sdgTplHook" placeholder="开头钩子（选填）">
            <input class="sdg-input" id="sdgTplCta" placeholder="结尾 CTA（选填）">
            <input class="sdg-input" id="sdgTplDur" placeholder="时长秒（选填·默认5）" style="max-width:130px">
          </div>
          <div class="sdg-actions">
            <button class="btn primary" id="sdgTplApply">✨ 套用范本生成提示词</button>
            <span class="note" id="sdgTplActive" style="margin:0"></span>
          </div>
        </div>
        <div id="sdgImportedChips" class="sdg-tpl-chips" style="margin-top:10px"></div>
        <span class="note" style="margin:0">内置爆款结构库一键成稿；或「导入爆款拆解 JSON」（来自素材拆解看板的「可复制方向」），点条目即按真实爆款 DNA 生成提示词。</span>
      </div>

      <div class="sdg-row sdg-col">
        <label class="sdg-lb">提示词 (Prompt)</label>
        <textarea id="sdgPrompt" rows="4" class="sdg-input" placeholder="例如：第一人称视角果茶宣传广告，手摘下带晨露的红苹果，雪克杯摇匀加冰，分层果茶倒入透明杯，粉色包装贴标，卡点轻快鼓点。 👆 也可从上方「爆款范本」一键生成"></textarea>
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
          <span class="note" style="margin:0;flex-basis:100%">⚠️ 图片默认 <b>Seedream 4.5</b>（已开通，要求尺寸 ≥ 2K）。视频默认 <b>Seedance 2.0-mini</b>（已开通，折后价约 ¥0.005/千tokens）。</span>
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
        <input type="password" id="sdgKey" class="sdg-input" placeholder="ark-xxxxxxxx（仅存本机浏览器 localStorage）" style="max-width:420px">
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
  const providerSeg = $('#sdgProvider');
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

  // 爆款范本 元素
  const tplChips = $('#sdgTplChips');
  const tplSlots = $('#sdgTplSlots');
  const tplActive = $('#sdgTplActive');
  const tplApply = $('#sdgTplApply');
  const tplImport = $('#sdgTplImport');
  const importedChips = $('#sdgImportedChips');
  const tplProduct = $('#sdgTplProduct');
  const tplSell = $('#sdgTplSell');
  const tplAud = $('#sdgTplAud');
  const tplScene = $('#sdgTplScene');
  const tplStyle = $('#sdgTplStyle');
  const tplHook = $('#sdgTplHook');
  const tplCta = $('#sdgTplCta');
  const tplDur = $('#sdgTplDur');
  let activeTpl = null;

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

  // ---------------- 通道 / 类型 / 模型 动态渲染 ----------------
  function renderTypeSeg() {
    const opts = TYPE_OPTS[state.provider];
    typeSeg.innerHTML = opts.map(o =>
      `<span class="seg-btn${o.t === state.type ? ' on' : ''}" data-type="${o.t}">${o.label}</span>`).join('');
    typeSeg.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
      state.type = b.dataset.type;
      typeSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
      applyTypeUI();
    });
  }

  function renderModels() {
    const isSf = state.provider === 'sf';
    const isImg = (state.type === 'i2i') || (state.type === 'sf-i2i');
    let models, def;
    if (isSf) {
      models = isImg ? SF_IMG_MODELS : SF_VID_MODELS;
    } else {
      models = isImg ? IMG_MODELS : VID_MODELS;
    }
    def = models[0];
    $('#sdgModels').innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    modelEl.value = def;
    $('#sdgModelNote').textContent = isSf
      ? (isImg ? '硅基流动图片：FLUX.1-schnell 为免费档，Kolors 高质量。'
               : '硅基流动视频：Wan2.2 系列（消耗免费 tokens）。')
      : (isImg ? '切到「文生图」用 Seedream。' : '视频默认 Seedance 2.0，可手动改。');
  }

  function applyProviderUI() {
    const isSf = state.provider === 'sf';
    callSeg.parentElement.style.display = isSf ? 'none' : '';
    keyWrap.style.display = (isSf || state.call !== 'direct') ? 'none' : '';
    $('#sdgProviderNote').innerHTML = isSf
      ? '🆓 硅基流动：新用户送 <b>2000 万永久免费 tokens</b> + 16 元代金券。图片 FLUX/Kolors、视频 Wan2.2。经本地代理调用（需在 .env 配置 SILICONFLOW_API_KEY 并运行 start-offline.bat）。'
      : '🔥 火山方舟：视频/图片付费（新用户每模型 50 万免费 tokens）。视频异步、图片同步。';
    // 重置为该通道首个类型，避免类型越界
    if (!TYPE_OPTS[state.provider].some(o => o.t === state.type)) {
      state.type = TYPE_OPTS[state.provider][0].t;
    }
    renderTypeSeg();
    applyTypeUI();
  }

  // ---------------- 类型切换（UI 联动） ----------------
  function applyTypeUI() {
    const isImg = (state.type === 'i2i') || (state.type === 'sf-i2i');
    const isVid = !isImg;
    vidParams.style.display = isVid ? '' : 'none';
    imgParams.style.display = isImg ? '' : 'none';
    // 参考图：纯文生（ark t2v / sf t2v）不需要；其余需要
    refWrap.style.display = (state.type === 't2v' || state.type === 'sf-t2v') ? 'none' : '';
    const hints = {
      'i2v-first': '上传 1 张首帧图片，模型据此生成连贯视频。',
      'i2v-fl': '上传 2 张图片：第 1 张为首帧、第 2 张为尾帧（顺序即播放顺序）。',
      'i2v-ref': '可上传多张参考图（主体/风格/场景），模型综合生成。',
      'i2i': '可选 1 张垫图作为参考（留空则为纯文生图）。',
      'sf-i2v': '上传 1 张首帧图片（Wan 图生视频）。',
      'sf-i2i': '可选 1 张垫图作为参考（留空则为纯文生图）。'
    };
    $('#sdgRefHint').textContent = hints[state.type] || '';
    renderModels();
    updateCost();
  }

  // 通道切换
  providerSeg.querySelectorAll('.seg-btn').forEach(b => b.onclick = () => {
    state.provider = b.dataset.provider;
    providerSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x === b));
    applyProviderUI();
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
    const needsRef = ['i2v-first', 'i2v-fl', 'i2v-ref'].includes(state.type) || state.type === 'sf-i2v';
    if (needsRef && !state.refs.length) {
      const want = (state.type === 'i2v-fl') ? '首尾帧各 1 张' : '至少 1 张参考图';
      setStatus('「' + (typeSeg.querySelector('.on') || {}).textContent + '」需要' + want, 'err');
      return;
    }

    pollAbort = false;
    genBtn.disabled = true;
    cancelBtn.style.display = 'inline-block';
    resultCard.style.display = 'none';
    resultBody.innerHTML = '';

    try {
      if (state.provider === 'sf') {
        await genSf();
      } else {
        let key = null;
        if (state.call === 'direct') {
          key = ($('#sdgKey').value.trim() || localStorage.getItem('sdg_ark_key') || '');
          if (!key) { setStatus('请填写 ARK API Key（或改用本地代理）', 'err'); return; }
          localStorage.setItem('sdg_ark_key', key);
        }
        const { isImg, endpoint, payload } = buildPayload();
        if (isImg) {
          await genImage(endpoint, payload, key);
        } else {
          const taskId = await createVideo(endpoint, payload, key);
          await pollVideo(taskId, key);
        }
      }
    } catch (e) {
      setStatus('❌ ' + (e.message || e), 'err');
    } finally {
      genBtn.disabled = false;
      cancelBtn.style.display = 'none';
    }
  };

  // ---------------- 硅基流动 SiliconFlow 生成流程 ----------------
  async function genSf() {
    const prompt = promptEl.value.trim();
    const model = modelEl.value.trim();
    if (state.type === 'sf-i2i') {
      const p = {
        model,
        prompt,
        image_size: SF_IMG_SIZES[0],
        batch_size: Math.max(1, Math.min(4, +$('#sdgCount').value || 1)),
        num_inference_steps: 20,
        guidance_scale: 7.5
      };
      if (state.refs.length) p.image = state.refs[0].dataUrl;
      await genSfImage(p);
    } else {
      const isI2v = state.type === 'sf-i2v';
      const p = {
        model,
        prompt,
        image_size: sfVideoSize($('#sdgRatio').value),
        negative_prompt: ''
      };
      if (isI2v) p.image = state.refs[0].dataUrl;
      const rid = await submitSfVideo(p);
      await pollSfVideo(rid);
    }
  }
  async function genSfImage(payload) {
    setStatus('硅基流动生成图片中…（免费额度）');
    const res = await fetch(PROXY + '/api/sf/image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const j = await res.json();
    if (!res.ok) throw new Error('图片生成失败(' + res.status + ')：' + errText(j));
    const urls = (j.data || []).map(d => d.url).filter(Boolean);
    if (!urls.length) throw new Error('未返回图片 URL：' + errText(j));
    showImages(urls);
    setStatus('✅ 硅基流动图片生成完成（' + urls.length + ' 张，免费额度）', 'ok');
  }
  async function submitSfVideo(payload) {
    setStatus('硅基流动提交视频任务…');
    const res = await fetch(PROXY + '/api/sf/video', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const j = await res.json();
    if (!res.ok) throw new Error('提交失败(' + res.status + ')：' + errText(j));
    if (!j.requestId) throw new Error('未返回 requestId：' + errText(j));
    return j.requestId;
  }
  async function pollSfVideo(requestId) {
    setStatus('硅基流动生成中…（异步任务，约 1–5 分钟）');
    const deadline = Date.now() + 6 * 60 * 1000;
    let waited = 0;
    while (Date.now() < deadline) {
      if (pollAbort) throw new Error('已取消');
      await sleep(6000);
      waited += 6;
      if (pollAbort) throw new Error('已取消');
      const res = await fetch(PROXY + '/api/sf/video/status/' + encodeURIComponent(requestId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      });
      const j = await res.json();
      const st = (j && (j.status || (j.data && j.data.status))) || 'Processing';
      if (/succeed|success|完成|succeeded/i.test(st)) {
        const url = extractSfVideoUrl(j);
        if (!url) throw new Error('任务成功但未找到视频 URL：' + errText(j));
        showVideo(url, requestId);
        setStatus('✅ 硅基流动视频生成完成（免费额度）', 'ok');
        return;
      } else if (/fail|error|failed/i.test(st)) {
        throw new Error('生成失败：' + errText(j));
      } else {
        setStatus('生成中… 状态：' + st + '（已等待 ' + waited + 's）');
      }
    }
    throw new Error('轮询超时（6 分钟）。requestId：' + requestId);
  }
  function extractSfVideoUrl(j) {
    const c = (j && j.data) ? j.data : j;
    if (c && c.results && c.results.videos && c.results.videos[0]) {
      const v = c.results.videos[0]; return v.url || v.video_url || null;
    }
    if (c && Array.isArray(c.videos) && c.videos[0]) {
      const v = c.videos[0]; return v.url || v.video_url || null;
    }
    if (j && j.video && j.video.url) return j.video.url;
    if (j && j.url) return j.url;
    return null;
  }

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

  // ---------------- 爆款范本 逻辑 ----------------
  function renderTplChips() {
    tplChips.innerHTML = '';
    TEMPLATES.forEach(t => {
      const c = document.createElement('div');
      c.className = 'chip';
      c.dataset.id = t.id;
      c.textContent = t.name;
      c.title = t.desc;
      c.onclick = () => selectTpl(t.id);
      tplChips.appendChild(c);
    });
  }
  function selectTpl(id) {
    activeTpl = TEMPLATES.find(t => t.id === id);
    tplChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.id === id));
    importedChips.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
    tplSlots.style.display = 'block';
    tplActive.textContent = '当前范本：' + activeTpl.name + '（' + activeTpl.form + '）';
  }
  function fillPrompt(text) {
    promptEl.value = text;
    // 范本均为视频向，确保生成类型=文生视频，与提示词一致（按当前通道选类型）
    const wantType = state.provider === 'sf' ? 'sf-t2v' : 't2v';
    if (state.type !== wantType) {
      state.type = wantType;
      typeSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('on', x.dataset.type === wantType));
      applyTypeUI();
    }
    promptEl.focus();
    promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  tplApply.onclick = () => {
    if (!activeTpl) { setStatus('请先点选一个爆款范本', 'err'); return; }
    const s = {
      product: tplProduct.value, sellpoint: tplSell.value, audience: tplAud.value,
      scene: tplScene.value, style: tplStyle.value, hook: tplHook.value,
      cta: tplCta.value, dur: tplDur.value
    };
    fillPrompt(activeTpl.build(s));
    setStatus('✅ 已套用「' + activeTpl.name + '」范本生成提示词，可直接调整或点 🎬 生成', 'ok');
  };
  tplImport.onchange = () => {
    const f = tplImport.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const arr = Array.isArray(data) ? data
          : (data.viral || data.爆款 || data.list || data.可复制方向 || []);
        if (!arr.length) { setStatus('JSON 里没找到爆款条目（期望数组或含 viral/list/可复制方向 字段）', 'err'); return; }
        importedChips.innerHTML = '';
        arr.forEach((d, i) => {
          const name = d.产品 || d.product || d.素材名 || d.素材ID || ('爆款范本' + (i + 1));
          const c = document.createElement('div');
          c.className = 'chip';
          c.textContent = name;
          c.title = '点击按此爆款可复制方向生成提示词';
          c.onclick = () => {
            importedChips.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
            c.classList.add('on');
            tplChips.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
            tplSlots.style.display = 'none';
            fillPrompt(composeImported(d));
            setStatus('✅ 已套用导入的「' + name + '」可复制方向生成提示词', 'ok');
          };
          importedChips.appendChild(c);
        });
        setStatus('✅ 已导入 ' + arr.length + ' 条爆款范本，点击即可生成提示词', 'ok');
      } catch (e) { setStatus('JSON 解析失败：' + e.message, 'err'); }
    };
    r.readAsText(f);
    tplImport.value = '';
  };

  // ---------------- 初始化 ----------------
  applyProviderUI();     // 渲染通道/类型/模型/参数/费用
  renderTplChips();
  // 参数变动时实时刷新预估费用
  ['sdgDur', 'sdgRes', 'sdgRatio', 'sdgFps'].forEach(id => {
    const el = $('#' + id); if (el) el.addEventListener('change', updateCost);
  });
  // 直连模式若已存过 key，回填
  const savedKey = localStorage.getItem('sdg_ark_key');
  if (savedKey) $('#sdgKey').value = savedKey;
})();
