# -*- coding: utf-8 -*-
"""
增量同步：把 F:/Workbuddy.renwu/WorkBuddy_数据 里「period-meta.json 尚未收录」的
新周素材报表 CSV，解析并合并进看板数据源：
  - period-materials.json  (cols+rows, 仅素材明细)
  - period-data.json       (完整体, 含 materials)
  - period-meta.json       (轻量体, 不含 materials)
逻辑忠实移植自 index.html 的 rowChannel / decode / _metrics / accumulate / aggregateViews。
"""
import csv, glob, os, json, re, shutil, gzip, sys
from datetime import datetime, date, timedelta

# 日报导出里「素材预览」等列可能很长，放开 csv 单字段上限，避免 csv.Error: field larger than field limit
csv.field_size_limit(10 ** 9)

# --force：忽略已有 period-meta/period-materials/period-data，从源 CSV 全量重建所有周期
FORCE = ('--force' in sys.argv) or ('-f' in sys.argv)
# --only=标签：只重建指定周期（可逗号分隔），常与 --force 搭配
ONLY = None
for _a in sys.argv[1:]:
    if _a.startswith('--only='):
        ONLY = [x.strip() for x in _a[len('--only='):].split(',') if x.strip()]

REPO = r"C:/Users/EDY/chuangliang_data"
SRC  = r"F:\Workbuddy.renwu\WorkBuddy_数据"
PROJ_LIST = ['广义新', '低活', '标点']
CH_BROAD  = ['有PIN专项', 'SG专项', 'HL专项', '下载激活专项', '广义新']
MCOLS = ['id','name','opt','edit','proj','cat','chan','cost','imp','clk','cv','cpa','cvr','ctr','mtype','tags','period']

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
def build_week(week_files, period):
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
                      m['mtype'], '|'.join(sorted(m['tags'])), period])

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


def _d(s):
    y, m, dd = map(int, s.split('-'))
    return date(y, m, dd)


def group_days_into_weeks(days):
    """把一批单日日期按「周日 ~ 周六」归成周期桶。

    看板的周期约定是 周日~周六 7 天一档。最早那天所在的周如果不足一周，
    就从最早那天起算（这样首个周期会是 07-01~07-04 这种不完整的桶，
    与历史数据一致）。返回 {(start_str, end_str): [day_str, ...]}
    """
    if not days:
        return {}
    ds = sorted(_d(x) for x in days)
    anchor = ds[0]

    def bucket_start(d):
        days_since_sun = (d.weekday() + 1) % 7      # 周日->0, 周一->1 ... 周六->6
        s = d - timedelta(days=days_since_sun)
        return s if s >= anchor else anchor

    def bucket_end(s):
        days_to_sat = 6 - ((s.weekday() + 1) % 7)
        return s + timedelta(days=days_to_sat)

    out = {}
    for d in ds:
        s, e = bucket_start(d), bucket_end(bucket_start(d))
        out.setdefault((s.isoformat(), e.isoformat()), []).append(d.isoformat())
    return out


def period_missing_days(label, files):
    """算某个周期桶里还缺哪几天（兼容日报与周报两种文件形态）"""
    m = re.search(r'(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})', label)
    if not m:
        return []
    have = set()
    for f in files:
        mm = re.search(r'(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})_', os.path.basename(f))
        if not mm:
            continue
        s, e = _d(mm.group(1)), _d(mm.group(2))
        cur = s
        while cur <= e:
            have.add(cur.isoformat())
            cur += timedelta(days=1)
    return _missing_days(m.group(1), m.group(2), have)


def _missing_days(start, end, have):
    """列出某周期桶里还缺哪几天（例如最后一个周期还没过完）"""
    s, e = _d(start), _d(end)
    have = set(have)
    miss, cur = [], s
    while cur <= e:
        if cur.isoformat() not in have:
            miss.append(cur.isoformat())
        cur += timedelta(days=1)
    return miss


def _dim_rollup(pdata, key, keyfn):
    """把多个周期的同名维度表重新累加成一张总表（用于 --force --only= 部分重建）"""
    acc = []
    for v in pdata:
        acc = merge_dim(acc, v.get(key, []) or [], keyfn)
    return acc


def _rollup_from_periods(pdata):
    """由若干周期的分期聚合，重算出整体聚合结构"""
    tot = {'cost': 0.0, 'imp': 0.0, 'clk': 0.0, 'cv': 0.0, 'n': 0}
    for v in pdata:
        o = v.get('overall', {})
        for k in tot:
            tot[k] += o.get(k, 0)
    return {
        'periodData': list(pdata),
        'overall': metrics(tot),
        'projects':   _dim_rollup(pdata, 'projects',   lambda d: d['proj']),
        'categories': _dim_rollup(pdata, 'categories', lambda d: d['proj'] + '|' + d['cat']),
        'placements': _dim_rollup(pdata, 'placements', lambda d: d['proj'] + '|' + d['chan']),
        'optimizers': _dim_rollup(pdata, 'optimizers', lambda d: d['proj'] + '|' + d['opt']),
        'editors':    _dim_rollup(pdata, 'editors',    lambda d: d['proj'] + '|' + d['edit']),
        'tags':       _dim_rollup(pdata, 'tags',       lambda d: d['proj'] + '|' + d['tag']),
    }


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


