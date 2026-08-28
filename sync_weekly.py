# -*- coding: utf-8 -*-
"""
增量同步：把 F:/Workbuddy.renwu/WorkBuddy_数据 里「period-meta.json 尚未收录」的
新周素材报表 CSV，解析并合并进看板数据源：
  - period-materials.json  (cols+rows, 仅素材明细)
  - period-data.json       (完整体, 含 materials)
  - period-meta.json       (轻量体, 不含 materials)
逻辑忠实移植自 index.html 的 rowChannel / decode / _metrics / accumulate / aggregateViews。
"""
import csv, glob, os, json, re, shutil, gzip

REPO = r"C:/Users/EDY/chuangliang_data"
SRC  = r"F:\Workbuddy.renwu\WorkBuddy_数据"
PROJ_LIST = ['广义新', '低活', '标点']
CH_BROAD  = ['有PIN专项', 'SG专项', 'HL专项', '下载激活专项', '广义新']
MCOLS = ['id','name','opt','edit','proj','cat','chan','cost','imp','clk','cv','cpa','cvr','ctr','mtype','tags']

# ---------- 数字解析 ----------
def fnum(x):
    try:
        v = float(str(x).replace('%', '').replace(',', '').strip())
        return v if v == v else 0.0  # NaN guard
    except Exception:
        return 0.0

# ---------- 渠道/品类推导（移植自 index.html）----------
def isAppBiaod(plan):
    p = (plan or '').strip().lower()
    return ('app' in p) and ('小牛' in p) and ('biaod' in p)

def rowChannel(plan, name):
    plan = (plan or '').strip()
    name = (name or '').strip()
    if isAppBiaod(plan) and name.startswith('信息流'):
        return '标点'
    if ('低活' in plan) or ('低活' in name):
        return '低活'
    if ('广义新' in plan) or any(k in name for k in CH_BROAD):
        return '广义新'
    return None

def decode(name, proj):
    parts = [p.strip() for p in (name or '').split('-')]
    if proj in ('广义新', '低活'):
        placement = parts[4] if len(parts) > 4 else '其他'
        if re.search(r'PIN|pin|Pin', name or '') and len(parts) > 6:
            category = parts[6]
        elif proj == '广义新' and ('1分' in (name or '')) and len(parts) > 2:
            category = parts[2]
        else:
            category = parts[5] if len(parts) > 5 else '其他'
    else:
        placement = '信息流'
        category = parts[2] if len(parts) > 2 else '其他'
    if category in ('无', '--', ''):
        category = '其他'
    if placement in ('无', '--', ''):
        placement = '其他'
    return [placement, category]

def metrics(d):
    cost = d.get('cost', 0.0); imp = d.get('imp', 0.0); clk = d.get('clk', 0.0)
    cv = d.get('cv', 0.0); n = d.get('n', 0) or 0
    return {
        'cost': round(cost, 2),
        'imp': int(round(imp)),
        'clk': int(round(clk)),
        'cv': int(round(cv)),
        'n': int(round(n)),
        'cpa': round(cost / cv, 2) if cv else 0,
        'cvr': round(cv / clk * 100, 2) if clk else 0,
        'ctr': round(clk / imp * 100, 2) if imp else 0,
    }

