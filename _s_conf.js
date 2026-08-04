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
