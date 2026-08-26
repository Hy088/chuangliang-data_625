import os, json, datetime

ROOT = r'D:\625\京东'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capacity.json')

# 上传标记（已有约定）
UPLOAD_MARKERS = {'已上传.txt', 'done.txt', 'uploaded.txt', '已传.txt', '完成.txt'}
# 青云过审状态标记
QINGYUN = {'青云已过审.txt': '已过审', '青云未过审.txt': '未过审', '青云其他.txt': '其他原因'}
# 是否上传创量标记
CHUANGLIANG = {'已上传创量.txt', 'chuangliang.txt'}
# 未过审的驳回原因（读文件内容）
REASON_FILES = {'驳回原因.txt', '驳回.txt', '原因.txt'}
# 其他原因的具体内容（读文件内容）
OTHER_REASON_FILES = {'其他原因.txt', '青云原因.txt'}
# 未传创量原因（读文件内容）
CL_REASON_FILES = {'未传创量原因.txt', '未上传创量原因.txt', 'chuangliang_reason.txt'}

L = lambda s: s.lower()
UPLOAD_L = {L(m) for m in UPLOAD_MARKERS}
QINGYUN_L = {L(k): v for k, v in QINGYUN.items()}
CL_L = {L(m) for m in CHUANGLIANG}
REASON_L = {L(m) for m in REASON_FILES}
OTHER_L = {L(m) for m in OTHER_REASON_FILES}
CL_REASON_L = {L(m) for m in CL_REASON_FILES}
CONTROL_L = UPLOAD_L | set(QINGYUN_L) | CL_L | REASON_L | OTHER_L | CL_REASON_L


def infer_year(month, day):
    today = datetime.date.today()
    y = today.year
    try:
        d = datetime.date(y, month, day)
    except ValueError:
        return y
    return y - 1 if d > today else y


def _read_reason(fullpath):
    try:
        with open(fullpath, 'r', encoding='utf-8', errors='ignore') as fh:
            return fh.read().strip()[:300]
    except Exception:
        return ''


def _classify_filename(name):
    """从素材文件名提取分类。
    规则：
      - CH-SC-低活-...       -> 低活
      - CH-PRJ-采销项目-...   -> 采销项目
      - 信息流-小牛-积木-...  -> 信息流-小牛
      - 其他：取第一段（去掉首尾空格）
    """
    base = os.path.splitext(name)[0]
    parts = [p.strip() for p in base.split('-') if p.strip()]
    if not parts:
        return '其他'
    # 需要至少三段才存在"系列-分类"结构
    if len(parts) >= 3 and parts[0].isalpha() and parts[1].isalpha():
        series = parts[0].upper()
        # CH 系列：CH-SC、CH-PRJ ... 分类取第三段
        if series.startswith('CH'):
            return parts[2] or '其他'
        # 其他 系列-子系列 结构：取前两段作为分类，如 信息流-小牛
        return parts[0] + '-' + parts[1]
    return parts[0]


def _scan_product(ppath):
    """扫描一个产品文件夹，返回 (文件全路径列表, 文件名列表, 控制文件状态)。"""
    allpaths = []
    for _root, _dirs, _files in os.walk(ppath):
        for f in _files:
            allpaths.append(os.path.join(_root, f))
    names = [os.path.basename(p) for p in allpaths]
    return allpaths, names


def _detect_markers(allpaths, names):
    """从产品文件夹中的控制文件检测状态。"""
    ln = [L(n) for n in names]
    marker = None
    for n, nl in zip(names, ln):
        if nl in UPLOAD_L:
            marker = n
            break
    qy_l = None
    for n, nl in zip(names, ln):
        if nl in QINGYUN_L:
            qy_l = nl
            break
    qingyun = QINGYUN_L.get(qy_l, '') if qy_l else ''
    qingyun_reason = ''
    if qingyun == '未过审':
        for p, nl in zip(allpaths, ln):
            if nl in REASON_L:
                qingyun_reason = _read_reason(p)
                break
    elif qingyun == '其他原因':
        for p, nl in zip(allpaths, ln):
            if nl in OTHER_L:
                qingyun_reason = _read_reason(p)
                break
    chuangliang = 'yes' if any(nl in CL_L for nl in ln) else 'no'
    chuangliang_reason = ''
    if chuangliang == 'no':
        for p, nl in zip(allpaths, ln):
            if nl in CL_REASON_L:
                chuangliang_reason = _read_reason(p)
                break
    return marker, qingyun, qingyun_reason, chuangliang, chuangliang_reason