# ---------- 单周聚合 ----------
def build_week(week_files):
    mat = {}        # key proj|id -> dict
    dims = {'cat': {}, 'plc': {}, 'opt': {}, 'edt': {}, 'tagg': {}, 'tot': {}}
    overall = {'cost': 0.0, 'imp': 0.0, 'clk': 0.0, 'cv': 0.0, 'n': 0}

    def add(dim, key, cost, imp, clk, cv):
        if key not in dims[dim]:
            dims[dim][key] = {'cost': 0.0, 'imp': 0.0, 'clk': 0.0, 'cv': 0.0, 'n': 0}
        o = dims[dim][key]
        o['cost'] += cost; o['imp'] += imp; o['clk'] += clk; o['cv'] += cv; o['n'] += 1

    for f in week_files:
        with open(f, encoding='utf-8-sig', newline='') as fh:
            rd = csv.DictReader(fh)
            for r in rd:
                t = (r.get('时间') or '').strip()
                sid = (r.get('素材ID') or '').strip()
                if t == '总计' or sid in ('', '--'):
                    continue
                cost = fnum(r.get('消耗')); imp = fnum(r.get('展示数'))
                clk = fnum(r.get('点击数')); cv = fnum(r.get('转化数'))
                name = (r.get('素材名') or '').strip()
                optimizer = (r.get('优化师') or '').strip()
                plan = (r.get('创量项目') or '').strip()
                mtype = (r.get('素材类型') or '').strip()
                tags = (r.get('素材标签') or '').strip()
                ch = rowChannel(plan, name) or '广义新'
                placement, category = decode(name, ch)
                key = ch + '|' + sid
                if key not in mat:
                    mat[key] = {'id': sid, 'name': name, 'opt': optimizer, 'edit': '',
                                'proj': ch, 'cat': category, 'chan': placement, 'mtype': mtype,
                                'tags': set(), 'cost': 0.0, 'imp': 0.0, 'clk': 0.0, 'cv': 0.0}
                m = mat[key]
                m['cost'] += cost; m['imp'] += imp; m['clk'] += clk; m['cv'] += cv
                for tg in re.split(r'[,，]', tags):
                    tg = tg.strip()
                    if tg:
                        m['tags'].add(tg)
                        add('tagg', ch + '|' + tg, cost, imp, clk, cv)
                add('cat', ch + '|' + category, cost, imp, clk, cv)
                add('plc', ch + '|' + placement, cost, imp, clk, cv)
                add('opt', ch + '|' + optimizer, cost, imp, clk, cv)
                add('edt', ch + '|' + '', cost, imp, clk, cv)
                add('tot', ch, cost, imp, clk, cv)
                overall['cost'] += cost; overall['imp'] += imp; overall['clk'] += clk; overall['cv'] += cv; overall['n'] += 1

    # 素材行（每周一行 proj|id）
    mrows = []
    for k, m in mat.items():
        me = metrics(m)
        mrows.append([m['id'], m['name'], m['opt'], m['edit'], m['proj'], m['cat'], m['chan'],
                      me['cost'], me['imp'], me['clk'], me['cv'], me['cpa'], me['cvr'], me['ctr'],
                      m['mtype'], ','.join(sorted(m['tags']))])

    # 维度视图
    def agg_list(dim, dims_keys):
        out = []
        for key, o in dims[dim].items():
            parts = key.split('|')
            rec = {}
            for dk, pv in zip(dims_keys, parts):
                rec[dk] = pv
            rec.update(metrics(o))
            out.append(rec)
        return out

    def proj_view():
        out = []
        for p in PROJ_LIST:
            if p in dims['tot']:
                rec = {'proj': p}; rec.update(metrics(dims['tot'][p])); out.append(rec)
        return out

    views = {
        'overall': metrics(overall),
        'projects': proj_view(),
        'categories': agg_list('cat', ['proj', 'cat']),
        'placements': agg_list('plc', ['proj', 'chan']),
        'optimizers': agg_list('opt', ['proj', 'opt']),
        'editors': agg_list('edt', ['proj', 'edit']),
        'tags': agg_list('tagg', ['proj', 'tag']),
    }
    return mrows, views


def merge_dim(existing, new_list, keyfn):
    d = {}
    for e in existing:
        d[keyfn(e)] = dict(e)
    for nw in new_list:
        k = keyfn(nw)
        if k in d:
            o = d[k]
            o['cost'] += nw['cost']; o['imp'] += nw['imp']; o['clk'] += nw['clk']
            o['cv'] += nw['cv']; o['n'] += nw['n']
            o.update(metrics({'cost': o['cost'], 'imp': o['imp'], 'clk': o['clk'], 'cv': o['cv'], 'n': o['n']}))
        else:
            d[k] = dict(nw)
    return list(d.values())