def empty_meta():
    return {'meta': {'periods': [], 'projects': []}, 'overall': {}, 'projects': [], 'categories': [],
            'placements': [], 'optimizers': [], 'editors': [], 'tags': [], 'typeShare': []}

def empty_pm():
    return {'cols': MCOLS, 'rows': []}

def empty_pd():
    return {'meta': {'periods': [], 'projects': []}, 'overall': {}, 'projects': [], 'categories': [],
            'placements': [], 'optimizers': [], 'editors': [], 'tags': [],
            'materials': {'cols': MCOLS, 'rows': []}, 'suggestions': [], 'insights': [], 'periodData': []}

def main():
    print('=== sync_weekly mode:', 'FORCE-REBUILD' if FORCE else 'INCREMENTAL', '===')
    # 1) 现有 meta，确定已有哪些周期
    meta_path = os.path.join(REPO, 'period-meta.json')
    if FORCE:
        meta = empty_meta()          # 全量重建：丢弃旧聚合，后面按源 CSV 重算
        existing_periods = []
    else:
        meta = json.load(open(meta_path, encoding='utf-8')) if os.path.exists(meta_path) else empty_meta()
        existing_periods = list(meta.get('meta', {}).get('periods', []))
    print('existing periods:', existing_periods)

    # 2) 扫描源文件夹。支持两种形态：
    #    a) 周报文件：素材报表-不限_2026-08-16-2026-08-22_xxx.csv（一个文件就是一个周期）
    #    b) 日报文件：素材报表-不限_2026-07-01-2026-07-01_xxx.csv（一天一个文件，
    #       需按「周日~周六」自动归桶成一个周期，否则看板会切出几十个"周期"）
    files = glob.glob(os.path.join(SRC, '素材报表-不限_*.csv'))
    daily = {}    # 'YYYY-MM-DD' -> [files]
    multi = {}    # ('YYYY-MM-DD','YYYY-MM-DD') -> [files]
    for f in files:
        m = re.search(r'(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})_', os.path.basename(f))
        if not m:
            continue
        s, e = m.group(1), m.group(2)
        if s == e:
            daily.setdefault(s, []).append(f)
        else:
            multi.setdefault((s, e), []).append(f)

    weeks = {}    # label -> [files]
    if daily:
        buckets = group_days_into_weeks(sorted(daily.keys()))
        for (s, e), ds in buckets.items():
            fl = []
            for d in ds:
                fl.extend(daily[d])
            weeks[f"{s} ~ {e}"] = sorted(fl)
        print('daily files detected:', len(daily), 'days ->', len(buckets), 'week buckets')
        for (s, e), ds in sorted(buckets.items()):
            missing = _missing_days(s, e, ds)
            flag = ('  ⚠ 缺 ' + ','.join(missing)) if missing else ''
            print(f"    {s} ~ {e}: {len(ds)} 天{flag}")
    for (s, e), fl in multi.items():
        label = f"{s} ~ {e}"
        weeks.setdefault(label, [])
        for x in fl:
            if x not in weeks[label]:
                weeks[label].append(x)
        if daily:
            print('  (混合形态) 多日文件另立周期:', label)
    src_weeks = sorted(weeks.keys())
    if FORCE:
        new_weeks = [w for w in src_weeks if (not ONLY or w in ONLY)]
    else:
        new_weeks = [w for w in src_weeks if w not in existing_periods]
    print('found week labels:', src_weeks)
    print('weeks to build:', new_weeks)
    # 即使没有新周期，也重新写出输出文件（确保 .gz 等衍生文件存在）

    # 3) 备份（只有文件存在才备份）
    for fn in ['period-materials.json', 'period-data.json', 'period-meta.json']:
        p = os.path.join(REPO, fn)
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(REPO, fn + '.syncbak'))

    # 4) 解析新周
    all_mrows = []
    new_periodData = []
    for w in sorted(new_weeks):
        mrows, views = build_week(sorted(weeks[w]), w)
        all_mrows.extend(mrows)
        miss = period_missing_days(w, weeks[w])
        rec = {'period': w, **views}
        if miss:
            rec['incomplete'] = True
            rec['missing_days'] = miss
        new_periodData.append(rec)
        print(f"  week {w}: materials={len(mrows)} overall_cost={views['overall']['cost']:.2f}"
              + (f"  ⚠ 缺 {','.join(miss)}" if miss else ""))

    # 5) 合并素材行
    pm_path = os.path.join(REPO, 'period-materials.json')
    pd_path = os.path.join(REPO, 'period-data.json')
    if FORCE:
        pm = empty_pm()
        pd = empty_pd()
        if ONLY:
            # 部分重建：保留未选中周期的旧素材行 + 由旧分期聚合重算的整体聚合
            if os.path.exists(pm_path):
                _old_pm = json.load(open(pm_path, encoding='utf-8'))
                _pi = _old_pm['cols'].index('period')
                pm['rows'] = [r for r in _old_pm.get('rows', []) if r[_pi] not in ONLY]
                pd['materials']['rows'] = [list(r) for r in pm['rows']]
            if os.path.exists(pd_path):
                _old_pd = json.load(open(pd_path, encoding='utf-8'))
                _keep = [v for v in _old_pd.get('periodData', []) if v.get('period') not in ONLY]
                pd.update(_rollup_from_periods(_keep))
                pd['meta'] = _old_pd.get('meta', {})
            if os.path.exists(meta_path):
                _old_mt = json.load(open(meta_path, encoding='utf-8'))
                _keepm = [v for v in _old_mt.get('periodData', []) if v.get('period') not in ONLY]
                meta.update(_rollup_from_periods(_keepm))
                _mp = meta.setdefault('meta', {})
                _mp['periods'] = [p for p in (_old_mt.get('meta', {}).get('periods') or []) if p not in ONLY]
    else:
        pm = json.load(open(pm_path, encoding='utf-8')) if os.path.exists(pm_path) else empty_pm()
        pd = json.load(open(pd_path, encoding='utf-8')) if os.path.exists(pd_path) else empty_pd()
    # 确保列定义与最新 MCOLS 一致
    pm['cols'] = MCOLS
    pd['materials']['cols'] = MCOLS
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
        # meta.periods / projects / generated（前端多处读取 DATA.meta.projects / period / generated）
        mp = obj.setdefault('meta', {})
        mp['periods'] = sorted(set([str(x) for x in ((mp.get('periods', []) or []) + new_weeks)]))
        mp['projects'] = [p['proj'] for p in obj.get('projects', [])]
        mp['generated'] = datetime.now().strftime('%Y-%m-%d %H:%M')
        # 默认 period 显示最近一个周期；前端切换后会覆盖
        if mp.get('periods'):
            mp['period'] = mp['periods'][-1]
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

    # 按周期拆分为小 .gz，前端按需加载当前周期，避免一次拉取 19MB
    ci_period = {c: i for i, c in enumerate(pm['cols'])}['period']
    by_period = {}
    for r in pm['rows']:
        p = r[ci_period]
        by_period.setdefault(p, []).append(r)

    # 只写 .gz，不落明文（避免仓库堆积，也避免删除操作）
    def write_gz_only(gz_path, obj):
        txt = json.dumps(obj, ensure_ascii=False)
        with gzip.open(gz_path, 'wt', encoding='utf-8', compresslevel=9) as f:
            f.write(txt)
        return len(txt.encode('utf-8'))

    # 清理旧的按周期分片（FORCE 时把已废弃周期的文件挪进 _trash，不做删除）
    if FORCE:
        keep_slugs = {re.sub(r'[^0-9]', '', w) for w in ONLY} if ONLY else set()
        trash = os.path.join(REPO, '_trash', datetime.now().strftime('%Y%m%d_%H%M%S'))
        moved = []
        for f in glob.glob(os.path.join(REPO, 'period-materials-*.json')) + \
                 glob.glob(os.path.join(REPO, 'period-materials-*.json.gz')):
            sm = re.search(r'period-materials-(\d+)\.json', os.path.basename(f))
            if not sm:
                continue
            if ONLY and sm.group(1) in keep_slugs:
                continue
            try:
                os.makedirs(trash, exist_ok=True)
                shutil.move(f, os.path.join(trash, os.path.basename(f)))
                moved.append(os.path.basename(f))
            except Exception as e:
                print('  (跳过旧分片', os.path.basename(f), ':', e, ')')
        if moved:
            print(f'  旧分片已移至 _trash: {len(moved)} 个')

    for p, rows in sorted(by_period.items()):
        slug = re.sub(r'[^0-9]', '', p)
        gzp = os.path.join(REPO, f'period-materials-{slug}.json.gz')
        write_gz_only(gzp, {'cols': pm['cols'], 'rows': rows})
        gz_mb = round(os.path.getsize(gzp) / 1024 / 1024, 2)
        print(f'  period-materials-{slug}.json.gz: {len(rows)} rows, {gz_mb} MB')

    # period-meta 保持轻量普通 JSON
    json.dump(meta, open(os.path.join(REPO, 'period-meta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('DONE. new periods:', new_weeks)
    print('period-data.json size:', round(os.path.getsize(os.path.join(REPO, 'period-data.json'))/1024/1024, 2), 'MB')
    print('period-materials.json.gz size:', round(os.path.getsize(os.path.join(REPO, 'period-materials.json.gz'))/1024/1024, 2), 'MB')


if __name__ == '__main__':
    main()
