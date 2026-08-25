import os, json, datetime

ROOT = r'D:\625\京东'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capacity.json')
MARKERS = {'已上传.txt', 'done.txt', 'uploaded.txt', '已传.txt', '完成.txt'}


def infer_year(month, day):
    today = datetime.date.today()
    y = today.year
    try:
        d = datetime.date(y, month, day)
    except ValueError:
        return y
    return y - 1 if d > today else y


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
            for pname in sorted(os.listdir(dpath)):
                ppath = os.path.join(dpath, pname)
                if not os.path.isdir(ppath):
                    continue
                files = []
                for _root, _dirs, _files in os.walk(ppath):
                    files.extend(_files)
                marker = None
                for f in files:
                    if f.lower() in MARKERS:
                        marker = f
                        break
                materials = len([f for f in files if f.lower() not in MARKERS])
                entries.append({
                    'date': iso,
                    'month': mname,
                    'product': pname,
                    'materials': materials,
                    'uploaded': marker is not None,
                    'marker': marker,
                    'path': ppath.replace('\\', '/')
                })
    return entries


def main():
    entries = scan()
    total = len(entries)
    uploaded = sum(1 for e in entries if e['uploaded'])
    notup = total - uploaded
    materials = sum(e['materials'] for e in entries)
    data = {
        'generatedAt': datetime.datetime.now().replace(microsecond=0).isoformat(),
        'root': ROOT.replace('\\', '/'),
        'markerFiles': sorted(MARKERS),
        'summary': {
            'total': total,
            'uploaded': uploaded,
            'notUploaded': notup,
            'rate': round(uploaded / total * 100) if total else 0,
            'materials': materials
        },
        'entries': entries
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('Scanned %d products | uploaded %d | not uploaded %d | materials %d' % (total, uploaded, notup, materials))
    print('Wrote', OUT)


if __name__ == '__main__':
    main()
