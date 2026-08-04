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
    setTimeout(closeAiModal, 800);
  }
  function clearAiKey() {
    try { localStorage.removeItem(AI_KEY); } catch (e) {}
    const k = document.getElementById('vpAiKey'); if (k) k.value = '';
    const h = document.getElementById('vpAiHint'); if (h) h.textContent = '已清除 Key（服务商 / Base 配置保留）';
  }
