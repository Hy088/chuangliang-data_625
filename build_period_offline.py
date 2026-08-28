# -*- coding: utf-8 -*-
"""生成项目看板周期数据离线分享版（单文件 HTML，数据内嵌，零依赖）"""
import json, os

REPO = r"C:/Users/EDY/chuangliang_data"
OUT = r"C:/Users/EDY/Desktop/数据看板-周期数据汇总-离线分享版.html"

def fmt_wan(x):
    if x is None: return '-'
    if abs(x) >= 1_0000_0000:
        return f"{x/1_0000_0000:.2f}亿"
    if abs(x) >= 1_0000:
        return f"{x/1_0000:.2f}万"
    return f"{x:,.0f}"

def fmt_yuan(x):
    if x is None: return '-'
    if abs(x) >= 1_0000_0000:
        return f"¥{x/1_0000_0000:.2f}亿"
    if abs(x) >= 1_0000:
        return f"¥{x/1_0000:.2f}万"
    return f"¥{x:,.2f}"

def fmt_pct(x):
    if x is None: return '-'
    return f"{x:.2f}%"

def main():
    meta = json.load(open(os.path.join(REPO, 'period-meta.json'), encoding='utf-8'))
    overall = meta['overall']
    projects = sorted(meta['projects'], key=lambda x: -x['cost'])
    type_share = sorted(meta['typeShare'], key=lambda x: -x['cost'])
    periods = meta['meta']['periods']
    period_data = {d['period']: d['overall'] for d in meta['periodData']}

    cats = sorted([c for c in meta['categories'] if c.get('cost', 0) > 0], key=lambda x: -x['cost'])[:15]
    plcs = sorted([p for p in meta['placements'] if p.get('cost', 0) > 0], key=lambda x: -x['cost'])[:15]

    data_obj = {
        'overall': overall,
        'projects': projects,
        'typeShare': type_share,
        'periods': periods,
        'periodData': [{'period': p, 'overall': period_data.get(p, {})} for p in periods],
        'topCategories': cats,
        'topPlacements': plcs,
    }
    data_js = json.dumps(data_obj, ensure_ascii=False)

    def tr_cat(i, c):
        return f"<tr><td>{i+1}</td><td>{c['proj']}</td><td>{c['cat']}</td><td class='num'>{fmt_yuan(c['cost'])}</td><td class='num'>{fmt_wan(c['cv'])}</td><td class='num'>{fmt_yuan(c['cpa'])}</td><td class='num'>{fmt_pct(c['cvr'])}</td></tr>"

    def tr_plc(i, p):
        return f"<tr><td>{i+1}</td><td>{p['proj']}</td><td>{p['chan']}</td><td class='num'>{fmt_yuan(p['cost'])}</td><td class='num'>{fmt_wan(p['cv'])}</td><td class='num'>{fmt_yuan(p['cpa'])}</td><td class='num'>{fmt_pct(p['cvr'])}</td></tr>"

    def tr_period(p):
        o = period_data.get(p, {})
        return f"<tr><td>{p}</td><td class='num'>{fmt_yuan(o.get('cost',0))}</td><td class='num'>{fmt_wan(o.get('imp',0))}</td><td class='num'>{fmt_wan(o.get('clk',0))}</td><td class='num'>{fmt_wan(o.get('cv',0))}</td><td class='num'>{fmt_yuan(o.get('cpa',0))}</td><td class='num'>{fmt_pct(o.get('cvr',0))}</td><td class='num'>{fmt_pct(o.get('ctr',0))}</td></tr>"

    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>数据看板 · 周期数据汇总（离线分享版）</title>
