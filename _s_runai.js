  async function vpRunAI() {
    const conf = aiConfGet();
    if (!conf.key) { openAiModal(); return; }
    const pName = (AI_PROVIDERS[conf.provider] || {}).label || conf.provider;
    showCard('vpAi');
    const out = document.getElementById('vpAiOut');
    if (out) out.innerHTML = '<div class="muted">正在调用 ' + escapeHtml(pName) + ' 分析关键帧…</div>';
    try {
      const frames = (VP.frames || []).filter(f => f.dataURL);
      if (!frames.length) { if (out) out.innerHTML = '<div class="vp-warn">请先抽帧（点「重新抽帧」）再拆解。</div>'; return; }
      const step = Math.max(1, Math.ceil(frames.length / 6));
      const pick = frames.filter((_, i) => i % step === 0).slice(0, 6);
      let promptText = AI_PROMPT;
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
      const content = [{ type: 'text', text: promptText }];
      // 仅视觉模型才附带截帧图片；纯文本模型（如 deepseek-chat）只发文字，避免报错
      if (conf.vision) pick.forEach(f => content.push({ type: 'image_url', image_url: { url: f.dataURL } }));
      const ep = conf.base.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.key },
        body: JSON.stringify({ model: conf.model, messages: [{ role: 'user', content }], temperature: 0.6, max_tokens: 1024 })
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
      VP.ai = ai;
      renderAi(ai, txt);
      applyAiToParse(ai);
    } catch (e) {
      if (out) out.innerHTML = '<div class="vp-warn">AI 拆解失败：' + escapeHtml(e.message) +
        '<br><span class="muted">请检查 Key / Base URL / 模型是否正确，且浏览器能直连该服务（部分服务需经后端代理才能避免跨域 CORS）。</span></div>';
    }
  }
