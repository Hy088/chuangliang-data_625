/* 个人数据增强：素材数据排行 + 时间筛选 + 本月每日明细 + 周统计 + 双月绩效
 * 注入到「个人数据」模块(#me)，读取同目录 me-materials.csv / me-history.csv
 * 注意：KPI 指标卡（#meCards）由主文件 index.html 负责渲染，本脚本不再覆盖。
 */
(function () {
  "use strict";
  // 同源相对路径，适配 GitHub Pages / CloudStudio / 本地文件
  var HIST_URL = "./me-history.csv?v=20260805b";
  var MAT_URL  = "./me-materials.csv?v=20260805b";

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
  // 取某月实际消耗（总消耗 + AIGC 消耗），AIGC 由 isAiMaterial(素材名) 按 AIGC 标签判定
  function getMonthActual(m) {
    var cost = 0, aigc = 0;
    if (!m) return { cost: 0, aigc: 0 };
    matData.forEach(function (r) {
      if ((r["日期"] || "").slice(0, 7) === m) {
        var c = num(r["消耗"]); cost += c;
        if (isAiMaterial(r["素材名"])) aigc += c;
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

  // AIGC 素材判定：以素材在创量打的 AIGC 类标签为准
  // 个人素材数据 me-materials.csv 无「素材标签」列，仅有素材名简写；故将标签映射到素材名中实际出现的片段
  var AI_TAG_KEYWORDS = ["aigc", "可灵", "sd2.0", "空镜", "seedance", "万相", "comfyui"];
  function isAiMaterial(name) {
    if (!name) return false;
    var n = String(name).toLowerCase();
    for (var i = 0; i < AI_TAG_KEYWORDS.length; i++) {
      if (n.indexOf(AI_TAG_KEYWORDS[i].toLowerCase()) >= 0) return true;
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
      "<div class='kpi-track'><i class='me-kpi-bar' data-mi='" + mi + "' data-f='" + f + "' style='width:" + Math.min(100, pct) + "%;background:" + col + "'></i></div>" +
      "<div class='kpi-num'><span class='me-kpi-actual'>实际 ¥" + fmtNum(actualVal) + "</span><span class='me-kpi-target'>目标 ¥" + fmtNum(targetVal) + "</span></div>" +
      "<div class='kpi-gap me-kpi-gap'>" + kpiGapTxt(actualVal, targetVal) + "</div>" +
    "</div>";
  }
  function tgInput(i, f, v) {
    return "<span style='font-weight:400;color:#8a94a6'>目标 <input type='number' class='me-kpi-target-input kpi-in' data-mi='" + i + "' data-f='" + f + "' value='" + v + "' placeholder='0'> 元</span>";
  }
  // 单月卡片（月① / 月②）
  function kpiMonthBlock(i, m, actual, t) {
    var tag = i === 0 ? "月①" : "月②";
    return "<div class='kpi-mc'>" +
      "<div class='kpi-mc-hd'>" +
        "<span class='kpi-mc-tag'>" + tag +
          "<input type='month' class='me-kpi-month kpi-in' data-mi='" + i + "' value='" + m + "' style='width:auto'>" +
        "</span>" +
        "<span style='font-size:12px;color:#8a94a6'>实际值按所选月份自动汇总</span>" +
      "</div>" +
      "<div class='kpi-mc-bd'>" +
        kpiRow("总消耗", i, "cost", actual.cost, t.cost, tgInput(i, "cost", t.cost)) +
        kpiRow("AIGC 消耗", i, "aigc", actual.aigc, t.aigc, tgInput(i, "aigc", t.aigc)) +
      "</div>" +
    "</div>";
  }
  // 双月合计（mi="t" 表示合计行）
  function kpiTotalBlock() {
    var a1 = getMonthActual(kpiMonths[0]), a2 = getMonthActual(kpiMonths[1]);
    var t1 = kpiStore[kpiMonths[0]] || { cost: 0, aigc: 0 }, t2 = kpiStore[kpiMonths[1]] || { cost: 0, aigc: 0 };
    return "<div class='kpi-tot'>" +
      "<div style='font-weight:800;color:#223;margin-bottom:8px;font-size:14px'>🏁 双月合计考核（" + kpiMonths[0] + " + " + kpiMonths[1] + "）</div>" +
      "<div class='kpiw'>" +
        kpiRow("双月总消耗", "t", "cost", a1.cost + a2.cost, t1.cost + t2.cost) +
        kpiRow("双月 AIGC 消耗", "t", "aigc", a1.aigc + a2.aigc, t1.aigc + t2.aigc) +
      "</div>" +
    "</div>";
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
    // 确保月份数组完整
    while (kpiMonths.length < 2) kpiMonths.push(monthStr(-(kpiMonths.length)));
    kpiStore._months = kpiMonths; saveKpiStore(kpiStore);
    var html = "";
    kpiMonths.forEach(function (m, i) {
      var actual = getMonthActual(m);
      var t = kpiStore[m] || { cost: 0, aigc: 0 };
      html += kpiMonthBlock(i, m, actual, t);
    });
    grid.className = "kpiw";
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
    renderUploadMonth();// 每月上传素材量 & AI 占比
  }

  // ④ 个人素材统计：剪辑师李虹玉 · 当月素材量 & AI占比 & 日均素材量 & 预计月产能
  // 口径：按「日期」列归属月份，统计当月有消耗的不重复素材ID数；AIGC 由素材名标签判定。
  var upByMonth = null;   // { "2026-08": {total:Set, ai:Set} }
  var upMonths = [];      // 升序月份
  function upCompute() {
    if (upByMonth) return;
    upByMonth = {}; upMonths = [];
    var seen = {};        // key = 月份+素材ID，当月内同一素材只计一次
    matData.forEach(function (m) {
      var id = m["素材ID"]; if (!id) return;
      var mo = (m["日期"] || "").slice(0, 7);
      if (!mo || mo.length !== 7) return;
      var key = mo + "|" + id;
      if (seen[key]) return;
      seen[key] = 1;
      if (!upByMonth[mo]) upByMonth[mo] = { total: 0, ai: 0 };
      upByMonth[mo].total++;
      if (isAiMaterial(m["素材名"])) upByMonth[mo].ai++;
    });
    upMonths = Object.keys(upByMonth).sort();
  }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function upRenderView() {
    var body = el("meUploadBody"); if (!body) return;
    if (!upMonths.length) { body.innerHTML = '<div class="empty" style="padding:18px;text-align:center;color:#9aa4b2">暂无素材明细数据</div>'; return; }

    var now = new Date();
    var curY = now.getFullYear(), curM = now.getMonth() + 1;
    var curMo = curY + "-" + ("0" + curM).slice(-2);
    var dTotal = daysInMonth(curY, curM);
    var dPassed = Math.min(Math.max(now.getDate(), 1), dTotal);

    var d = upByMonth[curMo] || { total: 0, ai: 0 };
    var ratio = d.total ? d.ai / d.total : 0;
    var avg = dPassed ? d.total / dPassed : 0;
    var forecast = avg * dTotal;

    body.innerHTML =
      "<div class='me-up-tiles me-up-tiles-4'>" +
        "<div class='me-up-tile'><div class='lab'>当月总素材量</div><div class='big'>" + fmtNum(d.total) + "</div><div class='sub">" + curMo + " 有消耗 · 素材ID去重</div></div>" +
        "<div class='me-up-tile ai'><div class='lab'>AIGC 占比</div><div class='big'>" + (ratio * 100).toFixed(1) + "%</div><div class='sub'>AI 素材 " + fmtNum(d.ai) + " / " + fmtNum(d.total) + "</div></div>" +
        "<div class='me-up-tile day'><div class='lab'>平均每天素材量</div><div class='big'>" + avg.toFixed(1) + "</div><div class='sub'>已过 " + dPassed + " 天 / " + dTotal + " 天</div></div>" +
        "<div class='me-up-tile forecast'><div class='lab'>预计当月产能</div><div class='big'>" + fmtNum(Math.round(forecast)) + "</div><div class='sub'>按日均 × " + dTotal + " 天估算</div></div>" +
      "</div>" +
      "<div style='padding:8px 2px 0;color:#8a94a6;font-size:12px'>统计口径：按素材明细的「日期」列归属当月，统计当月有消耗的不重复素材ID数；素材名命中 AIGC 标签片段(aigc/可灵/sd2.0/空镜/seedance/万相/comfyui)记为 AIGC 素材。</div>";
  }
  function renderUploadMonth() {
    upByMonth = null;     // 强制用最新 matData 重新统计
    upCompute();
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
      var label = (d === currentDate && d === todayStr()) ? d + "（今日）" : d;
      return "<option value='" + d + "'" + (d === currentDate ? " selected" : "") + ">" + label + "</option>";
    }).join("");
  }
  function todayStr() {
    var t = new Date();
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
  }

  /* ---------- 数据加载 ---------- */
  function loadData(cb, force) {
    var q = force ? ("?_=" + Date.now()) : "";
    var opt = force ? { cache: "no-store" } : undefined;
    Promise.all([
      fetch(HIST_URL + q, opt).then(function (r) { return r.text(); }),
      fetch(MAT_URL + q, opt).then(function (r) { return r.text(); })
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
      ".me-thumb:hover{box-shadow:0 2px 8px rgba(43,108,255,.2)}" +
      ".me-up-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 14px;padding:10px 12px;background:#f6f8fb;border:1px solid #e6ebf2;border-radius:10px}" +
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
      ".me-up-chart{display:flex;align-items:flex-end;gap:10px;margin-bottom:4px}" +
      ".me-up-bar{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}" +
      ".me-up-bar .bararea{height:150px;width:100%;display:flex;align-items:flex-end;justify-content:center}" +
      ".me-up-bar .barwrap{width:62%;max-width:50px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;border-radius:8px 8px 0 0;overflow:hidden;background:#eef2f7}" +
      ".me-up-bar .fill{width:100%;background:#2b6cff}" +
      ".me-up-bar .aifill{width:100%;background:#7a5cff}" +
      ".me-up-bar .mval{font-size:12.5px;font-weight:700;color:#1f2a3a;margin-bottom:4px;white-space:nowrap}" +
      ".me-up-bar .mlab{font-size:11.5px;color:#5a6678;margin-top:6px;white-space:nowrap}";
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
      "<span style='color:#8a94a6;font-size:12px'>切换日期查看当日 KPI 与素材情况（历史自今日起逐日累积）</span>";
    if (h2 && h2.parentNode) h2.parentNode.insertBefore(bar, h2.nextSibling);

    var cards = el("meCards");

    // ② 素材数据 — 当日素材排行
    var panel = document.createElement("div");
    panel.id = "meRank";
    panel.innerHTML =
      panelHd("🏆 素材数据排行 <span id='meRankCount' style='font-size:12px;color:#8a94a6;font-weight:400'></span>", "", "点击表头可切换排序指标") +
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
      panelHd("📊 本月汇总 <span id='meMonthRange' style='font-size:12px;color:#8a94a6;font-weight:400'></span>", "本月累计指标", "") +
      "<div id='meMonthBody'>" +
        "<div id='meMonthCards' style='display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px'></div>" +
        "<div style='font-weight:700;margin:0 0 8px;color:#334;font-size:13.5px'>每日消耗走势</div>" +
        "<div id='meMonthChart' style='display:flex;align-items:flex-end;gap:3px;height:150px;padding:0 2px 18px;border-bottom:1px solid #eef2f7'></div>" +
      "</div>";
    mountPanel("slotMeMonth", monthPanel, timePanel);

    // ④ 个人素材统计（剪辑师李虹玉 · 当月素材量 & AI占比 & 日均产能）
    var uploadPanel = document.createElement("div");
    uploadPanel.id = "meUpload";
    uploadPanel.innerHTML =
      panelHd("📦 个人素材统计", "剪辑师李虹玉 · 当月素材量 & AI占比 & 日均产能", "按素材名创建日期 · 素材ID去重 · 当月已过天数折算") +
      "<div id='meUploadBody'></div>";
    mountPanel("slotMeUpload", uploadPanel, matTopPanel);

    // ⑤ KPI 绩效
    var kpiPanel = document.createElement("div");
    kpiPanel.id = "meKpi";
    kpiPanel.innerHTML =
      panelHd("🎯 双月绩效 KPI 进度", "自定义月份目标 · 消耗自动关联", "") +
      "<div class='note' style='margin:0 0 14px'>分别选「月① / 月②」并填写 KPI 目标，实际消耗（总消耗、AIGC 消耗）按所选月份自动汇总；目标保存在本地，下次打开仍在。</div>" +
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
