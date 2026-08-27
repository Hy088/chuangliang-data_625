#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把「已传创量」的产品全部打上「已上传」标记。
即：在每个 chuangliang=='yes' 的产品目录写入空文件 已上传.txt。

用法：
  python apply_uploaded_from_chuangliang.py
依赖：同目录 capacity.json（由 scan_capacity.py 生成）
"""
import json, os, shutil, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(ROOT, "capacity.json")
MARKER = "已上传.txt"
UPLOAD_MARKERS = {"已上传.txt", "done.txt", "uploaded.txt", "已传.txt", "完成.txt"}
BACKUP_DIR = os.path.join(ROOT, "_upload_backup_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))


def main():
    d = json.load(open(JSON_PATH, encoding="utf-8"))
    es = d["entries"]
    tgt = [e for e in es if e.get("chuangliang") == "yes"]
    print("已传创量产品数:", len(tgt))

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
        # 备份该目录已有的上传标记（若有），避免误覆盖
        for f in os.listdir(pp):
            if f in UPLOAD_MARKERS:
                try:
                    shutil.copy2(
                        os.path.join(pp, f),
                        os.path.join(BACKUP_DIR, f + "." + os.path.basename(pp).replace("/", "_")),
                    )
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
