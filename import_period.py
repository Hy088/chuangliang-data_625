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
  python import_period.py              # 抓下载文件夹 → 增量合并 → 刷版本 → 提交推送
  python import_period.py --force      # 全量重建所有周期（慢，约 1 分钟）
  python import_period.py --only="2026-08-16 ~ 2026-08-22"   # 只重建指定周期
  python import_period.py --no-push    # 只本地生成，不提交推送
  python import_period.py --no-pull    # 不从下载文件夹抓取，只处理源文件夹里已有的
  python import_period.py --days=0     # 抓取时不限制文件新旧（默认只抓近 14 天的）
  python import_period.py --replace="2026-08-16 ~ 2026-08-22"   # 用下载里的替换源文件夹旧分片

安全说明：抓取时若某周期在源文件夹已存在，默认跳过，避免同一周期多份分片被重复累加。

注意：周期看板数据与「个人数据（李虹玉账号）」是两条完全独立的数据源，
      本脚本只处理周期数据，不会碰 me-*.csv 及任何个人数据文件。
"""
import os, re, sys, subprocess, shutil
from datetime import datetime

REPO = os.path.dirname(os.path.abspath(__file__))
SRC = r"F:\Workbuddy.renwu\WorkBuddy_数据"
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")
DESKTOP = os.path.join(os.path.expanduser("~"), "Desktop")
PULL_DIRS = [DOWNLOADS, DESKTOP]
OFFLINE = r"C:\Users\EDY\Desktop\数据看板离线包"
# 宽松匹配：素材报表-不限_2026-08-23-2026-08-29_xxx.csv 也能认，
# 用户手动改名成 素材报表_2026-08-23-2026-08-29.csv 同样认
PERIOD_RE = re.compile(r"(\d{4}-\d{2}-\d{2})\s*[-~]\s*(\d{4}-\d{2}-\d{2})")
SKIP_EXT = (".crdownload", ".part", ".tmp", ".zip")

PY = sys.executable


def log(*a):
    print("[import]", *a, flush=True)


# ---------- 1) 先看看源文件夹里有什么 ----------
def scan_weeks(folder):
    """扫描文件夹里创量素材报表 CSV，按文件名里的日期区间分组"""
    weeks = {}
    if not os.path.isdir(folder):
        return weeks
    for fn in os.listdir(folder):
        low = fn.lower()
        if not low.endswith(".csv"):
            continue
        if any(low.endswith(e) for e in SKIP_EXT):
            continue
        if "素材报表" not in fn:
            continue
        m = PERIOD_RE.search(fn)
        if not m:
            continue
        label = f"{m.group(1)} ~ {m.group(2)}"
        weeks.setdefault(label, []).append(fn)
    return {k: sorted(v) for k, v in sorted(weeks.items())}


def scan_source():
    if not os.path.isdir(SRC):
        log("!! 源文件夹不存在:", SRC)
        return {}
    return scan_weeks(SRC)


def auto_pull_downloads(replace_periods=(), max_days=14, dirs=None):
    """从「下载」「桌面」自动抓取新导出的周期报表 CSV 到源文件夹。

    安全规则（重要，避免重复计数导致数据翻倍）：
      1. 该周期在源文件夹里已存在 → 默认跳过（下载里的多半是被重新导出取代的旧分片）
      2. 确需替换旧分片 → 用 --replace="周期标签"，旧分片先移入 _trash 再拷新的
      3. 只抓最近 max_days 天内修改过的文件（--days=0 表示不限）
      4. 跳过未下载完的 .crdownload / .part
    """
    dirs = dirs or [d for d in PULL_DIRS if os.path.isdir(d)]
    if not dirs:
        log("  (跳过抓取：下载/桌面文件夹都不存在)")
        return 0
    log("  扫描:", ", ".join(dirs))
    found = {}
    for d in dirs:
        for label, fns in scan_weeks(d).items():
            found.setdefault(label, []).extend((d, fn) for fn in fns)
    if not found:
        log("  没有找到「素材报表」CSV")
        return 0
    src = scan_weeks(SRC)

    cutoff = None
    if max_days and max_days > 0:
        cutoff = datetime.now().timestamp() - max_days * 86400

    copied = 0
    for label, fns in found.items():
        # 安全闸：该周期源文件夹里已有 → 默认跳过（下载里的常是被重导取代的旧分片）
        if label in src and label not in replace_periods:
            log(f"  跳过 [{label}]：源文件夹已有该周期（{len(src[label])} 个分片）。"
                f'确需替换请加 --replace="{label}"')
            continue
        if label in replace_periods and label in src:
            trash = os.path.join(SRC, "_trash", datetime.now().strftime("%Y%m%d_%H%M%S"))
            os.makedirs(trash, exist_ok=True)
            for old in src[label]:
                shutil.move(os.path.join(SRC, old), os.path.join(trash, old))
            log(f"  旧分片已移入 _trash：{len(src[label])} 个")

        for folder, fn in fns:
            spath = os.path.join(folder, fn)
            try:
                st = os.stat(spath)
                ssize = st.st_size
            except Exception:
                continue
            if cutoff and st.st_mtime < cutoff:
                log(f"  跳过（{max_days} 天前的旧文件）: {fn}")
                continue
            dpath = os.path.join(SRC, fn)
            if os.path.exists(dpath):
                try:
                    if os.path.getsize(dpath) == ssize:
                        continue          # 已复制过
                except Exception:
                    pass
                # 同名但大小不同 → 加后缀避免覆盖
                base, ext = os.path.splitext(fn)
                dpath = os.path.join(SRC, f"{base}__dup{ext}")
            shutil.copy2(spath, dpath)
            copied += 1
            log(f"  抓取 [{label}] {fn}  ({round(ssize/1024/1024,1)} MB)")
    return copied


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
    do_pull = "--no-pull" not in args
    extra = [a for a in args if a in ("--force", "-f") or a.startswith("--only=")]
    replace = [a[len('--replace='):].strip() for a in args if a.startswith("--replace=")]
    days = 14
    for a in args:
        if a.startswith("--days="):
            try:
                days = int(a[len('--days='):])
            except Exception:
                pass

    # 0) 先从「下载」文件夹抓新 CSV
    if do_pull:
        log("扫描下载文件夹…")
        auto_pull_downloads(replace_periods=replace, max_days=days)

    src_weeks = scan_source()
    cur = current_periods()
    log("源文件夹周期:", list(src_weeks.keys()))
    log("看板已收录  :", cur)
    missing = [w for w in src_weeks if w not in cur]
    if missing:
        log(">> 待导入的新周期:", missing)
    elif not extra:
        log(">> 没有发现新周期。")
        log("   手动补周期的做法：创量导出后把 CSV 丢进下面任一位置，再重跑本脚本")
        log("     · " + DOWNLOADS)
        log("     · " + DESKTOP)
        log("     · " + SRC + "   ← 也可以直接放这里")
        log("   文件名保持创量原样即可（素材报表-不限_开始-结束_xxx.csv）。")
        log("   如需强制重建所有周期：python import_period.py --force")

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
