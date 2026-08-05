# -*- coding: utf-8 -*-
"""用 me-materials.csv(每日素材投放数据)反推每个素材的"上传时间"=该素材最早出现的数据日,
生成 4列 me-uploads.csv(素材ID,素材名,上传人,上传时间)。这是基于真实报表数据的高精度近似,
比素材名日期片段可靠。无登录、立即可用。
"""
import csv, re, json
from pathlib import Path
from collections import defaultdict

DATA = Path(r"C:/Users/EDY/chuangliang_data")
MAT = DATA / "me-materials.csv"
UP = DATA / "me-uploads.csv"
OUT = DATA / "me-uploads.csv"  # 覆盖

AI_KW = re.compile(r"aigc|可灵|sd2\.0|空镜|seedance|万相|comfyui", re.I)
RE_MATID = re.compile(r"素材ID[:：]\s*(\d+)")
RE_UP = re.compile(r"([\u4e00-\u9fa5A-Za-z]+-XNY\d+)")
RE_NAME_MD = re.compile(r"-(\d{2})(\d{2})-")  # 素材名片段 MMDD

# 1) 从 me-materials.csv 取 素材ID -> 最早数据日
first_day = {}
with open(MAT, "r", encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        mid = (row.get("素材ID") or "").strip()
        d = (row.get("日期") or "").strip()
        if not mid or not d:
            continue
        if mid not in first_day or d < first_day[mid]:
            first_day[mid] = d
print(f"[build] me-materials.csv 唯一素材数: {len(first_day)}; 示例: {dict(list(first_day.items())[:3])}")

# 2) 读现有 me-uploads.csv(含素材名/上传人)
rows = []
with open(UP, "r", encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        rows.append(dict(row))
print(f"[build] me-uploads.csv 现有行: {len(rows)}")

# 3) 填上传时间(优先报表首现日, 缺则素材名片段兜底)
matched = 0
both = 0
mismatch = 0
for r in rows:
    mid = (r.get("素材ID") or "").strip()
    nm = r.get("素材名") or ""
    fd = first_day.get(mid, "")
    name_md = RE_NAME_MD.search(nm)
    name_date = ""
    if name_md:
        name_date = f"2026-{name_md.group(1)}-{name_md.group(2)}"
    if fd:
        r["上传时间"] = fd
        matched += 1
        if name_date:
            both += 1
            if name_date != fd:
                mismatch += 1
    elif name_date:
        r["上传时间"] = name_date
    else:
        r["上传时间"] = ""
    if not r.get("上传人"):
        up = RE_UP.search(nm)
        if up:
            r["上传人"] = up.group(1)
# 确保列顺序
for r in rows:
    r["素材ID"] = r.get("素材ID", "")
    r["素材名"] = r.get("素材名", "")
    r["上传人"] = r.get("上传人", "")
    r["上传时间"] = r.get("上传时间", "")

# 4) 写出
with open(OUT, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["素材ID", "素材名", "上传人", "上传时间"])
    w.writeheader()
    for r in sorted(rows, key=lambda x: x["上传时间"] or "9999"):
        w.writerow(r)

# 5) 统计
total = len(rows)
with_time = sum(1 for r in rows if r["上传时间"])
ai = sum(1 for r in rows if AI_KW.search(r["素材名"]))
by_month = defaultdict(int)
for r in rows:
    if r["上传时间"]:
        by_month[r["上传时间"][:7]] += 1
print(f"[build] 写出 {total} 行; 有上传时间: {with_time}; AI: {ai} ({round(ai/total*100,1)}%)")
print(f"[build] 按月分布: {dict(sorted(by_month.items()))}")
print(f"[build] 报表首现日命中: {matched}; 同时有素材名片段: {both}; 两者不一致: {mismatch}")
print(f"[build] 样例: {json.dumps(rows[:3], ensure_ascii=False)}")