<style>
:root{--bg:#0f0f1a;--card:#1a1a2e;--card2:#25253d;--text:#e8e8f0;--muted:#a0a0b8;--accent:#ff6b9d;--accent2:#00d4aa;--accent3:#7c6bff;--border:#2a2a45;}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",PingFang SC,Microsoft YaHei,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.container{max-width:1200px;margin:0 auto;padding:24px}
header{text-align:center;margin-bottom:28px}
h1{margin:0 0 8px;font-size:28px;background:linear-gradient(90deg,var(--accent),var(--accent3));-webkit-background-clip:text;color:transparent}
.sub{color:var(--muted);font-size:14px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:28px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;text-align:center}
.kpi .val{font-size:26px;font-weight:700;color:var(--accent);margin:6px 0}
.kpi .lab{font-size:13px;color:var(--muted)}
.sec{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:24px}
.sec h2{margin:0 0 18px;font-size:18px;color:var(--text);border-left:4px solid var(--accent);padding-left:10px}
.chart-wrap{height:260px;position:relative}
.chart-flex{display:flex;align-items:flex-end;gap:8px;height:200px;padding:10px 0}
.bar{flex:1;background:linear-gradient(180deg,var(--accent),var(--accent3));border-radius:6px 6px 0 0;min-height:4px;position:relative;cursor:pointer;transition:.2s}
.bar:hover{opacity:.85}
.bar span{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--muted);white-space:nowrap}
.bar .tip{position:absolute;top:-28px;left:50%;transform:translateX(-50%);background:var(--card2);padding:3px 8px;border-radius:6px;font-size:11px;color:var(--text);opacity:0;transition:.2s;pointer-events:none}
.bar:hover .tip{opacity:1}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:800px){.two-col{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px 8px;text-align:left;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:500}
tr:hover td{background:rgba(255,255,255,.03)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.pie-wrap{display:flex;align-items:center;gap:30px;flex-wrap:wrap;justify-content:center}
.pie{width:160px;height:160px;border-radius:50%}
.pie-list{font-size:13px;color:var(--muted)}
.footer{text-align:center;color:var(--muted);font-size:12px;margin-top:30px}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>数据看板 · 周期数据汇总</h1>
  <div class="sub">统计周期：""" + periods[0] + " 至 " + periods[-1] + " · 共 " + str(len(periods)) + " 个周期</div>\n</header>\n\n"

    html += """<section class="kpi-grid">
  <div class="kpi"><div class="lab">总消耗</div><div class="val">""" + fmt_yuan(overall['cost']) + """</div></div>
  <div class="kpi"><div class="lab">总展示</div><div class="val">""" + fmt_wan(overall['imp']) + """</div></div>
  <div class="kpi"><div class="lab">总点击</div><div class="val">""" + fmt_wan(overall['clk']) + """</div></div>
  <div class="kpi"><div class="lab">总转化</div><div class="val">""" + fmt_wan(overall['cv']) + """</div></div>
  <div class="kpi"><div class="lab">平均CPA</div><div class="val">""" + fmt_yuan(overall['cpa']) + """</div></div>
  <div class="kpi"><div class="lab">平均CVR</div><div class="val">""" + fmt_pct(overall['cvr']) + """</div></div>
  <div class="kpi"><div class="lab">平均CTR</div><div class="val">""" + fmt_pct(overall['ctr']) + """</div></div>
</section>

<section class="sec">
  <h2>周期消耗趋势</h2>
  <div class="chart-wrap" id="costTrend"></div>
</section>

<section class="sec">
  <h2>周期转化趋势</h2>
  <div class="chart-wrap" id="cvTrend"></div>
</section>

<section class="two-col">
  <div class="sec">
    <h2>项目消耗占比</h2>
    <div id="projPie"></div>
  </div>
  <div class="sec">
    <h2>素材类型占比</h2>
    <div id="typePie"></div>
  </div>
</section>

<section class="sec">
  <h2>TOP 15 品类（按消耗）</h2>
  <table>
    <thead><tr><th>排名</th><th>项目</th><th>品类</th><th class="num">消耗</th><th class="num">转化</th><th class="num">CPA</th><th class="num">CVR</th></tr></thead>
    <tbody>
""" + "\n".join(tr_cat(i, c) for i, c in enumerate(cats)) + """
    </tbody>
  </table>
</section>

<section class="sec">
  <h2>TOP 15 场景/版位（按消耗）</h2>
  <table>
    <thead><tr><th>排名</th><th>项目</th><th>场景</th><th class="num">消耗</th><th class="num">转化</th><th class="num">CPA</th><th class="num">CVR</th></tr></thead>
    <tbody>
""" + "\n".join(tr_plc(i, p) for i, p in enumerate(plcs)) + """
    </tbody>
  </table>
</section>

<section class="sec">
  <h2>周期明细</h2>
  <table>
    <thead><tr><th>周期</th><th class="num">消耗</th><th class="num">展示</th><th class="num">点击</th><th class="num">转化</th><th class="num">CPA</th><th class="num">CVR</th><th class="num">CTR</th></tr></thead>
    <tbody>
""" + "\n".join(tr_period(p) for p in periods) + """
    </tbody>
  </table>
</section>

<div class="footer">本文件为离线快照，双击即可查看；最新交互版看板见 https://hy088.github.io/chuangliang-data_625/</div>
</div>
<script>
const DATA = """ + data_js + """;
function fmt(v,key){
  if(key==='cost'||key==='cpa') return '\\u00a5'+(v>=10000?(v/10000).toFixed(1)+'万':v.toFixed(0));
  if(v>=10000) return (v/10000).toFixed(1)+'万';
  return v.toFixed(0);
}
function renderBar(id, key, c1, c2){
  const arr = DATA.periodData;
  const max = Math.max.apply(null, arr.map(function(d){return d.overall[key]||0;}))||1;
  const wrap = document.getElementById(id);
  const flex = document.createElement('div');
  flex.className = 'chart-flex';
  arr.forEach(function(d){
    const v = d.overall[key]||0;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = Math.max(4, (v/max*100))+'%';
    bar.style.background = 'linear-gradient(180deg,'+c1+','+c2+')';
    bar.innerHTML = '<div class="tip">'+fmt(v,key)+'</div><span>'+d.period.split(' ~ ')[0].slice(5)+'</span>';
    flex.appendChild(bar);
  });
  wrap.appendChild(flex);
}
function renderPie(id, rows, key, labelKey){
  const total = rows.reduce(function(s,r){return s+r[key];},0)||1;
  const colors = ['#ff6b9d','#00d4aa','#7c6bff','#ffd166','#06b6d4','#ef4444'];
  let acc = 0;
  const segs = rows.map(function(r,i){
    const pct = r[key]/total;
    const start = acc; acc += pct;
    return colors[i%colors.length]+' '+start*100+'% '+acc*100+'%';
  }).join(',');
  const wrap = document.getElementById(id);
  const list = rows.map(function(r,i){
    return '<div><i style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:'+colors[i%colors.length]+'"></i>'+r[labelKey]+' '+fmt(r[key],key)+' ('+(r[key]/total*100).toFixed(1)+'%)</div>';
  }).join('');
  wrap.innerHTML = '<div class="pie-wrap"><div class="pie" style="background:conic-gradient('+segs+')"></div><div class="pie-list">'+list+'</div></div>';
}
renderBar('costTrend','cost','#ff6b9d','#7c6bff');
renderBar('cvTrend','cv','#00d4aa','#06b6d4');
renderPie('projPie',DATA.projects,'cost','proj');
renderPie('typePie',DATA.typeShare,'cost','type');
</script>
</body>
</html>"""

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('written', OUT, 'size', round(os.path.getsize(OUT)/1024, 1), 'KB')

if __name__ == '__main__':
    main()