def scan():
    entries = []
    if not os.path.isdir(ROOT):
        print('ROOT not found:', ROOT)
        return entries
    for mname in sorted(os.listdir(ROOT)):
        mpath = os.path.join(ROOT, mname)
        if not os.path.isdir(mpath):
            continue
        if '月' not in mname:
            continue
        try:
            month = int(mname.replace('月', '').strip())
        except ValueError:
            continue
        for dname in sorted(os.listdir(mpath)):
            dpath = os.path.join(mpath, dname)
            if not os.path.isdir(dpath):
                continue
            if not (dname.isdigit() and len(dname) == 4):
                continue
            day = int(dname[2:])
            year = infer_year(month, day)
            try:
                iso = datetime.date(year, month, day).isoformat()
            except ValueError:
                iso = '%04d-%02d-%02d' % (year, month, day)

            for parent in sorted(os.listdir(dpath)):
                ppath = os.path.join(dpath, parent)
                if not os.path.isdir(ppath):
                    continue
                subdirs = [n for n in sorted(os.listdir(ppath))
                           if os.path.isdir(os.path.join(ppath, n))]

                # 如果该父分类下还有子文件夹，把每个子文件夹作为一条产能记录
                if subdirs:
                    for sub in subdirs:
                        subpath = os.path.join(ppath, sub)
                        allpaths, names = _scan_product(subpath)
                        marker, qingyun, qingyun_reason, chuangliang, chuangliang_reason = _detect_markers(allpaths, names)
                        ln = [L(n) for n in names]
                        material_files = [names[i] for i, nl_ in enumerate(ln) if nl_ not in CONTROL_L]
                        materials = len(material_files)
                        breakdown = {}
                        for mf in material_files:
                            cat = _classify_filename(mf)
                            breakdown[cat] = breakdown.get(cat, 0) + 1
                        entries.append({
                            'date': iso,
                            'month': mname,
                            'day': dname,
                            'product': parent + ' / ' + sub,
                            'parent': parent,
                            'subProduct': sub,
                            'materials': materials,
                            'materialFiles': material_files,
                            'materialBreakdown': breakdown,
                            'uploaded': marker is not None,
                            'marker': marker,
                            'qingyun': qingyun,
                            'qingyunReason': qingyun_reason,
                            'chuangliang': chuangliang,
                            'chuangliangReason': chuangliang_reason,
                            'path': subpath.replace('\\', '/')
                        })
                else:
                    # 没有子文件夹：父分类本身作为一条产能记录
                    allpaths, names = _scan_product(ppath)
                    marker, qingyun, qingyun_reason, chuangliang, chuangliang_reason = _detect_markers(allpaths, names)
                    ln = [L(n) for n in names]
                    material_files = [names[i] for i, nl_ in enumerate(ln) if nl_ not in CONTROL_L]
                    materials = len(material_files)
                    breakdown = {}
                    for mf in material_files:
                        cat = _classify_filename(mf)
                        breakdown[cat] = breakdown.get(cat, 0) + 1
                    entries.append({
                        'date': iso,
                        'month': mname,
                        'day': dname,
                        'product': parent,
                        'parent': parent,
                        'subProduct': '',
                        'materials': materials,
                        'materialFiles': material_files,
                        'materialBreakdown': breakdown,
                        'uploaded': marker is not None,
                        'marker': marker,
                            'qingyun': qingyun,
                            'qingyunReason': qingyun_reason,
                            'chuangliang': chuangliang,
                            'chuangliangReason': chuangliang_reason,
                            'path': ppath.replace('\\', '/')
                    })
    return entries


def main():
    entries = scan()
    total = len(entries)
    uploaded = sum(1 for e in entries if e['uploaded'])
    notup = total - uploaded
    materials = sum(e['materials'] for e in entries)
    qy_appr = sum(1 for e in entries if e['qingyun'] == '已过审')
    qy_rej = sum(1 for e in entries if e['qingyun'] == '未过审')
    qy_oth = sum(1 for e in entries if e['qingyun'] == '其他原因')
    qy_none = total - qy_appr - qy_rej - qy_oth
    cl_yes = sum(1 for e in entries if e['chuangliang'] == 'yes')

    # 全局素材分类汇总
    type_totals = {}
    for e in entries:
        for cat, cnt in e.get('materialBreakdown', {}).items():
            type_totals[cat] = type_totals.get(cat, 0) + cnt

    data = {
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'root': ROOT.replace('\\', '/'),
        'markerFiles': sorted(UPLOAD_MARKERS | set(QINGYUN) | CHUANGLIANG | REASON_FILES | OTHER_REASON_FILES | CL_REASON_FILES),
        'summary': {
            'total': total,
            'uploaded': uploaded,
            'notUploaded': notup,
            'rate': round(uploaded / total * 100) if total else 0,
            'materials': materials,
            'materialTypes': dict(sorted(type_totals.items(), key=lambda x: -x[1])),
            'qingyun': {'已过审': qy_appr, '未过审': qy_rej, '其他原因': qy_oth, '未标注': qy_none},
            'chuangliangYes': cl_yes
        },
        'entries': entries
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('Scanned %d products | uploaded %d | not uploaded %d | materials %d' % (total, uploaded, notup, materials))
    print('素材分类:', dict(sorted(type_totals.items(), key=lambda x: -x[1])[:10]))
    print('青云: 已过审 %d | 未过审 %d | 其他原因 %d | 未标注 %d' % (qy_appr, qy_rej, qy_oth, qy_none))
    print('已传创量 %d | 未传创量 %d' % (cl_yes, total - cl_yes))
    print('Wrote', OUT)


if __name__ == '__main__':
    main()
