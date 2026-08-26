#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量给「已传创量 且 日期 < 2026-08-17」的产品打上「青云已过审」标签。
即：在每个产品目录写入空文件 青云已过审.txt。

用法：
  python apply_qingyun_approved.py [--include-0817]   # 加 --include-0817 则含 8/17 当天(<=)
依赖：同目录 capacity.json（由 scan_capacity.py 生成）
"""
import json, os, shutil, datetime, argparse

ROOT = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(ROOT, "capacity.json")
MARKER = "青云已过审.txt"
BACKUP_DIR = os.path.join(ROOT, "_qingyun_backup_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-0817", action="store_true", help="日期边界含 2026-08-17 当天(<=)")
    args = ap.parse_args()

    d = json.load(open(JSON_PATH, encoding="utf-8"))
    es = d["entries"]
    bound = "2026-08-17"  # 严格小于；含当天时用 <=
    def hit(e):
        dt = str(e.get("date") or "")
        return dt < bound if not args.include_0817 else dt <= bound
    tgt = [e for e in es if e.get("chuangliang") == "yes" and hit(e)]
    print("目标产品数:", len(tgt))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    wrote = 0
    skipped = 0
    missing = 0
    backuped = 0
    for e in tgt:
        pp = e.get("path", "")
        if not pp or not os.path.isdir(pp):
            missing += 1
            continue
        # 备份该目录已有的青云*.txt（若有），避免误覆盖
        for f in os.listdir(pp):
            if f.startswith("青云") and f.endswith(".txt"):
                try:
                    shutil.copy2(os.path.join(pp, f), os.path.join(BACKUP_DIR, f + "." + os.path.basename(pp).replace("/", "_")))
                    backuped += 1
                except Exception:
                    pass
        mk = os.path.join(pp, MARKER)
        if os.path.exists(mk):
            skipped += 1
            continue
        open(mk, "w", encoding="utf-8").close()
        wrote += 1
    print("写入新标记:", wrote, " 已存在跳过:", skipped, " 路径缺失:", missing, " 备份旧标记:", backuped)
    print("备份目录:", BACKUP_DIR)

if __name__ == "__main__":
    main()
