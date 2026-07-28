/* 个人数据增强：素材数据排行 + 时间筛选 + 本月每日明细 + 周统计
 * 注入到「个人数据」模块(#me)，读取仓库内的 me-materials.csv / me-history.csv
 * 通过接管 renderMe / meApplyRows 以避免与原看板自动刷新冲突。
 */
(function () {
  "use strict";
  // 数据同源托管在 GitHub Pages（与看板同域，避免 jsDelivr 旧缓存导致历史月份丢失）
  var HIST_URL = "https://hy088.github.io/chuangliang-data_625/me-history.csv";
  var MAT_URL  = "https://hy088.github.io/chuangliang-data_625/me-materials.csv";

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
  var dates = [];      // 升序日期
  var currentDate = null;
  var sortKey = "消耗";
  var monthSortKey = "消耗";
  var daySortKey = "日期";
  var daySortDir = 1;  // 1 升序 / -1 降序
  var timeFilterMode = "day";  // month / week / day
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
  if (!kpiStore._months || !Array.isArray(kpiStore._months) || kpiStore._months.length < 2) {
    kpiStore._months = [monthStr(0), monthStr(-1)];
    saveKpiStore(kpiStore);
  }
  var kpiMonths = kpiStore._months;   // [月①, 月②]
  // 取某月实际消耗（总消耗 + AIGC 消耗），AIGC 由素材名含 "aigc" 判定
  function getMonthActual(m) {
    var cost = 0, aigc = 0;
    if (!m) return { cost: 0, aigc: 0 };
    matData.forEach(function (r) {
      if ((r["日期"] || "").slice(0, 7) === m) {
        var c = num(r["消耗"]); cost += c;
        if ((r["素材名"] || "").toLowerCase().indexOf("aigc") >= 0) aigc += c;
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
    var prevOn = !!PREVIEW_KEY;
    var coverOn = !!COVER_KEY;
    var thead = "<tr><th>#</th>" + (coverOn ? "<th class='me-cover-h'>封面</th>" : "") + (prevOn ? "<th class='me-prev-h'>预览</th>" : "") + "<th class='l'>素材名</th>" + RANK_METRICS.map(function (m) {
      return "<th data-key='" + m.key + "' class='" + (m.key === sortKey ? "on" : "") + "'>" + m.label + (m.key === sortKey ? " ↓" : "") + "</th>";
    }).join("") + "</tr>";
    var prevUrls = [];
    var coverUrls = [];
    var tbody = rows.map(function (m, idx) {
      var v = num(m[sortKey]);
      var w = Math.max(2, Math.round(v / max * 100));
      var name = m["素材名"] || m["素材ID"] || "(未命名)";
      var disp = name.length > 38 ? name.slice(0, 38) + "…" : name;
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
      return "<tr><td class='rk'>" + (idx + 1) + "</td>" + coverCell + prevBtn + "<td class='l' title='" + esc(name) + "'>" + esc(disp) + "</td>" + cells + "</tr>";
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
    var cnt = el("meRankCount"); if (cnt) cnt.textContent = "共 " + rows.length + " 个素材（按" + (RANK_METRICS.filter(function (m){return m.key===sortKey;})[0].label) + "排序）";
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
    var hs = histData.slice().sort(function (a, b) { return a["日期"] < b["日期"] ? -1 : 1; });
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
    matData.forEach(function (m) {
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
  // 单行 KPI（消耗 / AIGC 消耗）：进度条 + 实际/目标 + 百分比
  function kpiRow(label, mi, f, actualVal, targetVal) {
    var ratio = targetVal > 0 ? actualVal / targetVal : 0;
    var pct = Math.round(ratio * 100);
    var col = targetVal > 0 ? (ratio >= 1 ? "#27a567" : (ratio >= 0.6 ? "#e0a008" : "#e0533d")) : "#cbd5e1";
    return "<div class='me-kpi-row' style='display:flex;align-items:center;gap:10px;margin:6px 0'>" +
      "<div style='width:72px;color:#5a6678;font-size:13px'>" + esc(label) + "</div>" +
      "<div style='flex:1'>" +
        "<div style='display:flex;justify-content:space-between;font-size:12px;color:#334'><span class='me-kpi-actual'>实际 ¥" + fmtNum(actualVal) + "</span><span class='me-kpi-target'>目标 ¥" + fmtNum(targetVal) + "</span></div>" +
        "<div style='height:8px;background:#eef2f7;border-radius:4px;overflow:hidden;margin-top:3px'><i class='me-kpi-bar' data-mi='" + mi + "' data-f='" + f + "' style='display:block;height:100%;width:" + Math.min(100, pct) + "%;background:" + col + "'></i></div>" +
      "</div>" +
      "<div class='me-kpi-pct' style='width:48px;text-align:right;font-weight:700;color:" + col + "'>" + pct + "%</div>" +
    "</div>";
  }
  // 单月卡片（月① / 月②）
  function kpiMonthBlock(i, m, actual, t) {
    var tag = i === 0 ? "月①" : "月②";
    return "<div style='border:1px solid #eef2f7;border-radius:10px;padding:12px 14px;margin-bottom:12px;background:#fcfdff'>" +
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px'>" +
        "<div style='display:flex;align-items:center;gap:8px'>" +
          "<span style='font-weight:700;color:#223'>" + tag + "</span>" +
          "<input type='month' class='me-kpi-month' data-mi='" + i + "' value='" + m + "' style='padding:5px 8px;border:1px solid #cdd6e3;border-radius:8px;font-size:13px'>" +
        "</div>" +
        "<div style='display:flex;align-items:center;gap:6px;font-size:12px;color:#8a94a6'>目标消耗 <input type='number' class='me-kpi-target-input' data-mi='" + i + "' data-f='cost' value='" + t.cost + "' placeholder='0' style='width:110px;padding:5px 8px;border:1px solid #cdd6e3;border-radius:8px;font-size:13px'> 元</div>" +
      "</div>" +
      kpiRow("总消耗", i, "cost", actual.cost, t.cost) +
      "<div style='display:flex;align-items:center;gap:6px;margin:8px 0 4px;font-size:12px;color:#8a94a6;justify-content:flex-end'>目标 AIGC <input type='number' class='me-kpi-target-input' data-mi='" + i + "' data-f='aigc' value='" + t.aigc + "' placeholder='0' style='width:110px;padding:5px 8px;border:1px solid #cdd6e3;border-radius:8px;font-size:13px'> 元</div>" +
      kpiRow("AIGC消耗", i, "aigc", actual.aigc, t.aigc) +
    "</div>";
  }
  // 双月合计（mi="t" 表示合计行）
  function kpiTotalBlock() {
    var a1 = getMonthActual(kpiMonths[0]), a2 = getMonthActual(kpiMonths[1]);
    var t1 = kpiStore[kpiMonths[0]] || { cost: 0, aigc: 0 }, t2 = kpiStore[kpiMonths[1]] || { cost: 0, aigc: 0 };
    return "<div style='font-weight:700;color:#223;margin-bottom:6px'>▬ 双月合计（" + kpiMonths[0] + " + " + kpiMonths[1] + "）</div>" +
      kpiRow("总消耗", "t", "cost", a1.cost + a2.cost, t1.cost + t2.cost) +
      kpiRow("AIGC总消耗", "t", "aigc", a1.aigc + a2.aigc, t1.aigc + t2.aigc);
  }
  // 轻量刷新：仅重算进度条与实际/目标数值，不动输入框（避免打字时失焦）
  function refreshKpiProgress() {
    Array.prototype.forEach.call(document.querySelectorAll(".me-kpi-bar"), function (bar) {
      var mi = bar.getAttribute("data-mi"), f = bar.getAttribute("data-f");
      var actual, t;
      if (mi === "t") {
        var a1 = getMonthActual(kpiMonths[0]), a2 = getMonthActual(kpiMonths[1]);
        var t1 = kpiStore[kpiMonths[0]] || { cost: 0, aigc: 0 }, t2 = kpiStore[kpiMonths[1]] || { cost: 0, aigc: 0 };
        actual = { cost: a1.cost + a2.cost, aigc: a1.aigc + a2.aigc };
        t = { cost: t1.cost + t2.cost, aigc: t1.aigc + t2.aigc };
      } else {
        var m = kpiMonths[+mi];
        actual = getMonthActual(m);
        t = kpiStore[m] || { cost: 0, aigc: 0 };
      }
      var a = actual[f], tg = t[f];
      var ratio = tg > 0 ? a / tg : 0, pct = Math.round(ratio * 100);
      var col = tg > 0 ? (ratio >= 1 ? "#27a567" : (ratio >= 0.6 ? "#e0a008" : "#e0533d")) : "#cbd5e1";
      bar.style.width = Math.min(100, pct) + "%"; bar.style.background = col;
      var row = bar.closest(".me-kpi-row");
      if (row) {
        var act = row.querySelector(".me-kpi-actual"); if (act) act.textContent = "实际 ¥" + fmtNum(a);
        var tgt = row.querySelector(".me-kpi-target"); if (tgt) tgt.textContent = "目标 ¥" + fmtNum(tg);
        var pc = row.querySelector(".me-kpi-pct"); if (pc) { pc.textContent = pct + "%"; pc.style.color = col; }
      }
    });
  }
  function renderKpi() {
    var grid = el("meKpiGrid"); if (!grid) return;
    // 确保月份数组完整
    while (kpiMonths.length < 2) kpiMonths.push(monthStr(-(kpiMonths.length)));
    kpiStore._months = kpiMonths; saveKpiStore(kpiStore);
    var html = "";
    kpiMonths.forEach(function (m, i) {
      var actual = getMonthActual(m);
      var t = kpiStore[m] || { cost: 0, aigc: 0 };
      html += kpiMonthBlock(i, m, actual, t);
    });
    grid.innerHTML = html;
    var tot = el("meKpiTotal"); if (tot) tot.innerHTML = kpiTotalBlock();
    bindKpi();
  }
  function bindKpi() {
    Array.prototype.forEach.call(document.querySelectorAll(".me-kpi-month"), function (inp) {
      inp.onchange = function () {
        var i = +inp.getAttribute("data-mi");
        kpiMonths[i] = inp.value;
        kpiStore._months = kpiMonths; saveKpiStore(kpiStore);
        renderKpi();   // 换月后重算实际值
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll(".me-kpi-target-input"), function (inp) {
      inp.oninput = function () {
        var i = +inp.getAttribute("data-mi");
        var f = inp.getAttribute("data-f");
        var m = kpiMonths[i];
        if (!kpiStore[m]) kpiStore[m] = { cost: 0, aigc: 0 };
        kpiStore[m][f] = num(inp.value) || 0;
        saveKpiStore(kpiStore);
        refreshKpiProgress();
      };
    });
  }

  /* ---------- 渲染：本月总入口 ---------- */
  function renderMonth() {
    var body = el("meMonthBody");
    if (!body) return;
    var totalCost = 0, totalConv = 0;
    var totShow = 0, totClick = 0, matSet = {};
    matData.forEach(function (m) {
      totShow += num(m["展示数"]); totClick += num(m["点击数"]);
      if (m["素材ID"]) matSet[m["素材ID"]] = 1;
    });
    histData.forEach(function (h) { totalCost += num(h["消耗"]); totalConv += num(h["转化数"]); });
    var avgCTR = totShow > 0 ? totClick / totShow * 100 : 0;
    var distinctMat = Object.keys(matSet).length;
    var days = histData.length;
    var rangeTxt = dates.length ? (dates[0] + " ~ " + dates[dates.length - 1]) : "-";
    var rg = el("meMonthRange"); if (rg) rg.textContent = "（" + rangeTxt + "）";
    renderMonthCards(totalCost, totalConv, avgCTR, distinctMat, days);
    renderMonthChart();
    renderMonthMatTop();
    renderTimeTabs();   // 月/周/日 筛选标签
    renderTimeTable();  // 时间筛选明细
    renderWeek();       // 周统计
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
      fetch(HIST_URL + "?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.text(); }),
      fetch(MAT_URL + "?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.text(); })
    ]).then(function (res) {
      histData = csvToObjects(res[0]);
      matData = csvToObjects(res[1]);
      detectMediaKeys();   // 探测素材预览/封面链接列
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
      ".me-enh-toolbar select:focus{outline:none;border-color:#2b6cff}" +
      ".me-play{padding:2px 9px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#2b6cff;cursor:pointer;font-size:12px;line-height:1.4}" +
      ".me-play:hover{background:#eef4ff}" +
      ".me-prev-h{width:56px}" +
      ".me-prev-cell{width:46px;text-align:center}" +
      ".me-prev-row td{background:#f7faff;padding:12px;text-align:left}" +
      ".me-cover-h{width:64px}" +
      ".me-cover-cell{width:56px;text-align:center;padding:4px!important}" +
      ".me-thumb{width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e6ebf2;background:#f6f8fb;cursor:zoom-in}" +
      ".me-thumb:hover{box-shadow:0 2px 8px rgba(43,108,255,.2)}";
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

    // 本月汇总面板（整合进个人数据，不单独分文件）
    var monthPanel = document.createElement("div");
    monthPanel.id = "meMonth";
    monthPanel.style.cssText = "margin-top:20px;border:1px solid #e6ebf2;border-radius:12px;background:#fff;overflow:hidden";
    monthPanel.innerHTML =
      "<div id='meMonthToggle' style='display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;background:#f6f8fb'>" +
        "<h3 style='margin:0;font-size:16px;color:#223'>📊 本月汇总 <span id='meMonthRange' style='font-size:12px;color:#8a94a6;font-weight:400'></span></h3>" +
        "<span style='color:#8a94a6;font-size:12px' id='meMonthArrow'>▾ 收起</span>" +
      "</div>" +
      "<div id='meMonthBody' style='padding:14px 16px'>" +
        "<div id='meMonthCards' style='display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px'></div>" +
        "<div style='font-weight:600;margin:0 0 6px;color:#334'>每日消耗走势</div>" +
        "<div id='meMonthChart' style='display:flex;align-items:flex-end;gap:3px;height:130px;padding:0 2px 18px;border-bottom:1px solid #eef2f7;margin-bottom:16px'></div>" +
        "<div style='font-weight:600;margin:0 0 6px;color:#334'>素材消耗 Top 50（本月累计，点击表头排序）</div>" +
        "<div id='meMonthMatTop' style='max-height:440px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff;margin-bottom:18px'></div>" +
        "<div style='display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:0 0 8px'>" +
          "<div style='font-weight:600;color:#334'>📅 时间筛选明细（点击表头排序）</div>" +
          "<div id='meTimeTabs' style='display:flex;gap:6px'>" +
            "<button data-mode='month' style='padding:5px 12px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#334;font-size:13px;cursor:pointer'>月筛选</button>" +
            "<button data-mode='week' style='padding:5px 12px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#334;font-size:13px;cursor:pointer'>周筛选</button>" +
            "<button data-mode='day' style='padding:5px 12px;border:1px solid #cdd6e3;border-radius:6px;background:#fff;color:#334;font-size:13px;cursor:pointer'>日筛选</button>" +
          "</div>" +
        "</div>" +
        "<div id='meTimeTable' style='max-height:420px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff'></div>" +
      "</div>";
    if (panel && panel.parentNode) panel.parentNode.insertBefore(monthPanel, panel.nextSibling);

    // 本周统计面板
    var weekPanel = document.createElement("div");
    weekPanel.id = "meWeek";
    weekPanel.style.cssText = "margin-top:20px;border:1px solid #e6ebf2;border-radius:12px;background:#fff;overflow:hidden";
    weekPanel.innerHTML =
      "<div style='padding:12px 16px;background:#f6f8fb'>" +
        "<h3 style='margin:0;font-size:16px;color:#223'>📈 周统计 <span style='font-size:12px;color:#8a94a6;font-weight:400'>（按自然周切分本月，每周 7 天）</span></h3>" +
      "</div>" +
      "<div style='padding:14px 16px'>" +
        "<div id='meWeekTable' style='max-height:420px;overflow:auto;border:1px solid #e6ebf2;border-radius:10px;background:#fff'></div>" +
      "</div>";
    if (monthPanel && monthPanel.parentNode) monthPanel.parentNode.insertBefore(weekPanel, monthPanel.nextSibling);

    // 双月绩效 KPI 进度面板
    var kpiPanel = document.createElement("div");
    kpiPanel.id = "meKpi";
    kpiPanel.style.cssText = "margin-top:20px;border:1px solid #e6ebf2;border-radius:12px;background:#fff;overflow:hidden";
    kpiPanel.innerHTML =
      "<div style='padding:12px 16px;background:#f6f8fb'>" +
        "<h3 style='margin:0;font-size:16px;color:#223'>🎯 双月绩效 KPI 进度 <span style='font-size:12px;color:#8a94a6;font-weight:400'>（自定义月份目标，消耗自动关联所选月份）</span></h3>" +
        "<div style='font-size:12px;color:#8a94a6;margin-top:3px'>分别选「月① / 月②」并填写 KPI 目标，实际消耗（总消耗、AIGC 消耗）按所选月份自动从数据汇总；目标自动保存到本地，下次打开仍在。</div>" +
      "</div>" +
      "<div style='padding:14px 16px'>" +
        "<div id='meKpiGrid'></div>" +
        "<div id='meKpiTotal' style='margin-top:16px;padding-top:14px;border-top:1px dashed #e6ebf2'></div>" +
      "</div>";
    if (weekPanel && weekPanel.parentNode) weekPanel.parentNode.insertBefore(kpiPanel, weekPanel.nextSibling);

    // 本月汇总折叠
    var toggle = el("meMonthToggle");
    if (toggle) toggle.onclick = function () {
      var b = el("meMonthBody");
      var collapsed = b.style.display === "none";
      b.style.display = collapsed ? "block" : "none";
      var ar = el("meMonthArrow"); if (ar) ar.textContent = collapsed ? "▾ 收起" : "▸ 展开";
    };

    // 事件
    var sel = el("meDate");
    if (sel) sel.onchange = function () { currentDate = sel.value; renderPersonal(); };

    // 月/周/日 筛选标签事件
    var tabs = el("meTimeTabs");
    if (tabs) {
      Array.prototype.forEach.call(tabs.querySelectorAll("button[data-mode]"), function (btn) {
        btn.onclick = function () { setTimeMode(btn.getAttribute("data-mode")); };
      });
    }

    // 双月绩效 KPI 进度（首次渲染，数据到达后 loadData 会再刷新实际值）
    renderKpi();
  }

  /* ---------- 接管原看板渲染，避免冲突 ---------- */
  function hookDashboard() {
    try { if (window.meStop) window.meStop(); } catch (e) {}
    if (window.ME && window.ME.cfg) window.ME.cfg.auto = false;
    window.renderMe = function () {};
    window.meApplyRows = function () { if (ready) { renderPersonal(); renderMonth(); } };
  }

  /* ---------- 初始化 ---------- */
  function init() {
    hookDashboard();
    injectUI();
    loadData();
    setInterval(function () { loadData(); }, 5 * 60 * 1000);
    var rb = el("meRefresh");
    if (rb) rb.onclick = function () { loadData(); };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
