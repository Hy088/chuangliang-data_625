/* 个人数据增强：素材数据排行 + 时间筛选 + 本月每日明细 + 周统计 + 双月绩效
 * 注入到「个人数据」模块(#me)，读取同目录 me-materials.csv / me-history.csv
 * 注意：KPI 指标卡（#meCards）由主文件 index.html 负责渲染，本脚本不再覆盖。
 */
(function () {
  "use strict";
  // 同源相对路径，适配 GitHub Pages / CloudStudio / 本地文件
  var HIST_URL = "./me-history.csv?v=20260809e";
  var MAT_URL  = "./me-materials.csv?v=20260809e";
  // 「上传时间」口径素材量：me-uploads.csv 含创量后台真实上传时间戳
  // 数据来自创量【内容】页「高级筛选(上传时间)→导出→导出素材信息」逐月导出的原始 xlsx 合并
  var UPLOAD_URL = "./me-uploads.csv?v=20260809e";

  // 排行可排序指标
  var RANK_METRICS = [
    { key: "消耗",   label: "消耗" },
    { key: "展示数", label: "展示数" },
    { key: "点击数", label: "点击数" },
    { key: "转化数", label: "转化数" },
    { key: "CTR",    label: "CTR" }
  ];
  // 每日明细表列
  var DAY_COLS = [
    { k: "日期",   l: "日期",   bar: false },
    { k: "消耗",   l: "消耗",   bar: true },
    { k: "素材数", l: "素材数", bar: false },
    { k: "转化数", l: "转化数", bar: false },
    { k: "CTR",    l: "CTR",    bar: false }
  ];

  var histData = [];   // [{日期,消耗,素材数,转化数,CTR}]
  var matData = [];    // [{日期,素材ID,素材名,消耗,展示数,点击数,转化成本,转化数,CTR}]
  var upData = [];     // [{素材ID,素材名,上传人}] 当月按上传时间统计的素材清单（来自「内容」导出）
  var dates = [];      // 升序日期
  var meRankRows = []; // 当前渲染的当日排行行（供整行点击关联时取当天明细）
  var currentDate = null;
  var dateAuto = true;   // true=实时锁定今日；用户手动选日期后转 false，刷新仍尊重其选择
  var sortKey = "消耗";
  var monthSortKey = "消耗";
  var daySortKey = "日期";
  var daySortDir = 1;  // 1 升序 / -1 降序
  var timeFilterMode = "day";  // month / week / day
  var consStart = null, consEnd = null;  // 消耗汇总独立日期范围（与素材面板各自独立）
  var PREVIEW_KEY = null;      // 素材预览链接列名（自动探测，无则隐藏预览列）
  var COVER_KEY = null;        // 素材封面图列名（自动探测，无则隐藏缩略图）
  var ready = false;

  /* ---------- 双月绩效 KPI 进度：状态与工具 ---------- */
  var KPI_KEY = "meKpiStore_v1";
  function loadKpiStore() { try { return JSON.parse(localStorage.getItem(KPI_KEY) || "{}"); } catch (e) { return {}; } }
  function saveKpiStore(s) { try { localStorage.setItem(KPI_KEY, JSON.stringify(s)); } catch (e) {} }
  var kpiStore = loadKpiStore();
  function monthStr(offset) {
    var t = new Date(); t.setDate(1); t.setMonth(t.getMonth() + offset);
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2);
  }
  // 兼容旧版 _months 数组 与 {start,count}；新版用 _range: { start: 'YYYY-MM', end: 'YYYY-MM' }
  if (!kpiStore._range || typeof kpiStore._range !== "object") {
    var oldMonths = kpiStore._months;
    if (oldMonths && Array.isArray(oldMonths) && oldMonths.length >= 1) {
      kpiStore._range = { start: oldMonths[0], end: oldMonths[oldMonths.length - 1] };
    } else {
      kpiStore._range = { start: monthStr(-1), end: monthStr(0) };
    }
    saveKpiStore(kpiStore);
  }
  // 兼容旧版 { start, count }
  if (kpiStore._range.count && !kpiStore._range.end) {
    var d = new Date(kpiStore._range.start + "-01T00:00:00");
    if (!isNaN(d.getTime())) {
      d.setMonth(d.getMonth() + (parseInt(kpiStore._range.count, 10) || 2) - 1);
      kpiStore._range.end = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
      saveKpiStore(kpiStore);
    }
  }
  function getKpiMonths() {
    var range = kpiStore._range || { start: monthStr(-1), end: monthStr(0) };
    var list = [];
    var d = new Date(range.start + "-01T00:00:00");
    var end = range.end || range.start;
    var endD = new Date(end + "-01T00:00:00");
    if (isNaN(d.getTime())) d = new Date(monthStr(-1) + "-01T00:00:00");
    if (isNaN(endD.getTime())) endD = d;
    // 保证 start <= end
    if (d > endD) { var tmp = d; d = endD; endD = tmp; }
    while (true) {
      var y = d.getFullYear(), m = d.getMonth() + 1;
      list.push(y + "-" + ("0" + m).slice(-2));
      if (y === endD.getFullYear() && m === (endD.getMonth() + 1)) break;
      d.setMonth(d.getMonth() + 1);
    }
    return list;
  }
  var kpiMonths = getKpiMonths();
  // 取某月实际消耗（总消耗 + AIGC 消耗），AIGC 由 isAiMaterial(素材标签) 按【素材标签】列判定
  function getMonthActual(m) {
    var cost = 0, aigc = 0;
    if (!m) return { cost: 0, aigc: 0 };
    matData.forEach(function (r) {
      if ((r["日期"] || "").slice(0, 7) === m) {
        var c = num(r["消耗"]); cost += c;
        if (isAiMaterial(r["素材标签"], r["素材名"])) aigc += c;
      }
    });
    return { cost: cost, aigc: aigc };
  }

  /* ---------- 工具 ---------- */
  function el(id) { return document.getElementById(id); }
  function fmtNum(v) {
    if (v == null || isNaN(v)) return "0";
    var n = Number(v);
    if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("zh-CN");
    return (Math.round(n * 100) / 100).toLocaleString("zh-CN");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function parseCSV(text) {
    var rows = [], i = 0, field = "", row = [], inQ = false;
    while (i < text.length) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (c === "\r") { /* skip */ }
        else field += c;
      }
      i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }
  function csvToObjects(text) {
    var rows = parseCSV(text.replace(/﻿/g, ""));
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      if (!rows[r].length || (rows[r].length === 1 && rows[r][0].trim() === "")) continue;
      var o = {};
      for (var c = 0; c < head.length; c++) o[head[c]] = (rows[r][c] || "").trim();
      out.push(o);
    }
    return out;
  }
  function num(v) { var n = parseFloat(String(v).replace(/[,%]/g, "")); return isFinite(n) ? n : 0; }
  // 从素材名解析「创建/上传月份」(YYYY-MM)：优先 8 位 YYYYMMDD，否则合法的 6 位 YYMMDD(如 260409=2026-04-09)
  function matCreateMonth(name) {
    if (!name) return "";
    var parts = String(name).split("-");
    var cand = "";
    for (var i = 0; i < parts.length; i++) if (/^20\d{6}$/.test(parts[i])) cand = parts[i];
    if (!cand) {
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        if (/^\d{6}$/.test(p)) {
          var yy = parseInt(p.slice(0, 2), 10), mm = parseInt(p.slice(2, 4), 10), dd = parseInt(p.slice(4, 6), 10);
          if (yy >= 0 && yy <= 30 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) cand = "20" + p;
        }
      }
    }
    return cand ? cand.slice(0, 4) + "-" + cand.slice(4, 6) : "";
  }

  // AIGC 素材判定：以【素材标签】列为准（用户 2026-08-09 约定，见项目记忆）
  // 9 个 AIGC 标签（OR 并集，命中其一即为 AIGC）：
  //   平台一组AIGC / 平台一组AIGC-sd / 京东本部-模型-seedance2.0 / 平台一组AIGC-wx /
  //   京东本部-工具-万相 / 平台一组AIGC-k / 京东本部-工具-可灵 / 平台一组AIGC-c空镜 / 京东本部-工作流-comfyui
  // me-materials.csv / me-uploads.csv 的【素材标签】列来自创量【内容】->导出素材信息 xlsx（逗号分隔多标签）。
  // 判定逻辑：按逗号切出每个标签 token，与 9 个 AIGC 标签做【精确】匹配（避免 "平台一组AIGC" 误命中 "平台一组AIGC-sd"）；
  //           仅当某行确实无【素材标签】数据（如源未覆盖的素材）时回退素材名片段，避免漏计。
  var AIGC_TAGS = ["平台一组AIGC","平台一组AIGC-sd","京东本部-模型-seedance2.0","平台一组AIGC-wx","京东本部-工具-万相","平台一组AIGC-k","京东本部-工具-可灵","平台一组AIGC-c空镜","京东本部-工作流-comfyui"];
  var AI_TAG_KEYWORDS = ["aigc","seedance","万相","可灵","空镜","comfyui"];
  // tag: 素材标签列原值（逗号分隔多标签）；name: 素材名（仅当无素材标签时兜底）
  function isAiMaterial(tag, name) {
    if (tag && String(tag).trim()) {
      var toks = String(tag).split(/[,，]/).map(function (x) { return x.trim(); });
      for (var i = 0; i < toks.length; i++) {
        if (AIGC_TAGS.indexOf(toks[i]) >= 0) return true;   // 精确命中 9 标签任一 → AIGC
      }
      return false; // 有标签列但无命中 → 非 AIGC（严格按标签判定，不回退命名）
    }
    // 无【素材标签】数据时回退素材名片段判定（兼容尚未回接的素材）
    if (name) {
      var n = String(name).toLowerCase();
      for (var i = 0; i < AI_TAG_KEYWORDS.length; i++) {
        if (n.indexOf(AI_TAG_KEYWORDS[i].toLowerCase()) >= 0) return true;
      }
    }
    return false;
  }

  // 自动探测素材预览链接列（列名含 预览/视频/url/链接/link 其一即识别）
  function detectMediaKeys() {
    PREVIEW_KEY = null; COVER_KEY = null;
    if (!matData.length) return;
    var keys = Object.keys(matData[0]);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i].toLowerCase();
      if (k.indexOf("预览") >= 0 || k.indexOf("视频") >= 0 || k.indexOf("url") >= 0 || k.indexOf("链接") >= 0 || k.indexOf("link") >= 0) { PREVIEW_KEY = keys[i]; }
      if (k.indexOf("封面") >= 0 || k.indexOf("cover") >= 0 || k.indexOf("缩略图") >= 0 || k.indexOf("thumb") >= 0) { COVER_KEY = keys[i]; }
    }
  }

  /* ---------- 素材预览：行内展开播放 ---------- */
  function isDirectVideo(url) {
    return /\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(url) || /(^|\/)(video|creative|material|play)\b/i.test(url) && /\.(mp4|webm)/i.test(url);
  }
  function expandPreview(btn) {
    var tr = btn.closest("tr");
    if (!tr) return;
    var existing = tr.nextElementSibling;
    if (existing && existing.classList.contains("me-prev-row")) { existing.remove(); btn.textContent = "▶"; return; }
    var tbodyEl = tr.parentNode;
    Array.prototype.forEach.call(tbodyEl.querySelectorAll(".me-prev-row"), function (r) { r.remove(); });
    Array.prototype.forEach.call(tbodyEl.querySelectorAll(".me-play"), function (b) { b.textContent = "▶"; });
    var url = (btn.getAttribute("data-url") || "").trim();
    var cover = (btn.getAttribute("data-cover") || "").trim();
    var inner;
    if (url && isDirectVideo(url)) {
      inner = "<video controls autoplay style='max-width:100%;max-height:380px;background:#000;border-radius:8px' src='" + esc(url) + "'></video>";
    } else if (url) {
      inner = "<div style='padding:10px 4px'>" +
        "<a href='" + esc(url) + "' target='_blank' rel='noopener' style='color:#2b6cff;font-weight:600'>↗ 在创量后台查看素材预览</a>" +
        "<span style='color:#8a94a6;font-size:12px;margin-left:8px'>（当前为预览页链接，已新窗口打开；若填的是 mp4 直链则可在此直接播放）</span></div>";
    } else if (cover) {
      inner = "<div style='padding:10px 4px'><img src='" + esc(cover) + "' style='max-width:100%;max-height:380px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.12)' alt='素材封面'><div style='color:#8a94a6;font-size:12px;margin-top:6px'>暂无视频直链，仅显示封面</div></div>";
    } else {
      btn.textContent = "▶"; return;
    }
    var td = document.createElement("td");
    td.colSpan = tr.children.length;
    td.innerHTML = inner;
    var nr = document.createElement("tr");
    nr.className = "me-prev-row";
    nr.appendChild(td);
    tr.parentNode.insertBefore(nr, tr.nextSibling);
    btn.textContent = "▼";
  }

  /* ---------- 排行榜素材ID 自动关联：跳转到视频解析并回填素材 ---------- */
  function meToast(msg) {
    var t = document.getElementById("meToast");
    if (!t) {
      t = document.createElement("div"); t.id = "meToast";
      t.style.cssText = "position:fixed;left:50%;bottom:42px;transform:translateX(-50%);background:rgba(30,38,52,.94);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.28);opacity:0;transition:opacity .25s;pointer-events:none;max-width:84vw;text-align:center";
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.style.opacity = "0"; }, 2800);
  }
  // 从排行榜点整行/素材ID → 自动关联到视频解析
  // arg 可为「素材ID 字符串」或「当日明细行对象（带消耗/展示/点击/转化/CTR 等）」
  function associateFromRank(arg) {
    var row = null, sid = "";
    if (typeof arg === "object" && arg) {
      row = arg;
      sid = arg["素材ID"] || arg.id || "";
    } else if (typeof arg === "string") {
      sid = arg;
      if (meRankRows.length) {
        for (var i = 0; i < meRankRows.length; i++) {
          if ((meRankRows[i]["素材ID"] || "") === sid) { row = meRankRows[i]; break; }
        }
      }
    }
    var nav = document.querySelector('nav button[data-tab="vparse"]');
    if (nav) nav.click();
    if (row && typeof window.assocMatFromRow === "function") {
      try { window.assocMatFromRow(row); } catch (e) { if (sid && window.assocMat) window.assocMat(sid); }
      meToast("已关联素材 " + (sid || "?") + " → 视频解析（已带入当日明细）");
      return;
    }
    if (sid && typeof window.assocMat === "function") { try { window.assocMat(sid); } catch (e) {} }
    meToast("已关联素材 " + (sid || "?") + " → 视频解析（可继续加载视频做一键复刻）");
  }

  /* ---------- 渲染：素材排行 ---------- */
  function renderRank() {
    var box = el("meRankBody");
    if (!box) return;
    var t = todayStr();
    var isToday = (currentDate === t);
    var rows = matData.filter(function (m) { return m["日期"] === currentDate; });
    rows.sort(function (a, b) { return num(b[sortKey]) - num(a[sortKey]); });
    meRankRows = rows;
    if (!rows.length) {
      var msg = isToday
        ? "今日暂无素材明细数据（数据更新后点「🔄 实时刷新」）"
        : "当日暂无素材明细数据";
      box.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#999">' + msg + "</div>";
      var cnt0 = el("meRankCount"); if (cnt0) cnt0.textContent = "当日共 0 个素材" + (isToday ? " · 实时(今日)" : " · 历史日");
      return;
    }
    var max = num(rows[0][sortKey]) || 1;
    var prevOn = !!PREVIEW_KEY;
    var coverOn = !!COVER_KEY;
    var thead = "<tr><th>#</th>" + (coverOn ? "<th class='me-cover-h'>封面</th>" : "") + (prevOn ? "<th class='me-prev-h'>预览</th>" : "") + "<th class='l'>素材名</th><th class='l'>素材ID</th>" + RANK_METRICS.map(function (m) {
      return "<th data-key='" + m.key + "' class='" + (m.key === sortKey ? "on" : "") + "'>" + m.label + (m.key === sortKey ? " ↓" : "") + "</th>";
    }).join("") + "</tr>";
    var prevUrls = [];
    var coverUrls = [];
    var tbody = rows.map(function (m, idx) {
      var v = num(m[sortKey]);
      var w = Math.max(2, Math.round(v / max * 100));
      var name = m["素材名"] || m["素材ID"] || "(未命名)";
      var disp = name.length > 38 ? name.slice(0, 38) + "…" : name;
      var sid = m["素材ID"] || "";
      var sidDisp = sid.length > 14 ? sid.slice(0, 14) + "…" : sid;
      var sidCell = sid ? "<td class='l'><a class='me-sid' data-sid='" + esc(sid) + "' title='点击：自动关联到视频解析，回填该素材投放数据'>" + esc(sidDisp) + "</a></td>" : "<td class='l'>-</td>";
      var coverUrl = coverOn ? (m[COVER_KEY] || "") : "";
      var prevUrl = prevOn ? (m[PREVIEW_KEY] || "") : "";
      var coverCell = coverOn ? "<td class='me-cover-cell'>" + (coverUrl ? "<img class='me-thumb' src='" + esc(coverUrl) + "' loading='lazy' alt=''>" : "-") + "</td>" : "";
      var prevBtn = prevOn ? "<td class='me-prev-cell'><button class='me-play' type='button' data-i='" + idx + "'>▶</button></td>" : "";
      prevUrls.push(prevUrl);
      coverUrls.push(coverUrl);
      var cells = RANK_METRICS.map(function (met) {
        var val = num(m[met.key]);
        var txt = (met.key === "CTR") ? val.toFixed(2) + "%" : fmtNum(val);
        var bar = (met.key === sortKey)
          ? "<div style='margin-top:3px;height:4px;background:#e8edf3;border-radius:3px;overflow:hidden'><i style='display:block;height:100%;width:" + w + "%;background:#4a7bff'></i></div>"
          : "";
        return "<td>" + txt + bar + "</td>";
      }).join("");
      return "<tr data-ridx='" + idx + "' title='点击整行：自动关联到视频解析并带入当日明细'><td class='rk'>" + (idx + 1) + "</td>" + coverCell + prevBtn + "<td class='l' title='" + esc(name) + "'>" + esc(disp) + "</td>" + sidCell + cells + "</tr>";
    }).join("");
    box.innerHTML = "<table class='me-rank-tbl'><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
    Array.prototype.forEach.call(box.querySelectorAll("th[data-key]"), function (th) {
      th.style.cursor = "pointer";
      th.onclick = function () { sortKey = th.getAttribute("data-key"); renderRank(); };
    });
    Array.prototype.forEach.call(box.querySelectorAll(".me-play"), function (btn) {
      var i = +btn.getAttribute("data-i");
      btn.setAttribute("data-url", prevUrls[i] || "");
      btn.setAttribute("data-cover", coverUrls[i] || "");
      btn.onclick = function (e) { e.stopPropagation(); expandPreview(btn); };
    });
    Array.prototype.forEach.call(box.querySelectorAll(".me-sid"), function (a) {
      a.onclick = function (e) { e.preventDefault(); e.stopPropagation(); associateFromRank(a.getAttribute("data-sid")); };
    });
    Array.prototype.forEach.call(box.querySelectorAll("tr[data-ridx]"), function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest(".me-play") || e.target.closest(".me-sid")) return; // 这两类各自处理
        var idx = +tr.getAttribute("data-ridx");
        associateFromRank(meRankRows[idx]);
      };
    });
    var cnt = el("meRankCount"); if (cnt) cnt.textContent = "当日共 " + rows.length + " 个素材（按" + (RANK_METRICS.filter(function (m){return m.key===sortKey;})[0].label) + "排序）" + (isToday ? " · 实时(今日)" : " · 历史日");
  }

  /* ---------- 渲染：本月汇总 ---------- */
  function monthCard(name, val, unit) {
    return '<div class="kpi"><div class="l">' + esc(name) + "</div>" +
      '<div class="v">' + val + (unit ? (' <small>' + esc(unit) + "</small>") : "") + "</div>" +
      '<div class="note" style="margin:2px 0 0;color:#9aa4b2">本月累计</div></div>';
  }
  function renderMonthCards(totalCost, totalConv, avgCTR, distinctMat, days) {
    var box = el("meMonthCards");
    if (!box) return;
    box.innerHTML =
      monthCard("本月总消耗", fmtNum(totalCost), "元") +
      monthCard("本月总转化数", fmtNum(totalConv), "个") +
      monthCard("平均CTR", avgCTR.toFixed(2), "%") +
      monthCard("去重素材数", fmtNum(distinctMat), "个") +
      monthCard("覆盖天数", days, "天");
  }
  function renderMonthChart() {
    var box = el("meMonthChart");
    if (!box) return;
    var hs = consFiltered(histData, "日期").slice().sort(function (a, b) { return a["日期"] < b["日期"] ? -1 : 1; });
    var max = 0;
    hs.forEach(function (h) { max = Math.max(max, num(h["消耗"])); });
    max = max || 1;
    box.innerHTML = hs.map(function (h) {
      var v = num(h["消耗"]);
      var hgt = Math.max(2, Math.round(v / max * 100));
      var d = h["日期"].slice(5);
      return "<div title='" + esc(h["日期"]) + ": " + fmtNum(v) + "元' style='flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0'>" +
        "<div style='width:100%;background:#4a7bff;border-radius:2px 2px 0 0;height:" + hgt + "%'></div>" +
        "<div style='font-size:9px;color:#9aa4b2;margin-top:2px;transform:rotate(-45deg);transform-origin:center;white-space:nowrap'>" + d + "</div></div>";
    }).join("");
  }
  function renderMonthMatTop() {
    var box = el("meMonthMatTop");
    if (!box) return;
    var map = {};
    consFiltered(matData, "日期").forEach(function (m) {
      var id = m["素材ID"] || m["素材名"] || "(未知)";
      if (!map[id]) map[id] = { id: id, name: m["素材名"] || id, "消耗": 0, "展示数": 0, "点击数": 0, "转化数": 0, days: {}, "预览链接": "", "封面链接": "" };
      var o = map[id];
      o["消耗"] += num(m["消耗"]); o["展示数"] += num(m["展示数"]);
      o["点击数"] += num(m["点击数"]); o["转化数"] += num(m["转化数"]);
      if (m["日期"]) o.days[m["日期"]] = 1;
      if (PREVIEW_KEY && !o["预览链接"]) o["预览链接"] = m[PREVIEW_KEY] || "";
      if (COVER_KEY && !o["封面链接"]) o["封面链接"] = m[COVER_KEY] || "";
    });
    var rows = Object.keys(map).map(function (k) {
      var o = map[k]; o["活跃天数"] = Object.keys(o.days).length;
      o["CTR"] = o["展示数"] > 0 ? o["点击数"] / o["展示数"] * 100 : 0; return o;
    });
    rows.sort(function (a, b) { return b[monthSortKey] - a[monthSortKey]; });
    rows = rows.slice(0, 50);
    if (!rows.length) {
      box.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#999">暂无素材明细数据</div>';
      return;
    }
    var max = rows[0][monthSortKey] || 1;
    var prevOn = !!PREVIEW_KEY;
    var coverOn = !!COVER_KEY;
    var metrics = [
      { k: "消耗", label: "消耗" }, { k: "展示数", label: "展示数" },
      { k: "点击数", label: "点击数" }, { k: "转化数", label: "转化数" },
      { k: "CTR", label: "CTR" }, { k: "活跃天数", label: "活跃天" }
    ];
    var thead = "<tr><th>#</th>" + (coverOn ? "<th class='me-cover-h'>封面</th>" : "") + (prevOn ? "<th class='me-prev-h'>预览</th>" : "") + "<th class='l'>素材名</th>" + metrics.map(function (m) {
      return "<th data-key='" + m.k + "' class='" + (m.k === monthSortKey ? "on" : "") + "'>" + m.label + (m.k === monthSortKey ? " ↓" : "") + "</th>";
    }).join("") + "</tr>";
    var prevUrls = [];
    var coverUrls = [];
    var tbody = rows.map(function (o, idx) {
      var v = o[monthSortKey];
      var w = Math.max(2, Math.round(v / max * 100));
      var name = o["name"];
      var disp = name.length > 34 ? name.slice(0, 34) + "…" : name;
      var coverUrl = coverOn ? (o["封面链接"] || "") : "";
      var prevUrl = prevOn ? (o["预览链接"] || "") : "";
      var coverCell = coverOn ? "<td class='me-cover-cell'>" + (coverUrl ? "<img class='me-thumb' src='" + esc(coverUrl) + "' loading='lazy' alt=''>" : "-") + "</td>" : "";
      var prevBtn = prevOn ? "<td class='me-prev-cell'><button class='me-play' type='button' data-i='" + idx + "'>▶</button></td>" : "";
      prevUrls.push(prevUrl);
      coverUrls.push(coverUrl);
      var cells = metrics.map(function (met) {
        var val = o[met.k];
        var txt = (met.k === "CTR") ? Number(val).toFixed(2) + "%" : fmtNum(val);
        var bar = (met.k === monthSortKey)
          ? "<div style='margin-top:3px;height:4px;background:#e8edf3;border-radius:3px;overflow:hidden'><i style='display:block;height:100%;width:" + w + "%;background:#4a7bff'></i></div>"
          : "";
        return "<td>" + txt + bar + "</td>";
      }).join("");
      return "<tr><td class='rk'>" + (idx + 1) + "</td>" + coverCell + prevBtn + "<td class='l' title='" + esc(name) + "'>" + esc(disp) + "</td>" + cells + "</tr>";
    }).join("");
    box.innerHTML = "<table class='me-rank-tbl'><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
    Array.prototype.forEach.call(box.querySelectorAll("th[data-key]"), function (th) {
      th.style.cursor = "pointer";
      th.onclick = function () { monthSortKey = th.getAttribute("data-key"); renderMonthMatTop(); };
    });
    Array.prototype.forEach.call(box.querySelectorAll(".me-play"), function (btn) {
      var i = +btn.getAttribute("data-i");
      btn.setAttribute("data-url", prevUrls[i] || "");
      btn.setAttribute("data-cover", coverUrls[i] || "");
      btn.onclick = function (e) { e.stopPropagation(); expandPreview(btn); };
    });
  }

  /* ---------- 时间筛选：月 / 周 / 日 汇总 ---------- */
  function parseDate(d) { var p = d.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function isoWeekKey(d) {
    var dt = parseDate(d);
    var thu = new Date(dt);
    thu.setDate(dt.getDate() + 3 - ((dt.getDay() + 6) % 7));
    var year = thu.getFullYear();
    var w1 = new Date(year, 0, 4);
    w1.setDate(w1.getDate() - ((w1.getDay() + 6) % 7));
    var weekNo = Math.floor((thu - w1) / 604800000) + 1;
    return year + "-W" + ("0" + weekNo).slice(-2);
  }
  function isoWeekRange(key) {
    var m = key.match(/(\d+)-W(\d+)/); if (!m) return key;
    var year = +m[1], week = +m[2];
    var jan4 = new Date(year, 0, 4);
    var day1 = new Date(jan4);
    day1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    var start = new Date(day1); start.setDate(day1.getDate() + (week - 1) * 7);
    var end = new Date(start); end.setDate(start.getDate() + 6);
    return start.toISOString().slice(0, 10) + " ~ " + end.toISOString().slice(0, 10);
  }
  function aggTimeRows(mode) {
    var groups = {};
    histData.forEach(function (h) {
      var d = h["日期"];
      var key, label, sortKey;
      if (mode === "month") {
        key = d.slice(0, 7);
        label = key;
        sortKey = key;
      } else if (mode === "week") {
        key = isoWeekKey(d);
        label = key;
        sortKey = key;
      } else {
        key = d;
        label = d;
        sortKey = d;
      }
      if (!groups[key]) groups[key] = { key: key, label: label, sortKey: sortKey, cost: 0, mat: 0, conv: 0, ctrSum: 0, days: 0, maxCost: 0 };
      var g = groups[key];
      g.cost += num(h["消耗"]);
      g.mat += num(h["素材数"]);
      g.conv += num(h["转化数"]);
      g.ctrSum += num(h["CTR"]);
      g.days += 1;
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }
  function renderTimeTable() {
    var box = el("meTimeTable");
    if (!box) return;
    var mode = timeFilterMode;
    var rows = aggTimeRows(mode);
    // 表头
    var cols = [];
    if (mode === "month") cols = [{ k: "label", l: "月份" }, { k: "天数", l: "天数" }, { k: "cost", l: "消耗", bar: true }, { k: "mat", l: "素材数" }, { k: "conv", l: "转化数" }, { k: "ctr", l: "CTR" }];
    else if (mode === "week") cols = [{ k: "label", l: "周次" }, { k: "range", l: "区间" }, { k: "天数", l: "天数" }, { k: "cost", l: "消耗", bar: true }, { k: "mat", l: "素材数" }, { k: "conv", l: "转化数" }, { k: "ctr", l: "CTR" }];
    else cols = [{ k: "label", l: "日期" }, { k: "cost", l: "消耗", bar: true }, { k: "mat", l: "素材数" }, { k: "conv", l: "转化数" }, { k: "ctr", l: "CTR" }];
    // 排序
    rows.sort(function (a, b) {
      if (daySortKey === "label" || daySortKey === "日期" || daySortKey === "月份" || daySortKey === "周次") {
        return a.sortKey < b.sortKey ? -daySortDir : (a.sortKey > b.sortKey ? daySortDir : 0);
      }
      var ak = (daySortKey === "cost") ? a.cost : (daySortKey === "mat") ? a.mat : (daySortKey === "conv") ? a.conv : (daySortKey === "ctr") ? (a.ctrSum / a.days) : (daySortKey === "天数") ? a.days : a.cost;
      var bk = (daySortKey === "cost") ? b.cost : (daySortKey === "mat") ? b.mat : (daySortKey === "conv") ? b.conv : (daySortKey === "ctr") ? (b.ctrSum / b.days) : (daySortKey === "天数") ? b.days : b.cost;
      return (ak - bk) * daySortDir;
    });
    if (!rows.length) { box.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#999">暂无数据</div>'; return; }
    var maxCost = 1; rows.forEach(function (r) { maxCost = Math.max(maxCost, r.cost); });
    var thead = "<tr>" + cols.map(function (c) {
      var on = (daySortKey === c.k) || (daySortKey === "日期" && c.k === "label") || (daySortKey === "月份" && c.k === "label") || (daySortKey === "周次" && c.k === "label");
      var arrow = on ? (daySortDir > 0 ? " ↓" : " ↑") : "";
      return "<th data-key='" + c.k + "' class='" + (c.k === "label" || c.k === "range" ? "l " : "") + (on ? "on" : "") + "'>" + c.l + arrow + "</th>";
    }).join("") + "</tr>";
    var tbody = rows.map(function (r) {
      var cells = cols.map(function (c) {
        if (c.k === "label") {
          var txt = (mode === "week") ? ("第 " + r.label.slice(-2) + " 周") : r.label;
          return "<td class='l'>" + esc(txt) + "</td>";
        }
        if (c.k === "range") return "<td class='l'>" + esc(isoWeekRange(r.key)) + "</td>";
        if (c.k === "cost") {
          var w = Math.max(2, Math.round(r.cost / maxCost * 100));
          return "<td><div style='display:flex;align-items:center;gap:8px;justify-content:flex-end'>" +
            "<span>" + fmtNum(r.cost) + "</span>" +
            "<span style='flex:1;max-width:120px;height:6px;background:#eef2f7;border-radius:3px;overflow:hidden'><i style='display:block;height:100%;width:" + w + "%;background:#4a7bff'></i></span>" +
            "</div></td>";
        }
        if (c.k === "ctr") return "<td>" + (r.ctrSum / r.days).toFixed(2) + "%</td>";
        if (c.k === "天数") return "<td>" + r.days + "</td>";
        return "<td>" + fmtNum(r[c.k]) + "</td>";
      }).join("");
      return "<tr>" + cells + "</tr>";
    }).join("");
    box.innerHTML = "<table class='me-rank-tbl'><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
    Array.prototype.forEach.call(box.querySelectorAll("th[data-key]"), function (th) {
      th.style.cursor = "pointer";
      th.onclick = function () {
        var k = th.getAttribute("data-key");
        if (daySortKey === k) daySortDir = -daySortDir;
        else { daySortKey = k; daySortDir = (k === "label" || k === "range") ? 1 : -1; }
        renderTimeTable();
      };
    });
  }
  function setTimeMode(mode) {
    timeFilterMode = mode;
    daySortKey = (mode === "month") ? "label" : (mode === "week") ? "label" : "日期";
    daySortDir = 1;
    renderTimeTabs();
    renderTimeTable();
  }
  function renderTimeTabs() {
    var tabs = el("meTimeTabs");
    if (!tabs) return;
    ["month", "week", "day"].forEach(function (m) {
      var btn = tabs.querySelector("[data-mode='" + m + "']");
      if (!btn) return;
      var active = timeFilterMode === m;
      btn.style.background = active ? "#2b6cff" : "#fff";
      btn.style.color = active ? "#fff" : "#334";
      btn.style.borderColor = active ? "#2b6cff" : "#cdd6e3";
    });
  }

  /* ---------- 渲染：周统计 ---------- */
  function renderWeek() {
    var box = el("meWeekTable");
    if (!box) return;
    var hs = histData.slice().sort(function (a, b) { return a["日期"] < b["日期"] ? -1 : 1; });
    if (!hs.length) { box.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#999">暂无数据</div>'; return; }
    var m = hs[0]["日期"].slice(5, 7);
    var maxDay = parseInt(hs[hs.length - 1]["日期"].slice(8, 10), 10);
    var weeks = {};
    hs.forEach(function (h) {
      var dom = parseInt(h["日期"].slice(8, 10), 10);
      var idx = Math.floor((dom - 1) / 7) + 1;
      if (!weeks[idx]) weeks[idx] = [];
      weeks[idx].push(h);
    });
    var idxs = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    var rows = idxs.map(function (idx) {
      var rs = weeks[idx];
      var cost = 0, conv = 0, matSum = 0, ctrSum = 0;
      rs.forEach(function (h) { cost += num(h["消耗"]); conv += num(h["转化数"]); matSum += num(h["素材数"]); ctrSum += num(h["CTR"]); });
      var n = rs.length;
      var startDom = (idx - 1) * 7 + 1;
      var endDom = Math.min(idx * 7, maxDay);
      var rng = m + "/" + ("0" + startDom).slice(-2) + "–" + ("0" + endDom).slice(-2);
      return {
        idx: idx, rng: rng, n: n,
        cost: cost, avgCost: cost / n,
        conv: conv, avgMat: matSum / n,
        avgCTR: ctrSum / n
      };
    });
    var maxCost = 1; rows.forEach(function (r) { maxCost = Math.max(maxCost, r.cost); });
    var thead = "<tr><th class='l'>周次</th><th>区间</th><th>天数</th><th>周消耗</th><th>日均消耗</th><th>周转化数</th><th>周均在投素材数</th><th>周均CTR</th></tr>";
    var tbody = rows.map(function (r) {
      var w = Math.max(2, Math.round(r.cost / maxCost * 100));
      return "<tr>" +
        "<td class='l'>第 " + r.idx + " 周</td>" +
        "<td>" + esc(r.rng) + "</td>" +
        "<td>" + r.n + "</td>" +
        "<td><div style='display:flex;align-items:center;gap:8px;justify-content:flex-end'><span>" + fmtNum(r.cost) + "</span><span style='flex:1;max-width:90px;height:6px;background:#eef2f7;border-radius:3px;overflow:hidden'><i style='display:block;height:100%;width:" + w + "%;background:#27a567'></i></span></div></td>" +
        "<td>" + fmtNum(r.avgCost) + "</td>" +
        "<td>" + fmtNum(r.conv) + "</td>" +
        "<td>" + fmtNum(r.avgMat) + "</td>" +
        "<td>" + r.avgCTR.toFixed(2) + "%</td>" +
        "</tr>";
    }).join("");
    box.innerHTML = "<table class='me-rank-tbl'><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
  }

  /* ---------- 渲染：双月绩效 KPI 进度 ---------- */
  function kpiColor(ratio, tg) { return tg > 0 ? (ratio >= 1 ? "#12a06a" : (ratio >= 0.8 ? "#1f9d55" : (ratio >= 0.6 ? "#e0a008" : "#e0533d"))) : "#94a3b8"; }
  function kpiState(ratio, tg) { if (!(tg > 0)) return "未设目标"; if (ratio >= 1) return "已达成"; if (ratio >= 0.8) return "冲刺中"; if (ratio >= 0.6) return "进行中"; return "偏慢"; }
  function kpiGapTxt(actual, tg) {
    if (!(tg > 0)) return "填写目标值后自动计算达成率与缺口";
    var gap = tg - actual;
    return gap > 0 ? ("距达标还差 ¥" + fmtNum(gap)) : ("已超额完成 ¥" + fmtNum(-gap));
  }
  // 单项 KPI 区块：达成率大数字 + 状态徽章 + 进度条 + 实际/目标 + 缺口
  function kpiRow(label, mi, f, actualVal, targetVal, targetInput) {
    var ratio = targetVal > 0 ? actualVal / targetVal : 0;
    var pct = Math.round(ratio * 100);
    var col = kpiColor(ratio, targetVal);
    return "<div class='kpi-blk me-kpi-row'>" +
      "<div class='kpi-lb'><span>" + esc(label) + "</span>" + (targetInput || "") + "</div>" +
      "<div class='kpi-big'>" +
        "<b class='me-kpi-pct' style='color:" + col + "'>" + pct + "%</b><span>达成率</span>" +
        "<span class='kpi-badge me-kpi-badge' style='background:" + col + "'>" + kpiState(ratio, targetVal) + "</span>" +
      "</div>" +
      "<div class='kpi-track'><i class='me-kpi-bar' data-m='" + mi + "' data-f='" + f + "' style='width:" + Math.min(100, pct) + "%;background:" + col + "'></i></div>" +
      "<div class='kpi-num'><span class='me-kpi-actual'>实际 ¥" + fmtNum(actualVal) + "</span><span class='me-kpi-target'>目标 ¥" + fmtNum(targetVal) + "</span></div>" +
      "<div class='kpi-gap me-kpi-gap'>" + kpiGapTxt(actualVal, targetVal) + "</div>" +
    "</div>";
  }
  function tgInput(m, f, v) {
    return "<span style='font-weight:400;color:#8a94a6'>目标 <input type='number' class='me-kpi-target-input kpi-in' data-m='" + m + "' data-f='" + f + "' value='" + v + "' placeholder='0'> 元</span>";
  }
  // 单月卡片
  function kpiMonthBlock(m, actual, t) {
    return "<div class='kpi-mc'>" +
      "<div class='kpi-mc-hd'>" +
        "<span class='kpi-mc-tag'>" + m + " 月</span>" +
        "<span style='font-size:12px;color:#8a94a6'>实际值按所选月份自动汇总</span>" +
      "</div>" +
      "<div class='kpi-mc-bd'>" +
        kpiRow("总消耗", m, "cost", actual.cost, t.cost, tgInput(m, "cost", t.cost)) +
        kpiRow("AIGC 消耗", m, "aigc", actual.aigc, t.aigc, tgInput(m, "aigc", t.aigc)) +
      "</div>" +
    "</div>";
  }
  // 月份范围合计
  function kpiTotalBlock() {
    var totalActual = { cost: 0, aigc: 0 }, totalTarget = { cost: 0, aigc: 0 };
    kpiMonths.forEach(function (m) {
      var a = getMonthActual(m);
      var t = kpiStore[m] || { cost: 0, aigc: 0 };
      totalActual.cost += a.cost; totalActual.aigc += a.aigc;
      totalTarget.cost += t.cost; totalTarget.aigc += t.aigc;
    });
    var range = kpiStore._range || {};
    var rangeLabel = (range.start || kpiMonths[0]) + " ~ " + (range.end || kpiMonths[kpiMonths.length - 1]);
    return "<div class='kpi-tot'>" +
      "<div style='font-weight:800;color:#223;margin-bottom:8px;font-size:14px'>🏁 合计考核（" + rangeLabel + " · 共 " + kpiMonths.length + " 个月）</div>" +
      "<div class='kpiw'>" +
        kpiRow("总消耗", "t", "cost", totalActual.cost, totalTarget.cost) +
        kpiRow("AIGC 消耗", "t", "aigc", totalActual.aigc, totalTarget.aigc) +
      "</div>" +
    "</div>";
  }
  // 月份范围筛选控件：起始月 + 结束月 + 快捷按钮
  function kpiRangeBar() {
    var range = kpiStore._range || { start: monthStr(-1), end: monthStr(0) };
    return "<div class='kpi-range-bar'>" +
      "<label class='kpi-range-lbl'>起始月份</label>" +
      "<input type='month' class='kpi-in me-kpi-start' value='" + range.start + "' style='width:auto'>" +
      "<label class='kpi-range-lbl'>结束月份</label>" +
      "<input type='month' class='kpi-in me-kpi-end' value='" + range.end + "' style='width:auto'>" +
      "<span class='kpi-range-sep'></span>" +
      "<button class='btn xs ghost me-kpi-now' data-start='" + monthStr(0) + "' data-end='" + monthStr(0) + "'>本月</button>" +
      "<button class='btn xs ghost me-kpi-now' data-start='" + monthStr(-1) + "' data-end='" + monthStr(0) + "'>最近 2 个月</button>" +
      "<button class='btn xs ghost me-kpi-now' data-start='" + monthStr(-2) + "' data-end='" + monthStr(0) + "'>最近 3 个月</button>" +
      "<button class='btn xs ghost me-kpi-quarter'>本季度</button>" +
      "<button class='btn xs ghost me-kpi-half'>上半年</button>" +
    "</div>";
  }
  // 轻量刷新：仅重算进度条与实际/目标数值，不动输入框（避免打字时失焦）
  function refreshKpiProgress() {
    Array.prototype.forEach.call(document.querySelectorAll(".me-kpi-bar"), function (bar) {
      var m = bar.getAttribute("data-m"), f = bar.getAttribute("data-f");
      var actual, t;
      if (m === "t") {
        actual = { cost: 0, aigc: 0 };
        t = { cost: 0, aigc: 0 };
        kpiMonths.forEach(function (mm) {
          var a = getMonthActual(mm);
          var tt = kpiStore[mm] || { cost: 0, aigc: 0 };
          actual.cost += a.cost; actual.aigc += a.aigc;
          t.cost += tt.cost; t.aigc += tt.aigc;
        });
      } else {
        actual = getMonthActual(m);
        t = kpiStore[m] || { cost: 0, aigc: 0 };
      }
      var a = actual[f], tg = t[f];
      var ratio = tg > 0 ? a / tg : 0, pct = Math.round(ratio * 100);
      var col = kpiColor(ratio, tg);
      bar.style.width = Math.min(100, pct) + "%"; bar.style.background = col;
      var row = bar.closest(".me-kpi-row");
      if (row) {
        var act = row.querySelector(".me-kpi-actual"); if (act) act.textContent = "实际 ¥" + fmtNum(a);
        var tgt = row.querySelector(".me-kpi-target"); if (tgt) tgt.textContent = "目标 ¥" + fmtNum(tg);
        var pc = row.querySelector(".me-kpi-pct"); if (pc) { pc.textContent = pct + "%"; pc.style.color = col; }
        var bd = row.querySelector(".me-kpi-badge"); if (bd) { bd.textContent = kpiState(ratio, tg); bd.style.background = col; }
        var gp = row.querySelector(".me-kpi-gap"); if (gp) gp.textContent = kpiGapTxt(a, tg);
      }
    });
  }
  function renderKpi() {
    var grid = el("meKpiGrid"); if (!grid) return;
    kpiStore._range = kpiStore._range || { start: monthStr(-1), end: monthStr(0) };
    // 兼容旧 count 格式
    if (kpiStore._range.count && !kpiStore._range.end) {
      var d = new Date(kpiStore._range.start + "-01T00:00:00");
      if (!isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + (parseInt(kpiStore._range.count, 10) || 2) - 1);
        kpiStore._range.end = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
      }
    }
    kpiMonths = getKpiMonths();
    saveKpiStore(kpiStore);
    var rangeBox = el("meKpiRange"); if (rangeBox) rangeBox.innerHTML = kpiRangeBar();
    var html = "";
    kpiMonths.forEach(function (m) {
      var actual = getMonthActual(m);
      var t = kpiStore[m] || { cost: 0, aigc: 0 };
      html += kpiMonthBlock(m, actual, t);
    });
    grid.className = "kpiw";
    grid.innerHTML = html;
    var tot = el("meKpiTotal"); if (tot) tot.innerHTML = kpiTotalBlock();
    bindKpi();
  }
  function bindKpi() {
    var startInp = document.querySelector(".me-kpi-start");
    var endInp = document.querySelector(".me-kpi-end");
    function applyRange(start, end) {
      if (!start || !end) return;
      if (start > end) { var tmp = start; start = end; end = tmp; }
      kpiStore._range = { start: start, end: end };
      saveKpiStore(kpiStore);
      renderKpi();
    }
    if (startInp) {
      startInp.onchange = function () { applyRange(startInp.value, kpiStore._range.end); };
    }
    if (endInp) {
      endInp.onchange = function () { applyRange(kpiStore._range.start, endInp.value); };
    }
    Array.prototype.forEach.call(document.querySelectorAll(".me-kpi-now"), function (btn) {
      btn.onclick = function () {
        var s = btn.getAttribute("data-start"), e = btn.getAttribute("data-end");
        if (s && e) applyRange(s, e);
      };
    });
    var qBtn = document.querySelector(".me-kpi-quarter");
    if (qBtn) {
      qBtn.onclick = function () {
        var d = new Date(); d.setDate(1);
        var q = Math.floor(d.getMonth() / 3);
        var sD = new Date(d.getFullYear(), q * 3, 1);
        var eD = new Date(d.getFullYear(), q * 3 + 2, 1);
        applyRange(sD.getFullYear() + "-" + ("0" + (sD.getMonth() + 1)).slice(-2), eD.getFullYear() + "-" + ("0" + (eD.getMonth() + 1)).slice(-2));
      };
    }
    var hBtn = document.querySelector(".me-kpi-half");
    if (hBtn) {
      hBtn.onclick = function () {
        var y = new Date().getFullYear();
        applyRange(y + "-01", y + "-06");
      };
    }
    Array.prototype.forEach.call(document.querySelectorAll(".me-kpi-target-input"), function (inp) {
      inp.oninput = function () {
        var m = inp.getAttribute("data-m");
        var f = inp.getAttribute("data-f");
        if (!kpiStore[m]) kpiStore[m] = { cost: 0, aigc: 0 };
        kpiStore[m][f] = num(inp.value) || 0;
        saveKpiStore(kpiStore);
        refreshKpiProgress();
      };
    });
  }

  // 当前自然月前缀（如 2026-08），所有「本月汇总」口径统一按此过滤
  function curMonthPrefix() {
    var t = new Date();
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2);
  }
  function monthRows(arr, dateField) {
    var p = curMonthPrefix();
    return arr.filter(function (r) { return (r[dateField] || "").slice(0, 7) === p; });
  }
  // 消耗汇总独立日期范围过滤（与素材面板各自独立）。未设置时默认当前自然月。
  function consRange() {
    if (!consStart && !consEnd) {
      var mp = curMonthPrefix();
      consStart = mp + "-01";
      consEnd = mp + "-" + ("0" + daysInMonth(+mp.slice(0, 4), +mp.slice(5, 7))).slice(-2);
    }
    return { s: consStart || "0000-01-01", e: consEnd || "9999-12-31" };
  }
  function consFiltered(arr, dateField) {
    var r = consRange();
    return arr.filter(function (x) {
      var d = (x[dateField] || "").replace(/\//g, "-").slice(0, 10);
      if (!d) return false;
      return d >= r.s && d <= r.e;
    });
  }
  /* ---------- 渲染：消耗汇总总入口（口径：独立日期范围） ---------- */
  function renderMonth() {
    var body = el("meMonthBody");
    if (!body) return;
    var r = consRange();
    var matM = consFiltered(matData, "日期");
    var histM = consFiltered(histData, "日期");
    var totalCost = 0, totalConv = 0;
    var totShow = 0, totClick = 0, matSet = {};
    matM.forEach(function (m) {
      totShow += num(m["展示数"]); totClick += num(m["点击数"]);
      if (m["素材ID"]) matSet[m["素材ID"]] = 1;
    });
    histM.forEach(function (h) { totalCost += num(h["消耗"]); totalConv += num(h["转化数"]); });
    var avgCTR = totShow > 0 ? totClick / totShow * 100 : 0;
    var distinctMat = Object.keys(matSet).length;
    var days = histM.length;
    var rangeTxt = r.s + " ~ " + r.e;
    var rg = el("meMonthRange"); if (rg) rg.textContent = "（" + rangeTxt + "）";
    var ci = el("consStart"); if (ci) ci.value = r.s;
    var ce = el("consEnd"); if (ce) ce.value = r.e;
    renderMonthCards(totalCost, totalConv, avgCTR, distinctMat, days);
    renderMonthChart();
    renderMonthMatTop();
    renderTimeTabs();   // 月/周/日 筛选标签
    renderTimeTable();  // 时间筛选明细
    renderWeek();       // 周统计
    renderUploadMonth();// 每月上传素材量 & AI 占比
  }

  /* ---------- 渲染：消耗渠道构成（今日 / 当月范围联动） ---------- */
  function classifyChannel(name) {
    name = (name || "").trim();
    if (name.indexOf("信息流") === 0) return "标点";
    if (name.indexOf("低活") >= 0) return "低活";
    return "广义新";
  }
  function renderChannelRows(rows, label, mode) {
    var sum = { "广义新": 0, "低活": 0, "标点": 0 };
    rows.forEach(function (m) { sum[classifyChannel(m["素材名"])] += num(m["消耗"]); });
    var total = sum["广义新"] + sum["低活"] + sum["标点"];
    var box = el("meChannelBars"), diff = el("meChannelDiff");
    var items = [["广义新", sum["广义新"], "var(--green)"], ["低活", sum["低活"], "var(--yellow)"], ["标点", sum["标点"], "var(--brand)"]];
    if (box) {
      box.innerHTML = items.map(function (it) {
        var nm = it[0], val = it[1], col = it[2];
        var p = total > 0 ? Math.round(val / total * 100) : 0;
        return "<div class='kpi'><div class='l'>" + esc(nm) + "</div>" +
          "<div class='v'>¥" + fmtNum(Math.round(val)) + "</div>" +
          "<div class='note' style='margin:2px 0 0'>占比 " + p + "%</div>" +
          "<div class='me-prog'><i style='width:" + p + "%;background:" + col + "'></i></div></div>";
      }).join("") || "<div class='empty'>暂无素材明细</div>";
    }
    if (diff) {
      diff.innerHTML = "数据日期：<b>" + esc(label) + "</b> ｜ 总消耗 <b>¥" + fmtNum(Math.round(total)) + "</b>" +
        (mode === "今日" ? " ｜ 较昨日同时段见上方 KPI 卡片" : " ｜ 按所选月份范围汇总");
    }
  }
  function renderChannelToday() {
    if (!matData.length) return;
    var byDate = {};
    matData.forEach(function (m) { var d = m["日期"]; if (d) (byDate[d] = byDate[d] || []).push(m); });
    var dates = Object.keys(byDate).sort();
    var latest = dates[dates.length - 1] || "";
    renderChannelRows(byDate[latest] || [], latest || "—", "今日");
  }
  function renderChannelByRange(start, end) {
    var s = start || "0000-01-01", e = end || "9999-12-31";
    var rows = matData.filter(function (m) {
      var d = (m["日期"] || "").replace(/\//g, "-").slice(0, 10);
      return d && d >= s && d <= e;
    });
    var label = (start && end) ? (start + " ~ " + end) : "所选范围";
    renderChannelRows(rows, label, "区间");
  }
  function isMonthTabActive() {
    var tabs = el("meCoreTabs"); if (!tabs) return false;
    var on = tabs.querySelector(".me-mtab.on");
    return on && on.getAttribute("data-v") === "month";
  }

  // ④ 个人素材统计：剪辑师李虹玉 · 上传时间口径 · 日/周/月/总 产出汇总
  // 口径：按创量【内容】页「上传时间」导出素材清单，按素材ID去重；AIGC 由【素材标签】列判定（enrich_tags 回接）。
  // upData 列：素材ID,素材名,上传人,上传时间（来自 me-uploads.csv）
  var upStart = null, upEnd = null, upGran = "total";  // 粒度：day / week / month / total
  var UP_UPLOADER = "李虹玉";                            // 仅统计个人（上传人含李虹玉）
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  // 取某行上传日期（优先上传时间列；缺失时从素材名 MMDD 兜底，年份取当前年）
  function upDateOf(row) {
    var s = row["上传时间"] || "";
    if (!s) {
      var nm = row["素材名"] || "";
      // 优先匹配 -YYYYMMDD-（如 -20260730-）
      var ym = nm.match(/-(20\d{2})(\d{2})(\d{2})-/);
      if (ym) s = ym[1] + "-" + ym[2] + "-" + ym[3];
      else {
        // 其次匹配 -MMDD-（如 -0803-），按当年兜底
        var mm = nm.match(/-(\d{2})(\d{2})-/);
        if (mm) s = new Date().getFullYear() + "-" + mm[1] + "-" + mm[2];
      }
    }
    if (!s) return "";
    return (s + "").replace(/\//g, "-").slice(0, 10);
  }
  // 上传人过滤 + 日期范围过滤
  function upFiltered() {
    return upData.filter(function (m) {
      var up = m["上传人"] || "";
      if (UP_UPLOADER && up.indexOf(UP_UPLOADER) < 0) return false;
      var d = upDateOf(m);
      if (!d) return false;
      if (upStart && d < upStart) return false;
      if (upEnd && d > upEnd) return false;
      return true;
    });
  }
  // 按粒度分组
  function upGroups(rows, gran) {
    var map = {};
    rows.forEach(function (m) {
      var d = upDateOf(m);
      if (!d) return;
      var key;
      if (gran === "day") key = d;
      else if (gran === "month") key = d.slice(0, 7);
      else if (gran === "week") key = isoWeekKey(d);
      else key = "总";
      if (!map[key]) map[key] = { key: key, label: key, total: 0, ai: 0 };
      map[key].total++;
      if (isAiMaterial(m["素材标签"], m["素材名"])) map[key].ai++;
    });
    var arr = Object.keys(map).map(function (k) { var g = map[k]; g.ratio = g.total ? g.ai / g.total : 0; return g; });
    if (gran !== "total") arr.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    return arr;
  }
  function upRenderView() {
    var body = el("meUploadBody"); if (!body) return;
    if (!upData.length) { body.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#9aa4b2">暂无素材明细数据（me-uploads.csv 未加载）</div>'; return; }

    // 默认范围：当前月
    if (!upStart && !upEnd) {
      var mp = curMonthPrefix();
      upStart = mp + "-01";
      upEnd = mp + "-" + ("0" + daysInMonth(+mp.slice(0, 4), +mp.slice(5, 7))).slice(-2);
    }

    var rows = upFiltered();
    var groups = upGroups(rows, upGran);

    // 区间汇总
    var total = 0, ai = 0;
    rows.forEach(function (m) { total++; if (isAiMaterial(m["素材标签"], m["素材名"])) ai++; });
    var ratio = total ? ai / total : 0;
    var ds = rows.map(function (m) { return upDateOf(m); }).filter(Boolean).sort();
    var dMin = ds.length ? ds[0] : "—", dMax = ds.length ? ds[ds.length - 1] : "—";
    var spanDays = 0;
    if (ds.length) {
      var a = new Date(dMin), z = new Date(dMax);
      spanDays = Math.max(1, Math.round((z - a) / 86400000) + 1);
    }
    var avg = spanDays ? total / spanDays : 0;

    var granTxt = { day: "日产出汇总", week: "周产出汇总", month: "月产出汇总", total: "总总素材汇总" }[upGran] || "汇总";

    // 工具栏：日期范围 + 粒度切换
    var granBtns = ["day","week","month","total"].map(function (g) {
      var lbl = { day: "日", week: "周", month: "月", total: "总" }[g];
      var on = upGran === g;
      return "<button data-g='" + g + "' class='me-seg" + (on ? " on" : "") + "' title='" + ({ day: "按上传日期日产出汇总", week: "ISO自然周汇总", month: "按上传月份汇总", total: "全部汇总" }[g]) + "'>" + lbl + "</button>";
    }).join("");
    var bar = "<div class='me-up-filter'>" +
      "<span class='me-up-filter-lbl'>📅 日期范围</span>" +
      "<input type='date' id='upStart' class='me-date-inp' value='" + upStart + "'>" +
      "<span class='me-up-filter-sep'>-</span>" +
      "<input type='date' id='upEnd' class='me-date-inp' value='" + upEnd + "'>" +
      "<button id='upApply' class='me-btn me-btn-primary'>应用</button>" +
      "<button id='upAll' class='me-btn'>全部</button>" +
      "<span class='me-up-filter-sep' style='margin-left:auto'></span>" +
      "<span class='me-up-filter-lbl'>汇总维度</span>" +
      "<span class='me-seg-group'>" + granBtns + "</span>" +
      "</div>";

    // 汇总 tiles
    var tiles = "<div class='me-up-tiles me-up-tiles-4'>" +
      "<div class='me-up-tile'><div class='lab'>总素材量</div><div class='big'>" + fmtNum(total) + "</div><div class='sub'>" + dMin + " ~ " + dMax + "</div></div>" +
      "<div class='me-up-tile ai'><div class='lab'>AIGC 占比</div><div class='big'>" + (ratio * 100).toFixed(1) + "%</div><div class='sub'>AI " + fmtNum(ai) + " / " + fmtNum(total) + "</div></div>" +
      "<div class='me-up-tile day'><div class='lab'>日均产出</div><div class='big'>" + avg.toFixed(1) + "</div><div class='sub'>区间 " + spanDays + " 天</div></div>" +
      "<div class='me-up-tile forecast'><div class='lab'>总产出</div><div class='big'>" + fmtNum(total) + "</div><div class='sub'>素材ID去重 · 上传时间口径</div></div>" +
      "</div>";

    // 明细表
    var table = "";
    if (groups.length) {
      var maxV = 1; groups.forEach(function (g) { if (g.total > maxV) maxV = g.total; });
      var rowsHtml = groups.map(function (g) {
        var w = Math.max(2, Math.round(g.total / maxV * 100));
        return "<tr><td class='l'>" + esc(g.label) + "</td><td>" + fmtNum(g.total) + "</td><td>" + fmtNum(g.ai) + "</td><td>" + (g.ratio * 100).toFixed(1) + "%" +
          "<td class='bar'><div style='height:6px;background:#eef2f7;border-radius:3px;overflow:hidden'><i style='display:block;height:100%;width:" + w + "%;background:linear-gradient(90deg,#4a7bff,#7a5cff)'></i></div></td></tr>";
      }).join("");
      var totalRow = (upGran !== "total")
        ? "<tr class='me-up-sum'><td class='l'>合计</td><td>" + fmtNum(total) + "</td><td>" + fmtNum(ai) + "</td><td>" + (ratio * 100).toFixed(1) + "%</td><td></td></tr>"
        : "";
      table = "<div class='me-up-tbl-hd'>" + granTxt + "</div>" +
        "<table class='me-rank-tbl me-up-tbl'><thead><tr><th class='l'>期次</th><th>素材量</th><th>AI素材</th><th>AIGC占比</th><th class='bar-h'></th></tr></thead><tbody>" + rowsHtml + totalRow + "</tbody></table>";
    } else {
      table = "<div class='empty' style='padding:24px;text-align:center;color:#9aa4b2;background:#fbfcff;border:1px dashed #e0e6ef;border-radius:10px;margin-top:12px'>该范围内暂无素材</div>";
    }

    var note = "<div class='me-up-note'>统计口径：数据来源 me-uploads.csv —— 由创量【内容】页「高级筛选(上传时间) → 导出 → 导出素材信息」<strong>逐月导出的平台原始清单</strong>合并而成，「上传时间」为创量后台<strong>真实上传时间戳（精确到秒）</strong>，非任何推算值。按素材ID去重、仅统计上传人含「李虹玉」的素材。素材名命中 AIGC 标签片段(aigc/可灵/sd2.0/空镜/seedance/万相/comfyui)记为 AIGC 素材。日=按上传日期、周=ISO自然周、月=按上传月份汇总产出；日均产出=区间素材量÷区间跨度天数。</div>";

    body.innerHTML = bar + tiles + table + note;

    // 事件绑定
    var apply = el("upApply"); if (apply) apply.onclick = function () {
      var s = el("upStart"), e = el("upEnd");
      upStart = s ? s.value : null; upEnd = e ? e.value : null;
      upRenderView();
    };
    var all = el("upAll"); if (all) all.onclick = function () {
      var ds2 = upData.map(function (m) { return upDateOf(m); }).filter(Boolean).sort();
      upStart = ds2.length ? ds2[0] : null;
      upEnd = ds2.length ? ds2[ds2.length - 1] : null;
      upRenderView();
    };
    Array.prototype.forEach.call(body.querySelectorAll(".me-seg"), function (btn) {
      btn.onclick = function () { upGran = btn.getAttribute("data-g"); upRenderView(); };
    });
  }
  function renderUploadMonth() {
    upRenderView();
  }

  function renderPersonal() {
    renderRank();
  }

  /* ---------- 时间筛选下拉 ---------- */
  function buildDateSelect() {
    var sel = el("meDate");
    if (!sel) return;
    sel.innerHTML = dates.slice().reverse().map(function (d) {
      var label = (d === todayStr()) ? d + "（今日·实时）" : d;
      return "<option value='" + d + "'" + (d === currentDate ? " selected" : "") + ">" + label + "</option>";
    }).join("");
  }
  function todayStr() {
    var t = new Date();
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
  }

  /* ---------- 数据加载 ---------- */
  function loadData(cb, force) {
    var q = force ? ("&_=" + Date.now()) : "";  // 三个 URL 均带 ?v=，force 时用 & 追加防缓存
    var opt = force ? { cache: "no-store" } : undefined;
    Promise.all([
      fetch(HIST_URL + q, opt).then(function (r) { return r.text(); }),
      fetch(MAT_URL + q, opt).then(function (r) { return r.text(); }),
      fetch(UPLOAD_URL + q, opt).then(function (r) { return r.text(); })
    ]).then(function (res) {
      histData = csvToObjects(res[0]);
      matData = csvToObjects(res[1]);
      upData = csvToObjects(res[2]);   // 当月按上传时间统计的素材清单
      detectMediaKeys();   // 探测素材预览/封面链接列
      var ds = {};
      histData.forEach(function (h) { ds[h["日期"]] = 1; });
      matData.forEach(function (m) { if (m["日期"]) ds[m["日期"]] = 1; });
      dates = Object.keys(ds).sort();
      if (dateAuto) currentDate = todayStr();   // 实时默认今天（刷新时若仍为自动模式则重新对齐今日）
      if (!currentDate || ds[currentDate] === undefined) {
        currentDate = dates.length ? dates[dates.length - 1] : todayStr();
      }
      ready = true;
      buildDateSelect();
      renderPersonal();
      renderMonth();
      renderKpi();
      if (cb) cb(null);
    }).catch(function (e) {
      var box = el("meRankBody");
      if (box) box.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#c33">数据加载失败：' + esc(e.message || e) + "</div>";
      if (cb) cb(e);
    });
  }

  /* ---------- 注入样式 ---------- */
  function injectStyle() {
    if (document.getElementById("meEnhStyle")) return;
    var s = document.createElement("style");
    s.id = "meEnhStyle";
    s.textContent =
      ".me-rank-tbl{width:100%;border-collapse:collapse;font-size:13px;color:#2b3340}" +
      ".me-rank-tbl th,.me-rank-tbl td{padding:7px 10px;border-bottom:1px solid #f0f3f7;text-align:right;white-space:nowrap}" +
      ".me-rank-tbl th.l,.me-rank-tbl td.l{text-align:left}" +
      ".me-rank-tbl thead th{position:sticky;top:0;background:#f6f8fb;color:#5a6678;font-weight:600;z-index:1}" +
      ".me-rank-tbl th.on{color:#2b6cff}" +
      ".me-rank-tbl tbody tr:hover{background:#f7faff}" +
      ".me-rank-tbl td.rk{color:#9aa4b2;font-weight:600;width:34px}" +
      ".me-sid{color:#2b6cff;cursor:pointer;font-family:ui-monospace,Menlo,Consolas,\"Courier New\",monospace;font-size:12px;text-decoration:none;border-bottom:1px dashed #a9c2ff;display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}" +
      ".me-sid:hover{color:#1746c4;border-bottom-color:#1746c4}" +
      ".me-rank-tbl tbody tr{cursor:pointer}" +
      ".me-rank-tbl tbody tr:hover{background:#f1f6ff}" +
      ".me-rank-tbl tbody tr:active{background:#e4eeff}" +
      ".me-enh-toolbar select:focus{outline:none;border-color:#2b6cff}" +
      ".me-play{padding:2px 9px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#2b6cff;cursor:pointer;font-size:12px;line-height:1.4}" +
      ".me-play:hover{background:#eef4ff}" +
      ".me-prev-h{width:56px}" +
      ".me-prev-cell{width:46px;text-align:center}" +
      ".me-prev-row td{background:#f7faff;padding:12px;text-align:left}" +
      ".me-cover-h{width:64px}" +
      ".me-cover-cell{width:56px;text-align:center;padding:4px!important}" +
      ".me-thumb{width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e6ebf2;background:#f6f8fb;cursor:zoom-in}" +
      ".me-thumb:hover{box-shadow:0 2px 8px rgba(43,108,255,.2)}" +
      ".me-up-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 14px;padding:10px 12px;background:#f6f8fb;border:1px solid #e6ebf2;border-radius:10px}" +
      ".me-up-filter-lbl{font-size:13px;color:#556;font-weight:600;white-space:nowrap}" +
      ".me-up-filter-sep{color:#aab3c2;font-size:13px;padding:0 2px}" +
      ".me-date-inp{padding:6px 8px;border:1px solid #cdd6e3;border-radius:8px;font-size:13px;color:#334;background:#fff;min-width:122px}" +
      ".me-date-inp:focus{outline:none;border-color:#4a7bff;box-shadow:0 0 0 3px rgba(74,123,255,.12)}" +
      ".me-btn{padding:6px 14px;border:1px solid #cdd6e3;border-radius:8px;background:#fff;color:#334;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}" +
      ".me-btn:hover{background:#f6f8fb;border-color:#b8c2d3}" +
      ".me-btn-primary{background:#4a7bff;border-color:#4a7bff;color:#fff}" +
      ".me-btn-primary:hover{background:#3a6bef;border-color:#3a6bef}" +
      ".me-seg-group{display:inline-flex;gap:0;border:1px solid #cdd6e3;border-radius:8px;overflow:hidden;background:#fff}" +
      ".me-seg{padding:6px 14px;border:0;border-right:1px solid #e6ebf2;background:#fff;color:#556;font-size:13px;cursor:pointer;transition:all .15s}" +
      ".me-seg:last-child{border-right:0}" +
      ".me-seg:hover{background:#f3f7ff;color:#2b6cff}" +
      ".me-seg.on{background:#4a7bff;color:#fff}" +
      ".me-seg.on:hover{background:#3a6bef}" +
      ".me-up-tiles{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}" +
      ".me-up-tiles-4{grid-template-columns:repeat(4,1fr)}" +
      "@media (max-width:900px){.me-up-tiles-4{grid-template-columns:1fr 1fr}}" +
      ".me-up-tile{border:1px solid #e6ebf2;border-radius:14px;padding:18px 16px;background:linear-gradient(135deg,#fbfcff,#f3f7ff)}" +
      ".me-up-tile .lab{font-size:13px;color:#8a94a6;font-weight:600;letter-spacing:.5px}" +
      ".me-up-tile .big{font-size:36px;font-weight:800;line-height:1.1;margin:6px 0 2px;color:#1f2a3a}" +
      ".me-up-tile.ai{background:linear-gradient(135deg,#fbf9ff,#f3eeff)}" +
      ".me-up-tile.ai .big{color:#7a5cff}" +
      ".me-up-tile.day{background:linear-gradient(135deg,#f6fffb,#e8f8f0)}" +
      ".me-up-tile.day .big{color:#0e9f6e}" +
      ".me-up-tile.forecast{background:linear-gradient(135deg,#fff9f3,#fff0e3)}" +
      ".me-up-tile.forecast .big{color:#f59e0b}" +
      ".me-up-tile .sub{font-size:12.5px;color:#8a94a6}" +
      ".me-up-tbl-hd{font-weight:700;margin:14px 0 8px;color:#334;font-size:13.5px}" +
      ".me-up-tbl td.bar,.me-up-tbl th.bar-h{width:38%;min-width:140px}" +
      ".me-up-tbl tbody tr.me-up-sum{background:#f6f8fb;font-weight:600}" +
      ".me-up-note{padding:10px 2px 0;color:#8a94a6;font-size:12px;line-height:1.6}" +
      ".me-up-chart{display:flex;align-items:flex-end;gap:10px;margin-bottom:4px}" +
      ".me-up-bar{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}" +
      ".me-up-bar .bararea{height:150px;width:100%;display:flex;align-items:flex-end;justify-content:center}" +
      ".me-up-bar .barwrap{width:62%;max-width:50px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;border-radius:8px 8px 0 0;overflow:hidden;background:#eef2f7}" +
      ".me-up-bar .fill{width:100%;background:#2b6cff}" +
      ".me-up-bar .aifill{width:100%;background:#7a5cff}" +
      ".me-up-bar .mval{font-size:12.5px;font-weight:700;color:#1f2a3a;margin-bottom:4px;white-space:nowrap}" +
      ".me-up-bar .mlab{font-size:11.5px;color:#5a6678;margin-top:6px;white-space:nowrap}" +
      ".me-merge-tabs{display:inline-flex;border:1px solid #e6ebf2;border-radius:10px;overflow:hidden;background:#f6f8fb;margin:0 0 14px}" +
      ".me-mtab{padding:8px 18px;border:0;background:#f6f8fb;color:#556;font-size:13.5px;font-weight:600;cursor:pointer;transition:all .15s}" +
      ".me-mtab.on{background:#4a7bff;color:#fff}" +
      ".me-mtab:hover:not(.on){background:#eef4ff}";
    document.head.appendChild(s);
  }

  /* ---------- 注入 UI ---------- */
  // 优先挂载到 index.html 预留的分区槽位（slotXXX）；槽位不存在时回退到旧的「追加到上一面板后」方式
  function mountPanel(slotId, node, fallbackRef) {
    var s = el(slotId);
    if (s) { s.appendChild(node); return node; }
    if (fallbackRef && fallbackRef.parentNode) fallbackRef.parentNode.insertBefore(node, fallbackRef.nextSibling);
    return node;
  }
  function panelHd(title, tagHtml, tip) {
    return "<h2 style='display:flex;align-items:center;gap:8px;flex-wrap:wrap'>" + title +
      (tagHtml ? " <span class='tag'>" + tagHtml + "</span>" : "") +
      (tip ? "<span style='margin-left:auto;color:#8a94a6;font-size:12px;font-weight:400'>" + tip + "</span>" : "") +
      "</h2>";
  }
  var BOXCSS = "max-height:460px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff";

  function injectUI() {
    injectStyle();
    var me = el("me");
    if (!me) return;
    // 工具栏：时间筛选（优先挂到「数据源」卡内）
    var srcCard = el("meSrcCard") || me;
    var h2 = srcCard.querySelector("h2") || me.querySelector("h2");
    var bar = document.createElement("div");
    bar.className = "me-enh-toolbar";
    bar.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 10px;padding:10px 12px;background:#f6f8fb;border:1px solid #e6ebf2;border-radius:10px;";
    bar.innerHTML =
      '<span style="font-weight:600;color:#334">📅 时间筛选：</span>' +
      "<select id='meDate' style='padding:6px 10px;border:1px solid #cdd6e3;border-radius:8px;font-size:14px;min-width:160px'></select>" +
      "<button id='meRefresh' type='button' style='padding:6px 12px;border:1px solid #4a7bff;background:#fff;color:#4a7bff;border-radius:8px;font-size:13px;cursor:pointer'>🔄 实时刷新</button>" +
      "<span style='color:#8a94a6;font-size:12px'>默认显示今日实时数据；手动选日期后刷新会尊重所选日</span>";
    if (h2 && h2.parentNode) h2.parentNode.insertBefore(bar, h2.nextSibling);

    var cards = el("meCards");

    // ② 素材数据 — 当日素材排行
    var panel = document.createElement("div");
    panel.id = "meRank";
    panel.innerHTML =
      panelHd("🏆 每日素材消耗排行榜 <span id='meRankCount' style='font-size:12px;color:#8a94a6;font-weight:400'></span>", "", "当日素材按消耗倒序 · 点击表头可切换排序指标") +
      "<div id='meRankBody' style='" + BOXCSS + "'></div>";
    mountPanel("slotMeRank", panel, cards);

    // ② 素材数据 — 本月素材消耗 Top50
    var matTopPanel = document.createElement("div");
    matTopPanel.id = "meMatTop";
    matTopPanel.innerHTML =
      panelHd("📦 本月素材消耗 Top 50", "本月累计", "点击表头排序") +
      "<div id='meMonthMatTop' style='max-height:440px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff'></div>";
    mountPanel("slotMeMatTop", matTopPanel, panel);

    // ③ 周数据 — 周统计
    var weekPanel = document.createElement("div");
    weekPanel.id = "meWeek";
    weekPanel.innerHTML =
      panelHd("📈 周统计", "按自然周切分本月 · 每周 7 天", "周消耗 / 日均 / 周转化 / 周均素材") +
      "<div id='meWeekTable' style='max-height:420px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff'></div>";
    mountPanel("slotMeWeek", weekPanel, matTopPanel);

    // ③ 周数据 — 月 / 周 / 日 时间筛选明细
    var timePanel = document.createElement("div");
    timePanel.id = "meTimePanel";
    timePanel.innerHTML =
      "<h2 style='display:flex;align-items:center;gap:10px;flex-wrap:wrap'>📅 时间筛选明细 <span class='tag'>月 / 周 / 日 三种口径</span>" +
        "<span id='meTimeTabs' style='display:flex;gap:6px;margin-left:auto'>" +
          "<button data-mode='month' style='padding:5px 12px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#334;font-size:13px;cursor:pointer'>月筛选</button>" +
          "<button data-mode='week' style='padding:5px 12px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#334;font-size:13px;cursor:pointer'>周筛选</button>" +
          "<button data-mode='day' style='padding:5px 12px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#334;font-size:13px;cursor:pointer'>日筛选</button>" +
        "</span>" +
      "</h2>" +
      "<div id='meTimeTable' style='max-height:420px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff'></div>";
    mountPanel("slotMeTime", timePanel, weekPanel);

    // ④ 月度汇总
    var monthPanel = document.createElement("div");
    monthPanel.id = "meMonth";
    monthPanel.innerHTML =
      "<div id='meMonthRange' style='font-size:12px;color:#8a94a6;margin:0 0 12px'></div>" +
      "<div id='meMonthBody'>" +
        "<div class='me-cons-filter' style='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 16px;padding:10px 12px;background:#f6f8fc;border:1px solid #e6ebf2;border-radius:10px'>" +
          "<span style='font-size:13px;color:#556;font-weight:600'>日期筛选</span>" +
          "<input id='consStart' type='date' style='padding:5px 8px;border:1px solid #cdd6e3;border-radius:6px;font-size:13px;color:#334'>" +
          "<span style='color:#889'>-</span>" +
          "<input id='consEnd' type='date' style='padding:5px 8px;border:1px solid #cdd6e3;border-radius:6px;font-size:13px;color:#334'>" +
          "<button id='consApply' style='padding:5px 14px;border:1px solid #4a7bff;background:#4a7bff;color:#fff;border-radius:6px;font-size:13px;cursor:pointer'>应用</button>" +
          "<button id='consAll' style='padding:5px 14px;border:1px solid #cdd6e3;background:#fff;color:#334;border-radius:6px;font-size:13px;cursor:pointer'>本月</button>" +
          "<span style='font-size:12px;color:#8a94a6;margin-left:auto'>与「个人素材统计」各自独立筛选</span>" +
        "</div>" +
        "<div id='meMonthCards' style='display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px'></div>" +
        "<div style='font-weight:700;margin:0 0 8px;color:#334;font-size:13.5px'>每日消耗走势</div>" +
        "<div id='meMonthChart' style='display:flex;align-items:flex-end;gap:3px;height:150px;padding:0 2px 18px;border-bottom:1px solid #eef2f7'></div>" +
      "</div>";
    mountPanel("slotMeMonth", monthPanel, timePanel);

    // ④ 个人素材统计（剪辑师李虹玉 · 当月素材量 & AI占比 & 日均产能）
    var uploadPanel = document.createElement("div");
    uploadPanel.id = "meUpload";
    uploadPanel.innerHTML =
      panelHd("📦 个人素材统计", "剪辑师李虹玉 · 真实上传时间口径 · 日/周/月/总汇总", "创量原始导出 · 素材ID去重 · 区间+维度可切换") +
      "<div id='meUploadBody'></div>";
    mountPanel("slotMeUpload", uploadPanel, matTopPanel);

    // ⑤ KPI 绩效
    var kpiPanel = document.createElement("div");
    kpiPanel.id = "meKpi";
    kpiPanel.innerHTML =
      panelHd("🎯 KPI 绩效进度", "自定义月份范围 · 消耗自动关联", "") +
      "<div class='note' style='margin:0 0 14px'>选择起始月份与统计月数，填写 KPI 目标，实际消耗（总消耗、AIGC 消耗）按所选月份自动汇总；目标保存在本地，下次打开仍在。</div>" +
      "<div id='meKpiRange'></div>" +
      "<div id='meKpiGrid' class='kpiw'></div>" +
      "<div id='meKpiTotal'></div>";
    mountPanel("slotMeKpi", kpiPanel, monthPanel);

    // 本月汇总折叠（旧版兼容，新版由分区标题的「收起」控制）
    var toggle = el("meMonthToggle");
    if (toggle) toggle.onclick = function () {
      var b = el("meMonthBody");
      var collapsed = b.style.display === "none";
      b.style.display = collapsed ? "block" : "none";
      var ar = el("meMonthArrow"); if (ar) ar.textContent = collapsed ? "▾ 收起" : "▸ 展开";
    };

    // 事件
    var sel = el("meDate");
    if (sel) sel.onchange = function () { currentDate = sel.value; dateAuto = false; renderPersonal(); };
    var rf = el("meRefresh");
    if (rf) rf.onclick = function () {
      rf.disabled = true; rf.textContent = "刷新中…";
      loadData(function () { rf.disabled = false; rf.textContent = "🔄 实时刷新"; }, true);
    };

    // 月/周/日 筛选标签事件
    var tabs = el("meTimeTabs");
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll("button[data-mode]"), function (btn) {
        btn.onclick = function () { setTimeMode(btn.getAttribute("data-mode")); };
      });
    }

    // 消耗汇总独立日期范围筛选
    var cApply = el("consApply");
    if (cApply) cApply.onclick = function () {
      var s = el("consStart"), e = el("consEnd");
      var sv = s ? (s.value || "").trim() : "";
      var ev = e ? (e.value || "").trim() : "";
      if (sv && !/^\d{4}-\d{2}-\d{2}$/.test(sv)) { alert("起始日期格式应为 YYYY-MM-DD"); return; }
      if (ev && !/^\d{4}-\d{2}-\d{2}$/.test(ev)) { alert("结束日期格式应为 YYYY-MM-DD"); return; }
      if (sv && ev && sv > ev) { alert("起始日期不能晚于结束日期"); return; }
      consStart = sv || null; consEnd = ev || null;
      renderMonth();
      if (isMonthTabActive()) renderChannelByRange(consStart, consEnd);
    };
    var cAll = el("consAll");
    if (cAll) cAll.onclick = function () {
      consStart = null; consEnd = null;
      renderMonth();
      if (isMonthTabActive()) { var r = consRange(); renderChannelByRange(r.s, r.e); }
    };

    // 双月绩效 KPI 进度（首次渲染，数据到达后 loadData 会再刷新实际值）
    renderKpi();
    // 个人数据 / 当月汇总 合并面板 Tab 切换
    bindMeMerge();
  }
  function bindMeMerge() {
    var tabs = el("meCoreTabs");
    if (!tabs) return;
    var btns = tabs.querySelectorAll(".me-mtab");
    Array.prototype.forEach.call(btns, function (btn) {
      btn.onclick = function () {
        var v = btn.getAttribute("data-v");
        Array.prototype.forEach.call(btns, function (x) { x.classList.toggle("on", x === btn); });
        var today = el("meCoreToday"), mo = el("slotMeMonth");
        if (today) today.style.display = (v === "today") ? "block" : "none";
        if (mo) mo.style.display = (v === "month") ? "block" : "none";
        // 渠道构成随 Tab 联动：今日=最新一天，当月=当前消耗汇总日期范围
        if (v === "month") { var r = consRange(); renderChannelByRange(r.s, r.e); }
        else { renderChannelToday(); }
      };
    });
  }

  /* ---------- 不再覆盖主文件的 KPI 渲染，仅避免旧 personal-enhance 冲突 ---------- */
  function hookDashboard() {
    // 本脚本不再负责 #meCards 指标卡，也不再覆盖 window.renderMe / window.meApplyRows。
    // 若历史页面存在旧版自动刷新实例，可安全忽略；主文件 index.html 的 ME 模块会自行管理。
    try { if (window.meStop) window.meStop(); } catch (e) {}
  }

  /* ---------- 初始化 ---------- */
  function init() {
    hookDashboard();
    injectUI();
    loadData();
    setInterval(function () { loadData(); }, 5 * 60 * 1000);
    var rb = el("meRefresh");
    if (rb) rb.onclick = function () { loadData(null, true); };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
