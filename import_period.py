# -*- coding: utf-8 -*-
"""
周期看板「一键同步」脚本
========================
用途：从创量后台手动导出新的「素材报表-不限_*.csv」后，丢进源文件夹，
      双击/运行本脚本即可完成 增量合并 → 版本号刷新 → 提交推送 全流程。

前置：
  1. 把新导出的 CSV（一个周期通常 3 个分片）放进
     F:\\Workbuddy.renwu\\WorkBuddy_数据\\
     文件名保持创量原样：素材报表-不限_2026-08-23-2026-08-29_xxxx.csv
  2. 确认文件名里的日期区间正确（脚本按文件名识别周期，不读文件内容判断）

用法：
  python import_period.py              # 增量同步 + 刷新版本 + 提交推送
  python import_period.py --force      # 全量重建所有周期（慢，约 1 分钟）
  python import_period.py --only="2026-08-16 ~ 2026-08-22"   # 只重建指定周期
  python import_period.py --no-push    # 只本地生成，不提交推送

注意：周期看板数据与「个人数据（李虹玉账号）」是两条完全独立的数据源，
      本脚本只处理周期数据，不会碰 me-*.csv 及任何个人数据文件。
"""
import os, re, sys, subprocess, shutil
from datetime import datetime

REPO = os.path.dirname(os.path.abspath(__file__))
SRC = r"F:\Workbuddy.renwu\WorkBuddy_数据"
OFFLINE = r"C:\Users\EDY\Desktop\数据看板离线包"

PY = sys.executable


def log(*a):
    print("[import]", *a, flush=True)


# ---------- 1) 先看看源文件夹里有什么 ----------
def scan_source():
    if not os.path.isdir(SRC):
        log("!! 源文件夹不存在:", SRC)
        return {}
    weeks = {}
    for fn in os.listdir(SRC):
        m = re.search(r"(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})_", fn)
        if not m or not fn.startswith("素材报表-不限_"):
            continue
        label = f"{m.group(1)} ~ {m.group(2)}"
        weeks.setdefault(label, []).append(fn)
    return {k: sorted(v) for k, v in sorted(weeks.items())}


def current_periods():
    p = os.path.join(REPO, "period-meta.json")
    if not os.path.exists(p):
        return []
    import json
    try:
        return list(json.load(open(p, encoding="utf-8")).get("meta", {}).get("periods", []))
    except Exception:
        return []


# ---------- 2) 版本号自增 ----------
def bump_ver(old):
    """20260829j -> 20260829k；跨天则变成新日期 + a"""
    today = datetime.now().strftime("%Y%m%d")
    m = re.match(r"^(\d{8})([a-z])$", old or "")
    if not m:
        return today + "a"
    date, letter = m.group(1), m.group(2)
    if date != today:
        return today + "a"
    nxt = chr(ord(letter) + 1) if letter < "z" else "a"
    return date + nxt


def bump_all_versions():
    targets = [os.path.join(REPO, "index.html"), os.path.join(OFFLINE, "index.html")]
    new_ver = None
    for path in targets:
        if not os.path.exists(path):
            log("  (跳过，文件不存在)", path)
            continue
        txt = open(path, encoding="utf-8").read()
        m = re.search(r"const SEED_VER\s*=\s*'([^']+)'", txt)
        if not m:
            log("  !! 未找到 SEED_VER:", path)
            continue
        old = m.group(1)
        nv = bump_ver(old)
        new_ver = nv
        txt = txt.replace(f"const SEED_VER = '{old}'", f"const SEED_VER = '{nv}'")
        # 同步 personal-enhance.js 的 ?v=（否则浏览器继续吃旧缓存）
        txt = re.sub(r"(personal-enhance\.js\?v=)[0-9a-zA-Z]+", r"\g<1>" + nv, txt)
        open(path, "w", encoding="utf-8").write(txt)
        log(f"  版本 {old} -> {nv}  ({os.path.basename(os.path.dirname(path)) or 'repo'})")
    return new_ver


# ---------- 3) 同步离线包 ----------
def sync_offline():
    if not os.path.isdir(OFFLINE):
        log("  (跳过离线包，目录不存在)")
        return
    for fn in ["personal-enhance.js", "changelog.json"]:
        s = os.path.join(REPO, fn)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(OFFLINE, fn))
            log("  离线包已同步:", fn)


# ---------- main ----------
def main():
    args = sys.argv[1:]
    do_push = "--no-push" not in args
    extra = [a for a in args if a in ("--force", "-f") or a.startswith("--only=")]

    src_weeks = scan_source()
    cur = current_periods()
    log("源文件夹周期:", list(src_weeks.keys()))
    log("看板已收录  :", cur)
    missing = [w for w in src_weeks if w not in cur]
    if missing:
        log(">> 待导入的新周期:", missing)
    elif not extra:
        log(">> 没有发现新周期（如需强制重建请加 --force）")

    # 1) 跑聚合
    cmd = [PY, "-u", os.path.join(REPO, "sync_weekly.py")] + (extra or [])
    log("执行:", " ".join(os.path.basename(c) if os.path.sep in c else c for c in cmd))
    r = subprocess.run(cmd, cwd=REPO)
    if r.returncode != 0:
        log("!! 聚合脚本失败，终止")
        sys.exit(r.returncode)

    # 2) 刷新版本号
    log("刷新缓存版本号…")
    nv = bump_all_versions()

    # 3) 同步离线包（离线包不是 git 仓库，需手工覆盖）
    sync_offline()

    # 4) 提交推送
    if not do_push:
        log("已跳过推送（--no-push）。本地文件已更新。")
        return
    subprocess.run(["git", "add", "-A"], cwd=REPO)
    msg = f"周期数据同步 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    if missing:
        msg += " | 新周期: " + ", ".join(missing)
    if nv:
        msg += f" | ver {nv}"
    subprocess.run(["git", "commit", "-m", msg], cwd=REPO)
    r = subprocess.run(["git", "push", "origin", "main"], cwd=REPO)
    if r.returncode == 0:
        log(">> 推送完成，GitHub Pages 约 1–2 分钟生效，请 Ctrl+Shift+R 硬刷新")
    else:
        log("!! 推送失败，请检查网络 / git 凭据")


if __name__ == "__main__":
    main()
