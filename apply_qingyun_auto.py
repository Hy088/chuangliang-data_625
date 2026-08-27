#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
规则：已传创量（chuangliang == 'yes'）且青云未标注（产品目录无任何 青云*.txt）的产品，
自动写入「青云已过审.txt」。

用途：每日自动化 / 创量比对后调用 —— 凡在创量扫描到上传的，自动补青云已过审标注，
无需每次手动说。

保护：若产品目录已有任何 青云*.txt（青云已过审 / 青云未过审 / 青云其他），
则跳过，绝不覆盖你手动标注的青云状态。

依赖：同目录 capacity.json（由 scan_capacity.py 生成）
"""
import json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(ROOT, "capacity.json")
MARKER = "青云已过审.txt"


def has_any_qingyun_marker(pp):
    try:
        return any(f.startswith("青云") and f.endswith(".txt") for f in os.listdir(pp))
    except Exception:
        return False


def main():
    d = json.load(open(JSON_PATH, encoding="utf-8"))
    es = d["entries"]
    tgt = [e for e in es if e.get("chuangliang") == "yes"]
    wrote = 0
    skipped_existing = 0
    skipped_marked = 0
    missing = 0
    for e in tgt:
        pp = e.get("path", "")
        if not pp or not os.path.isdir(pp):
            missing += 1
            continue
        # 已有任何青云标记（已过审/未过审/其他）→ 跳过，保护手动标注
        if has_any_qingyun_marker(pp):
            skipped_marked += 1
            continue
        mk = os.path.join(pp, MARKER)
        if os.path.exists(mk):
            skipped_existing += 1
            continue
        open(mk, "w", encoding="utf-8").close()
        wrote += 1
    print("已传创量产品数:", len(tgt))
    print("写入新青云已过审标记:", wrote,
          " 跳过(已有青云标记):", skipped_marked,
          " 跳过(标记已存在):", skipped_existing,
          " 路径缺失:", missing)
    return wrote


if __name__ == "__main__":
    main()