# ---------- suggestions / insights（移植）----------
def compute_suggestions(categories):
    sm = {}
    if not categories:
        return sm
    pct = lambda arr, p: (arr[min(int((len(arr)-1)*p)+1, len(arr)-1)] + arr[int((len(arr)-1)*p)] * 0) if arr else 0
    def pctv(arr, p):
        if not arr: return 0
        k = (len(arr)-1)*p; f = int(k); c = min(f+1, len(arr)-1)
        return arr[f] + (arr[c]-arr[f])*(k-f)
    for p in PROJ_LIST:
        recs = [r for r in categories if r['proj'] == p]
        if not recs:
            continue
        cpas = sorted(r['cpa'] for r in recs if r['cpa'] > 0)
        cvrs = sorted(r['cvr'] for r in recs if r['cvr'] > 0)
        if not cpas or not cvrs:
            continue
        cpaMed = cpas[len(cpas)//2]; cpaP75 = pctv(cpas, .75)
        cvrMed = cvrs[len(cvrs)//2]; cvrP75 = pctv(cvrs, .75)
        for r in recs:
            if r['cost'] < 1000 or r['cv'] < 10:
                sm[p + '|' + r['cat']] = '样本不足'; continue
            hi = r['cvr'] >= cvrP75 and r['cpa'] <= cpaMed
            lo = r['cpa'] >= cpaP75 and r['cvr'] <= cvrMed
            sm[p + '|' + r['cat']] = '放量' if hi else ('淘汰' if lo else ('维持' if r['cvr'] >= cvrMed else '迭代'))
    return sm

def compute_insights(categories):
    insights = []
    for p in PROJ_LIST:
        recs = [r for r in categories if r['proj'] == p and r['cost'] >= 1000 and r['cv'] >= 10]
        if not recs:
            continue
        top_cvr = sorted(recs, key=lambda x: -x['cvr'])[:3]
        low_cpa = sorted([x for x in recs if x['cv'] >= 30], key=lambda x: x['cpa'])[:3]
        insights.append({
            'proj': p,
            'top_cvr': [{'cat': x['cat'], 'cvr': x['cvr'], 'cpa': x['cpa'], 'cost': x['cost']} for x in top_cvr],
            'low_cpa': [{'cat': x['cat'], 'cvr': x['cvr'], 'cpa': x['cpa'], 'cost': x['cost']} for x in low_cpa],
        })
    return insights


def main():
    # 1) 现有 meta，确定已有哪些周期
    meta = json.load(open(os.path.join(REPO, 'period-meta.json'), encoding='utf-8'))
    existing_periods = list(meta.get('meta', {}).get('periods', []))
    print('existing periods:', existing_periods)

    # 2) 扫描源文件夹，找新周
    files = glob.glob(os.path.join(SRC, '素材报表-不限_*.csv'))
    weeks = {}  # label -> [files]
    for f in files:
        m = re.search(r'(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})_', os.path.basename(f))
        if not m:
            continue
        label = f"{m.group(1)} ~ {m.group(2)}"
        weeks.setdefault(label, []).append(f)
    new_weeks = [w for w in weeks if w not in existing_periods]
    print('found week labels:', list(weeks.keys()))
    print('NEW weeks to sync:', new_weeks)
    # 即使没有新周期，也重新写出输出文件（确保 .gz 等衍生文件存在）

    # 3) 备份
    for fn in ['period-materials.json', 'period-data.json', 'period-meta.json']:
        shutil.copy2(os.path.join(REPO, fn), os.path.join(REPO, fn + '.syncbak'))

    # 4) 解析新周
    all_mrows = []
    new_periodData = []
    for w in new_weeks:
        mrows, views = build_week(sorted(weeks[w]))
        all_mrows.extend(mrows)
        new_periodData.append({'period': w, **views})
        print(f"  week {w}: materials={len(mrows)} overall_cost={views['overall']['cost']:.2f}")

    # 5) 合并素材行
    pm = json.load(open(os.path.join(REPO, 'period-materials.json'), encoding='utf-8'))
    pd = json.load(open(os.path.join(REPO, 'period-data.json'), encoding='utf-8'))
    old_mcount = len(pm['rows'])
    pm['rows'].extend(all_mrows)
    pd['materials']['rows'].extend(all_mrows)
    print(f"period-materials rows: {old_mcount} -> {len(pm['rows'])} (+{len(all_mrows)})")

    # 6) 合并聚合（meta + data 都要）
    def merge_aggregates(obj):
        # periodData
        obj['periodData'] = obj.get('periodData', []) + new_periodData
        # top-level
        obj['overall'] = _merge_overall(obj.get('overall', {}), [v['overall'] for v in new_periodData])
        obj['projects'] = merge_dim(obj.get('projects', []), [p for v in new_periodData for p in v['projects']], lambda d: d['proj'])
        obj['categories'] = merge_dim(obj.get('categories', []), [p for v in new_periodData for p in v['categories']], lambda d: d['proj'] + '|' + d['cat'])
        obj['placements'] = merge_dim(obj.get('placements', []), [p for v in new_periodData for p in v['placements']], lambda d: d['proj'] + '|' + d['chan'])
        obj['optimizers'] = merge_dim(obj.get('optimizers', []), [p for v in new_periodData for p in v['optimizers']], lambda d: d['proj'] + '|' + d['opt'])
        obj['editors'] = merge_dim(obj.get('editors', []), [p for v in new_periodData for p in v['editors']], lambda d: d['proj'] + '|' + d['edit'])
        obj['tags'] = merge_dim(obj.get('tags', []), [p for v in new_periodData for p in v['tags']], lambda d: d['proj'] + '|' + d['tag'])
        # meta.periods
        mp = obj.setdefault('meta', {})
        mp['periods'] = (mp.get('periods', []) or []) + new_weeks
        # suggestions / insights 基于合并后的 categories 重算
        obj['suggestions'] = compute_suggestions(obj['categories'])
        obj['insights'] = compute_insights(obj['categories'])
        return obj

    def _merge_overall(old, news):
        o = dict(old)
        for k in ('cost', 'imp', 'clk', 'cv', 'n'):
            o[k] = o.get(k, 0) + sum(x.get(k, 0) for x in news)
        o.update(metrics({'cost': o['cost'], 'imp': o['imp'], 'clk': o['clk'], 'cv': o['cv'], 'n': o['n']}))
        return o

    merge_aggregates(meta)
    merge_aggregates(pd)

    # 7) typeShare 仅 period-meta：按全量 materials 的 mtype 重算
    ci = {c: i for i, c in enumerate(MCOLS)}
    ts = {}
    for r in pm['rows']:
        mt = r[ci['mtype']] or '其他'
        if mt not in ts:
            ts[mt] = {'cost': 0.0, 'imp': 0.0, 'clk': 0.0, 'cv': 0.0, 'n': 0}
        o = ts[mt]
        o['cost'] += fnum(r[ci['cost']]); o['imp'] += fnum(r[ci['imp']])
        o['clk'] += fnum(r[ci['clk']]); o['cv'] += fnum(r[ci['cv']]); o['n'] += 1
    typeShare = [{'type': t, **metrics(o)} for t, o in ts.items()]
    meta['typeShare'] = typeShare
    print('typeShare:', typeShare)

    # 8) 写回（GitHub Pages 单文件限 100MB；materials 超限时用 .gz 前端解压）
    def write_json(path, obj):
        txt = json.dumps(obj, ensure_ascii=False)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(txt)
        gz_path = path + '.gz'
        with gzip.open(gz_path, 'wt', encoding='utf-8', compresslevel=9) as f:
            f.write(txt)
        return len(txt.encode('utf-8'))

    # period-data 不含 materials（素材走独立 period-materials.json.gz）
    pd['materials'] = {'cols': pm['cols'], 'rows': []}
    write_json(os.path.join(REPO, 'period-data.json'), pd)

    # period-materials 完整版生成 .gz 用于线上；原始 json 留在本地但可 gitignore 忽略
    write_json(os.path.join(REPO, 'period-materials.json'), pm)

    # period-meta 保持轻量普通 JSON
    json.dump(meta, open(os.path.join(REPO, 'period-meta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('DONE. new periods:', new_weeks)
    print('period-data.json size:', round(os.path.getsize(os.path.join(REPO, 'period-data.json'))/1024/1024, 2), 'MB')
    print('period-materials.json.gz size:', round(os.path.getsize(os.path.join(REPO, 'period-materials.json.gz'))/1024/1024, 2), 'MB')


if __name__ == '__main__':
    main()
