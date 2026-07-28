/* 个人数据增强：素材数据排行 + 时间筛选
 * 注入到「个人数据」模块(#me)，读取仓库内的 me-materials.csv / me-history.csv
 * 通过接管 renderMe / meApplyRows 以避免与原看板自动刷新冲突。
 */
(function () {
  "use strict";
  var HIST_URL = "https://cdn.jsdelivr.net/gh/Hy088/chuangliang-data_625@main/me-history.csv";
  var MAT_URL  = "https://cdn.jsdelivr.net/gh/Hy088/chuangliang-data_625@main/me-materials.csv";

  // KPI 卡片定义（含目标，与 config.daily.json 一致）
  var CARDS = [
    { name: "今日消耗",      key: "消耗",   target: 15000, unit: "元" },
    { name: "今日在投素材数", key: "素材数", target: 650,   unit: "个" },
    { name: "今日转化数",     key: "转化数", target: 500,   unit: "个" },
    { name: "点击率(CTR)",    key: "CTR",    target: 8,     unit: "%" }
  ];
  // 排行可排序指标
  var RANK_METRICS = [
    { key: "消耗",   label: "消耗" },
    { key: "展示数", label: "展示数" },
    { key: "点击数", label: "点击数" },
    { key: "转化数", label: "转化数" },
    { key: "CTR",    label: "CTR" }
  ];

  var histData = [];   // [{日期,消耗,素材数,转化数,CTR}]
  var matData = [];    // [{日期,素材ID,素材名,消耗,展示数,点击数,转化成本,转化数,CTR}]
  var dates = [];      // 升序日期
  var currentDate = null;
  var sortKey = "消耗";
  var ready = false;

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

  /* ---------- 渲染：KPI 卡片 ---------- */
  function renderCards() {
    var cards = el("meCards");
    if (!cards) return;
    var hr = histData.filter(function (h) { return h["日期"] === currentDate; })[0];
    var html = "";
    CARDS.forEach(function (c) {
      var val = hr ? num(hr[c.key]) : 0;
      var tgt = c.target;
      var ratio = tgt > 0 ? Math.min(1, val / tgt) : 0;
      var pct = Math.round(ratio * 100);
      var color = !tgt ? "var(--gray)" : (ratio >= 1 ? "var(--green)" : (ratio >= 0.6 ? "var(--yellow)" : "var(--red)"));
      var valTxt = (c.key === "CTR") ? (val.toFixed(2) + "%") : fmtNum(val);
      html += '<div class="kpi"><div class="l">' + esc(c.name) + "</div>" +
        '<div class="v">' + valTxt + (c.unit ? ' <small>' + esc(c.unit) + "</small>" : "") + "</div>" +
        '<div class="note" style="margin:2px 0 0">目标 ' + fmtNum(tgt) + (c.unit && c.unit !== "%" ? esc(c.unit) : "") + "</div>" +
        '<div class="me-prog"><i style="width:' + Math.min(100, pct) + "%;background:" + color + '"></i></div></div>';
    });
    cards.innerHTML = html;
  }

  /* ---------- 渲染：素材排行 ---------- */
  function renderRank() {
    var box = el("meRankBody");
    if (!box) return;
    var rows = matData.filter(function (m) { return m["日期"] === currentDate; });
    rows.sort(function (a, b) { return num(b[sortKey]) - num(a[sortKey]); });
    if (!rows.length) {
      box.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#999">该日期暂无素材明细数据</div>';
      var cnt = el("meRankCount"); if (cnt) cnt.textContent = "共 0 个素材";
      return;
    }
    var max = num(rows[0][sortKey]) || 1;
    var thead = "<tr><th>#</th><th class='l'>素材名</th>" + RANK_METRICS.map(function (m) {
      return "<th data-key='" + m.key + "' class='" + (m.key === sortKey ? "on" : "") + "'>" + m.label + (m.key === sortKey ? " ↓" : "") + "</th>";
    }).join("") + "</tr>";
    var tbody = rows.map(function (m, idx) {
      var v = num(m[sortKey]);
      var w = Math.max(2, Math.round(v / max * 100));
      var name = m["素材名"] || m["素材ID"] || "(未命名)";
      var disp = name.length > 38 ? name.slice(0, 38) + "…" : name;
      var cells = RANK_METRICS.map(function (met) {
        var val = num(m[met.key]);
        var txt = (met.key === "CTR") ? val.toFixed(2) + "%" : fmtNum(val);
        var bar = (met.key === sortKey)
          ? "<div style='margin-top:3px;height:4px;background:#e8edf3;border-radius:3px;overflow:hidden'><i style='display:block;height:100%;width:" + w + "%;background:#4a7bff'></i></div>"
          : "";
        return "<td>" + txt + bar + "</td>";
      }).join("");
      return "<tr><td class='rk'>" + (idx + 1) + "</td><td class='l' title='" + esc(name) + "'>" + esc(disp) + "</td>" + cells + "</tr>";
    }).join("");
    box.innerHTML = "<table class='me-rank-tbl'><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
    // 表头点击排序
    Array.prototype.forEach.call(box.querySelectorAll("th[data-key]"), function (th) {
      th.style.cursor = "pointer";
      th.onclick = function () { sortKey = th.getAttribute("data-key"); renderRank(); };
    });
    var cnt = el("meRankCount"); if (cnt) cnt.textContent = "共 " + rows.length + " 个素材（按" + (RANK_METRICS.filter(function (m){return m.key===sortKey;})[0].label) + "排序）";
  }

  function renderPersonal() {
    renderCards();
    renderRank();
  }

  /* ---------- 时间筛选下拉 ---------- */
  function buildDateSelect() {
    var sel = el("meDate");
    if (!sel) return;
    sel.innerHTML = dates.slice().reverse().map(function (d) {
      var label = (d === currentDate && d === todayStr()) ? d + "（今日）" : d;
      return "<option value='" + d + "'" + (d === currentDate ? " selected" : "") + ">" + label + "</option>";
    }).join("");
  }
  function todayStr() {
    var t = new Date();
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
  }

  /* ---------- 数据加载 ---------- */
  function loadData(cb) {
    Promise.all([
      fetch(HIST_URL, { cache: "no-store" }).then(function (r) { return r.text(); }),
      fetch(MAT_URL, { cache: "no-store" }).then(function (r) { return r.text(); })
    ]).then(function (res) {
      histData = csvToObjects(res[0]);
      matData = csvToObjects(res[1]);
      var ds = {};
      histData.forEach(function (h) { ds[h["日期"]] = 1; });
      matData.forEach(function (m) { if (m["日期"]) ds[m["日期"]] = 1; });
      dates = Object.keys(ds).sort();
      if (!currentDate || ds[currentDate] === undefined) {
        currentDate = dates.length ? dates[dates.length - 1] : todayStr();
      }
      ready = true;
      buildDateSelect();
      renderPersonal();
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
      ".me-enh-toolbar select:focus{outline:none;border-color:#2b6cff}";
    document.head.appendChild(s);
  }

  /* ---------- 注入 UI ---------- */
  function injectUI() {
    injectStyle();
    var me = el("me");
    if (!me) return;
    // 工具栏：时间筛选
    var h2 = me.querySelector("h2");
    var bar = document.createElement("div");
    bar.className = "me-enh-toolbar";
    bar.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 14px;padding:10px 12px;background:#f6f8fb;border:1px solid #e6ebf2;border-radius:10px;";
    bar.innerHTML =
      '<span style="font-weight:600;color:#334">📅 时间筛选：</span>' +
      "<select id='meDate' style='padding:6px 10px;border:1px solid #cdd6e3;border-radius:8px;font-size:14px;min-width:160px'></select>" +
      "<span style='color:#8a94a6;font-size:12px'>切换日期查看当日 KPI 与素材情况（历史自今日起逐日累积）</span>";
    if (h2 && h2.parentNode) h2.parentNode.insertBefore(bar, h2.nextSibling);

    // 排行面板
    var cards = el("meCards");
    var panel = document.createElement("div");
    panel.id = "meRank";
    panel.style.cssText = "margin-top:18px;";
    panel.innerHTML =
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'>" +
        "<h3 style='margin:0;font-size:16px;color:#223'>🏆 素材数据排行 <span id='meRankCount' style='font-size:12px;color:#8a94a6;font-weight:400'></span></h3>" +
        "<span style='color:#8a94a6;font-size:12px'>点击表头可切换排序指标</span>" +
      "</div>" +
      "<div id='meRankBody' style='max-height:460px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff'></div>";
    if (cards && cards.parentNode) cards.parentNode.insertBefore(panel, cards.nextSibling);

    // 事件
    var sel = el("meDate");
    if (sel) sel.onchange = function () { currentDate = sel.value; renderPersonal(); };
  }

  /* ---------- 接管原看板渲染，避免冲突 ---------- */
  function hookDashboard() {
    try { if (window.meStop) window.meStop(); } catch (e) {}
    if (window.ME && window.ME.cfg) window.ME.cfg.auto = false;
    // renderMe 不再触碰个人模块 DOM（改为由本脚本渲染）
    window.renderMe = function () {};
    // meApplyRows 触发本脚本渲染（忽略原 rows，改用历史/明细数据）
    window.meApplyRows = function () { if (ready) renderPersonal(); };
  }

  /* ---------- 初始化 ---------- */
  function init() {
    hookDashboard();
    injectUI();
    loadData();
    // 每 5 分钟静默刷新一次（自动化每小时推送新数据）
    setInterval(function () { loadData(); }, 5 * 60 * 1000);
    // 接管「立即刷新」按钮
    var rb = el("meRefresh");
    if (rb) rb.onclick = function () { loadData(); };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
