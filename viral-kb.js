/* ============================================================
 * viral-kb.js — 零 Key 爆款结构反推 · 同品类复刻引擎
 * 依赖：全局 VP（index.html 定义）、抽帧实测 VP.analysis、深度分析 VP.deep、报表 VP.mat
 * 设计：纯前端、无 API Key、可离线；把「真实已发布爆款」实证知识固化为规则引擎。
 * 与 vparse-deep.js 的「🚀一键复刻（需 AI Key）」互补：本文件不依赖任何联网/Key。
 * 知识来源：巨量千川 200+ 跑量视频实证 + 5 套真实拼接模板 + 同品类裂变矩阵
 * ============================================================ */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtSec(s) { return (s == null || isNaN(s)) ? '0s' : (+s).toFixed(1) + 's'; }
  function kwHit(text, kws) {
    if (!text) return null;
    for (const k of kws) if (text.indexOf(k) >= 0) return k;
    return null;
  }
  function row(k, v) { return '<tr><td class="vp-k">' + esc(k) + '</td><td>' + (v === '' || v == null ? '<span class="muted">—</span>' : v) + '</td></tr>'; }

  /* ---------- 知识库：真实已发布爆款的实证规则 ---------- */
  const KB = {
    empirical: {
      label: '巨量千川 200+ 跑量视频实证',
      durUnder20Pct: 67, avgDur: 17.4,
      front3: { productShow: 53, personShow: 44, talkProduct: 77 },
      noPricePct: 89, personShowPct: 82,
      form: { mix: 39, solo: 25, oneshot: 26 },
      formBest: '原生混剪（真人演示 + 开箱 + 产品特写 + 证言）',
      rhythm: { shotLen: '1-2s', frontConflict: '高冲突画面放前 0.5s', ctaMin: 3, bgm: '20-30%' }
    },
    // 6 类钩子 + 关键词命中规则
    hookTypes: ['痛点直击', '反常识', '提问悬念', '结果前置', '警示劝退', '强画面视觉'],
    hooksKw: {
      '提问悬念': ['？', '吗', '怎么', '为什么', '什么', '如何'],
      '警示劝退': ['千万别', '别用', '停止', '不要', '当心', '避开'],
      '结果前置': ['元', '￥', '¥', '分钱', '免费', '薅', '到手', '低价', '便宜', '0.0', '福利价'],
      '反常识': ['没想到', '居然', '竟然', '反常识', '万万', '殊不知', '以为'],
      '痛点直击': ['烦', '累', '丑', '难', '崩', '烂', '土', '廉价', '假', '坑', '糟']
    },
    // 5 套真实拼接模板（按秒级顺序，来自真实跑量视频归纳）
    spliceTemplates: {
      A: '带货好物：钩子→产品特写→使用演示B-roll→效果真人→对比收尾+CTA',
      B: '前后对比/蜕变：最强效果画面→场景证据→卖点3短词→反差收尾+CTA',
      C: '信任转化：钩子→权威背书+原相机对比→限时/0风险逼单',
      D: '反转剧情：视觉冲击→制造尴尬→转折→那句台词引爆→CTA',
      E: '口播+B-roll混剪：黄金3秒→B-roll匹配口播→价值输出（可只换BGM/开头裂变多条）'
    },
    rhythmRules: '单镜头 1–2s；高冲突画面放前 0.5s；CTA 至少 3 次（第 5s / 15s / 结尾）；BGM 压到 20–30%；分镜分层（主打→花絮→共创梗）做"嫁接"而非堆砌。',
    // 同品类裂变矩阵：钩子 × 人设 × 场景 笛卡尔积可裂变成几十条
    sameCatMatrix: {
      hooks: ['价格福利', '场景痛点', '反转翻车', '测评开箱'],
      persons: ['女主种草', '男主户外', '学生党', '测评博主', '宝妈'],
      scenes: ['床头追剧', '直播', '车载', '厨房', '办公桌']
    },
    // 同品类复刻 6 套变体（骨架不变，只换钩子/人设/场景/剪辑）
    sameCatSets: [
      {
        title: 'A · 原结构翻拍版', diff: '骨架 1:1 复刻，只换真人 + 换背景，用来验证品类跑量模型可复制。',
        shots: {
          '钩子': '真人出镜中景：同款福利贴纸满屏（秒杀/热卖/推荐），第一眼即"有福利"。',
          '开箱/产品亮相': '手部特写拆气泡膜快递盒，弹出"1分钱薅到的[品类]"价格贴。',
          '功能证明': '桌面特写：产品材质/旋转/承重，字幕"全金属结实耐用 · 手机平板都能用"。',
          '场景+CTA': '使用演示：产品入架，红色箭头指向下方链接，口播"点视频下方链接抢"。',
          '换人设证言': '户外第二人设口播："[平台]1分钱包邮，真实有效"。',
          '品牌尾板': '红底品牌尾板 slogan（如"又好又便宜"）。'
        },
        script: '（0-3s）[平台]这波福利我先冲——1分钱包邮的[品类]，全金属的，手机平板都能架。（8-17s）材质/旋转/承重看完你就懂为啥值。（17-21s）想要的宝子赶紧点下方链接！',
        jimeng: [
          '特写一双手拆开白色快递气泡膜，露出银色金属[品类]，柔和室内光，9:16，高清产品广告质感',
          '图生视频：镜头缓慢环绕[品类]，展示360度旋转底座和加厚金属杆，背景虚化，9:16'
        ]
      },
      {
        title: 'B · 场景痛点型', diff: '钩子不打价格，先打"手举酸/支架晃"，价格作为解决方案在后段抛。',
        shots: {
          '钩子': '真人痛点：躺着举手机手酸、手机晃动，字幕"每天举手机到手酸？"。',
          '开箱/产品亮相': '从床头柜拿出金属支架卡进床沿，字幕"直到我发现这个1分钱的[品类]"。',
          '功能证明': '场景特写：稳稳夹床头、横竖屏切换、追剧不晃，字幕"全金属不晃·横竖都能夹"。',
          '场景+CTA': '女生躺好追剧手指下方："1分钱包邮，点链接抢"。',
          '换人设证言': '户外人设："活动真实，数量有限"。',
          '品牌尾板': '红底品牌尾板。'
        },
        script: '（0-3s）天天举手机追剧手都酸了？（8-17s）直到我花1分钱薅了这个全金属[品类]，夹床头横竖都能用，追剧彻底解放双手。（17-21s）链接我放下面了！',
        jimeng: [
          '女生躺在床上手持手机表情疲惫手机轻微晃动，暖色床头灯，9:16，生活化纪实风',
          '图生视频：银色金属床头支架夹在木床沿，手机稳立播放视频，镜头轻推近，9:16'
        ]
      },
      {
        title: 'C · 反转翻车型', diff: '用"翻车"制造强冲突，比价格钩子更抓眼球；适合和 A 做钩子 A/B 测。',
        shots: {
          '钩子': '冲突慢动作：手机从劣质支架滑落摔地（慢放），字幕"千万别用这种支架！"。',
          '开箱/产品亮相': '拆包裹拿出金属支架："[平台]1分钱薅的，真不一样"。',
          '功能证明': '加厚重底座、360°旋转阻尼、放平板压上去也不倒，字幕"稳如泰山·手机平板通用"。',
          '场景+CTA': '女生躺着追剧支架稳稳："现在1分钱包邮，点下方链接"。',
          '换人设证言': '户外人设："活动真实，数量有限"。',
          '品牌尾板': '红底品牌尾板。'
        },
        script: '（0-3s）别再用那种几块钱一摔就烂的支架了！（8-17s）我在[平台]1分钱包邮薅的这个全金属，360度旋转还稳如泰山。（17-21s）最后这点库存，点链接抢！',
        jimeng: [
          '慢动作：手机从白色塑料支架滑落摔在木地板，戏剧化定格，9:16，广告冲突感',
          '图生视频：银色金属支架承受平板按压测试纹丝不动，镜头环绕展示加厚底座，9:16'
        ]
      },
      {
        title: 'D · 人群人设型（学生党/打工人）', diff: '人设换成学生/打工人，口播更接地气，"宿舍神器/打工人的快乐"话术。',
        shots: {
          '钩子': '真人出镜比"省钱"手势："大学生必薅！1分钱的宿舍神器"。',
          '开箱/产品亮相': '拆快递盒[品类]亮相："[平台]1分钱包邮，真没骗我"。',
          '功能证明': '桌面特写：架手机看网课、横屏打游戏不挡手、金属质感，字幕"看课打游戏都香·全金属耐造"。',
          '场景+CTA': '手指下方链接："点链接，1分钱搬回家"。',
          '换人设证言': '同学出镜："真的才1分钱，我也抢了"。',
          '品牌尾板': '红底品牌尾板。'
        },
        script: '（0-3s）大学生听我一句劝，[平台]这个1分钱包邮的[品类]赶紧薅。（8-17s）全金属看网课打游戏都好使。（17-21s）舍友已经抢了三单，链接在下面！',
        jimeng: [
          '大学生宿舍书桌，男生手持银色金属[品类]对镜头说话，阳光从窗入，9:16，青春生活感',
          '图生视频：手机支架立大学宿舍桌，手机横屏显游戏画面，背景书本台灯，9:16'
        ]
      },
      {
        title: 'E · 测评开箱型', diff: '用"开箱测评"包装，去销售化、靠真实感起量，对硬广免疫人群有效。',
        shots: {
          '钩子': '测评博主手持[品类]："[平台]1分钱的[品类]到底值不值？实测"。',
          '开箱/产品亮相': '拆包裹全程记录："到手价 ¥0.01"。',
          '功能证明': '称重/敲金属听声、多角度旋转、承重放平板，字幕"全金属·阻尼顺滑·承重OK"。',
          '场景+CTA': '博主点头指下方："1分钱要啥自行车，点链接"。',
          '换人设证言': '评论区截图快闪"真实好评"。',
          '品牌尾板': '红底品牌尾板。'
        },
        script: '（0-3s）今天测一下[平台]1分钱的[品类]是不是智商税。（8-17s）全金属、能转、承重也没问题。（17-21s）1分钱还要啥自行车？链接我放下面了。',
        jimeng: [
          '测评博主桌面场景，手持银色金属[品类]面向镜头讲解，桌有补光灯麦克风，9:16，专业测评风',
          '图生视频：特写手指敲击金属支架听声再展示360度旋转，高清微距，9:16'
        ]
      },
      {
        title: 'F · 纯 B-roll 混剪版（无真人·可批量）', diff: '不需演员，全靠产品 B-roll + 字幕 + 促销贴纸，用即梦批量生成铺量测点击率。',
        shots: {
          '钩子': '强画面钩子：[品类]3 个最美角度快切(0.5s/切)，字幕"最后1000单！1分钱包邮"。',
          '开箱/产品亮相': '手拆包裹→产品亮相，字幕"1分钱薅到的[品类]"。',
          '功能证明': '功能 B-roll：细节/使用/前后对比，每 3 秒一个大字卖点。',
          '场景+CTA': '产品 + 红色箭头指向下方："点视频下方链接，1分钱抢"。',
          '换人设证言': '用户晒单截图快闪："已售XX万件·真实好评"。',
          '品牌尾板': '红底品牌尾板。'
        },
        script: '（纯字幕/BGM 驱动，无口播）钩子字幕"最后1000单·1分钱包邮"→卖点大字轮播→CTA"点下方链接1分钱抢"→晒单信任→品牌尾板。',
        jimeng: [
          '银色金属[品类]在纯色背景缓慢旋转展示，商业产品摄影，9:16，高清',
          '图生视频：手机放入金属支架并旋转调整角度，咖啡馆桌面自然光，9:16',
          '镜头平移展示[品类]金属质感与底座结构，浅景深，9:16'
        ]
      }
    ]
  };

  /* ---------- 反推：从抽帧实测 + 深度分析推断爆款结构 ---------- */
  function gatherText() {
    const deep = (window.VP && VP.deep) || {};
    const ocr = (deep.ocr || []).filter(x => x.text).map(x => x.text).join('\n');
    const whisper = deep.whisper || '';
    return (ocr + '\n' + whisper).trim();
  }

  function inferHookType(text, hasStrongOpen) {
    if (!text) return hasStrongOpen ? '强画面视觉' : '—';
    for (const type of KB.hookTypes) {
      const kws = KB.hooksKw[type];
      if (kws && kwHit(text, kws)) return type;
    }
    return hasStrongOpen ? '强画面视觉' : '—';
  }

  function analyzeStructure() {
    const a = (window.VP && VP.analysis) || {};
    const meta = (window.VP && VP.meta) || {};
    const dur = meta.duration || 0;
    const deep = (window.VP && VP.deep) || {};
    const mat = (window.VP && VP.mat) || null;
    const text = gatherText();
    const hookType = inferHookType(text, a.hook);
    const shotLen = a.shotLen || (dur ? dur / ((a.changes || 0) + 1) : 0);
    const rhythm = shotLen ? (shotLen < 2.5 ? '快节奏/信息密' : shotLen < 4 ? '中节奏' : '慢节奏/留白多') : '—';
    const persons = deep.detect ? deep.detect.personsMax : 0;
    const ctaKw = ['点击', '下单', '领', '抢', '购买', '戳', '左下', '链接', '下方'];
    const hasCta = !!kwHit(text, ctaKw) || (deep.audio && deep.audio.density > 0.5);
    const durTier = dur <= 15 ? '短(<15s)' : dur <= 25 ? '标准(15-25s)' : '长(>25s)';
    return { dur, durTier, hookType, shotLen, rhythm, persons, hasCta, a, mat, text };
  }

  function evalEmpirical(s) {
    const e = KB.empirical;
    const checks = [];
    if (s.dur > 0) {
      if (s.dur <= 20) checks.push({ ok: true, t: '时长 ✅ ' + s.dur.toFixed(0) + 's 在实证最优 20s 内（200+ 跑量视频 67% 在 20s 内，均 ' + e.avgDur + 's）' });
      else if (s.dur <= 30) checks.push({ ok: 'warn', t: '时长 ⚠️ ' + s.dur.toFixed(0) + 's 偏长，实证显示 20s 内更易跑量，建议压缩低效镜头' });
      else checks.push({ ok: false, t: '时长 ❌ ' + s.dur.toFixed(0) + 's 过长，远超实证均 ' + e.avgDur + 's，完播压力大' });
    } else checks.push({ ok: 'warn', t: '时长 ⚠️ 未获取到视频时长（先点「重新抽帧」）' });
    if (s.a.hook) checks.push({ ok: true, t: '前3秒 ✅ 有强画面切换（符合「77% 口播在讲商品、前3s 必现产品」规律）' });
    else checks.push({ ok: false, t: '前3秒 ❌ 偏平稳开场，实证 53% 跑量视频前3s 直接展示商品，建议前置产品/冲突' });
    if (s.persons >= 1) checks.push({ ok: true, t: '真人出镜 ✅ 检出出镜人物（82% 跑量视频有真人试穿/演示）' });
    else checks.push({ ok: 'warn', t: '真人出镜 ⚠️ 未检出明显人物，纯 B-roll 混剪可跑量但信任感弱' });
    if (s.hasCta) checks.push({ ok: true, t: 'CTA ✅ 检出行动指令（建议全片 ≥3 次：第 5s / 15s / 结尾）' });
    else checks.push({ ok: false, t: 'CTA ❌ 未检出明确行动指令，转化链路缺失' });
    if (s.shotLen && s.shotLen < 2.5) checks.push({ ok: true, t: '节奏 ✅ 单镜头约 ' + s.shotLen.toFixed(1) + 's，符合「单镜头 1–2s」实证' });
    else if (s.shotLen) checks.push({ ok: 'warn', t: '节奏 ⚠️ 单镜头约 ' + s.shotLen.toFixed(1) + 's，偏慢，信息密度可提升' });
    return checks;
  }

  function renderViralAnalyze() {
    const out = $('vpViralOut');
    if (!out) return;
    if (!window.VP || !VP.frames || !VP.frames.length) {
      out.innerHTML = '<div class="vp-warn">请先拖入视频并「重新抽帧」（或深度分析），再点「📊 反推爆款结构」。</div>';
      out.classList.remove('muted');
      return;
    }
    const s = analyzeStructure();
    const checks = evalEmpirical(s);
    const mat = s.mat;
    let html = '';
    html += '<div class="vp-rep-blk"><div class="vp-rep-bh">🧩 爆款结构反推 <span class="tag">零Key本地·基于抽帧实测</span></div><div class="vp-rep-bd">';
    html += '<table class="vp-tbl"><tbody>';
    html += row('时长档位', s.dur ? (s.dur.toFixed(1) + 's · ' + s.durTier) : '—');
    html += row('前3秒钩子', s.hookType !== '—' ? s.hookType : (s.a.hook ? '强画面切换（未识别文字钩子）' : '平稳开场'));
    html += row('镜头节奏', (s.shotLen ? s.shotLen.toFixed(1) + 's/镜 · ' : '') + s.rhythm);
    html += row('真人出镜', s.persons >= 1 ? ('有（单帧最多 ' + s.persons + ' 人）') : '无/弱');
    html += row('CTA', s.hasCta ? '有行动指令' : '缺失');
    html += row('品类', (mat && mat.cat) || '—');
    html += row('情绪曲线', '平稳→上升→波动→峰值(倒数1/3)→收尾');
    html += '</tbody></table></div></div>';

    html += '<div class="vp-rep-blk"><div class="vp-rep-bh">📏 对照真实跑量基准（' + esc(KB.empirical.label) + '）</div><div class="vp-rep-bd">';
    checks.forEach(c => {
      const cls = c.ok === true ? 'vp-ok' : c.ok === 'warn' ? 'vp-warn-in' : 'vp-bad';
      const ic = c.ok === true ? '✅' : c.ok === 'warn' ? '⚠️' : '❌';
      html += '<div class="' + cls + '">' + ic + ' ' + esc(c.t) + '</div>';
    });
    html += '</div></div>';

    // 节奏硬规则提示
    html += '<div class="vp-rep-blk"><div class="vp-rep-bh">🎚 节奏硬规则（直接套用）</div><div class="vp-rep-bd muted">' + esc(KB.rhythmRules) + '</div></div>';

    out.innerHTML = html;
    out.classList.remove('muted');

    // 反推完，若已抽帧则提示可继续生成同品类复刻
    const hint = $('kbViralHint');
    if (hint) hint.textContent = '结构已反推 ✓ 点「🧬 生成同品类复刻」产出多套可拍/可生成方案';
  }

  /* ---------- 同品类复刻：骨架不变，套裂变矩阵生成多套 ---------- */
  function buildSameCatSets() {
    const s = analyzeStructure();
    const cat = (s.mat && s.mat.cat) || (window.VP && VP.sid ? '当前素材' : '同类产品');
    const skel = ['钩子', '开箱/产品亮相', '功能证明', '场景+CTA', '换人设证言', '品牌尾板'];
    return KB.sameCatSets.map((def, idx) => {
      const shots = skel.map(stage => ({ stage, content: (def.shots[stage] || '').replace(/\[品类\]/g, cat) }));
      const script = (def.script || '').replace(/\[品类\]/g, cat).replace(/\[平台\]/g, '平台');
      const jimeng = (def.jimeng || []).map(j => j.replace(/\[品类\]/g, cat));
      return { idx, title: def.title, diff: def.diff, shots, script, jimeng, cat };
    });
  }

  function copyText(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { meToast && meToast('已复制逐秒脚本'); }, function () {});
        return;
      }
    } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      if (window.meToast) meToast('已复制逐秒脚本');
    } catch (e) {}
  }

  function renderSameCat() {
    const out = $('vpViralOut');
    if (!out) return;
    if (!window.VP || !VP.frames || !VP.frames.length) {
      out.innerHTML = '<div class="vp-warn">请先拖入视频并「重新抽帧」，再点「🧬 生成同品类复刻」。</div>';
      out.classList.remove('muted');
      return;
    }
    const sets = buildSameCatSets();
    const cat = sets.length ? sets[0].cat : '同类产品';
    const m = KB.sameCatMatrix;
    let html = '';
    html += '<div class="vp-rep-blk"><div class="vp-rep-bh">🧬 同品类复刻 · 锁死品类「' + esc(cat) + '」 <span class="tag">同骨架多张皮</span></div>';
    html += '<div class="vp-rep-bd muted" style="margin-bottom:8px">核心原则：拼接骨架（钩子→开箱→功能特写→场景+CTA→证言→尾板）一字不改，只换钩子/人设/场景/剪辑四层血肉。钩子(' + m.hooks.length + ')×人设(' + m.persons.length + ')×场景(' + m.scenes.length + ') 笛卡尔积可裂变成几十条，且每条都挂在已验证骨架上，避免同质化抢量。</div>';

    sets.forEach(set => {
      const id = 'vpsc-' + set.idx;
      let shotsTxt = '';
      const rows = set.shots.map(sh => {
        shotsTxt += '【' + sh.stage + '】' + sh.content + '\n';
        return '<tr><td class="vp-k">' + esc(sh.stage) + '</td><td>' + esc(sh.content) + '</td></tr>';
      }).join('');
      const jimengTxt = set.jimeng.join('\n');
      const full = '【' + set.title + '】\n差异：' + set.diff + '\n\n— 逐秒分镜 —\n' + shotsTxt + '\n— 口播稿 —\n' + set.script + '\n\n— 即梦生成提示词 —\n' + jimengTxt;

      html += '<div class="vp-setcard">';
      html += '<div class="vp-setc-h">' + esc(set.title) + ' <span class="vp-setc-diff">' + esc(set.diff) + '</span></div>';
      html += '<table class="vp-tbl"><tbody>' + rows + '</tbody></table>';
      html += '<div class="vp-setc-sub">🎙 复刻口播脚本</div><div class="vp-setc-script">' + esc(set.script) + '</div>';
      html += '<div class="vp-setc-sub">🎨 即梦生成提示词（文/图生视频）</div><div class="vp-setc-jimeng">' + set.jimeng.map(j => '· ' + esc(j)).join('<br>') + '</div>';
      html += '<button type="button" class="btn xs ghost" data-copy="' + encodeURIComponent(full) + '">📋 复制本套逐秒脚本</button>';
      html += '</div>';
    });
    html += '</div>';

    out.innerHTML = html;
    out.classList.remove('muted');
    out.querySelectorAll('button[data-copy]').forEach(b => {
      b.onclick = function () { copyText(decodeURIComponent(this.getAttribute('data-copy'))); };
    });
    const hint = $('kbViralHint');
    if (hint) hint.textContent = '已生成 ' + sets.length + ' 套同品类复刻方案 ✓ 可逐套复制脚本';
  }

  /* ---------- 初始化与事件绑定 ---------- */
  function initViralKB() {
    const b1 = $('kbViralAnalyze'); if (b1) b1.onclick = renderViralAnalyze;
    const b2 = $('kbSameCat'); if (b2) b2.onclick = renderSameCat;
    const hint = $('kbViralHint');
    if (hint && window.VP && VP.frames && VP.frames.length) hint.textContent = '视频已抽帧，点「📊 反推爆款结构」直接出结果';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initViralKB);
  else initViralKB();

  // 暴露便于调试
  window.ViralKB = { analyze: analyzeStructure, replicate: buildSameCatSets };
})();
