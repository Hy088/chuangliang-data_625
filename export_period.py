# -*- coding: utf-8 -*-
"""
周期看板「自动导出」脚本
========================
用**有全量优化师权限的创量账号**登录素材报表页，按周期（周日~周六，7 天一档）
导出「素材报表-不限」CSV，从下载中心拉回本地源文件夹。

⚠️ 与「个人数据（李虹玉账号）」完全无关。本脚本只服务周期看板 / 项目看板。

前置：
  1. 填好凭据：period-export.config.json（首次运行会引导创建，该文件已 gitignore）
  2. 装好 playwright：本机 managed python 已自带

用法：
  python export_period.py                       # 导出「最新未收录周期」（默认）
  python export_period.py --start=2026-08-23 --end=2026-08-29
  python export_period.py --last                # 重导「最近一个已收录周期」（配合 --replace 使用）
  python export_period.py --headful             # 有头模式，遇到验证码/二次验证时用
  python export_period.py --no-import           # 只下载，不接着跑 import_period.py
  python export_period.py --wait=900            # 下载中心最长等待秒数（默认 900）

导出完成后会自动调用 import_period.py 完成合并 + 刷版本 + 推送。
"""
import json, os, re, sys, time, shutil, subprocess
from datetime import datetime, date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r"F:\Workbuddy.renwu\WorkBuddy_数据"
CFG_PATH = os.path.join(HERE, "period-export.config.json")
REPORT_URL = "https://cl.mobgi.com/material/common/materialreport"
DLCENTER_URL = "https://cl.mobgi.com/assist/systemtools/download"
PERIOD_RE = re.compile(r"(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})_")


def log(*a):
    print("[export]", *a, flush=True)


# ---------------- 周期计算 ----------------
def recorded_periods():
    p = os.path.join(HERE, "period-meta.json")
    if not os.path.exists(p):
        return []
    try:
        return list(json.load(open(p, encoding="utf-8")).get("meta", {}).get("periods", []))
    except Exception:
        return []


def parse_period_end(s):
    m = re.search(r"~\s*(\d{4}-\d{2}-\d{2})", s or "")
    if not m:
        return None
    y, mo, d = map(int, m.group(1).split("-"))
    return date(y, mo, d)


def next_period():
    """最新未收录周期 = 已收录最新周期的结束日+1，往后 7 天"""
    ps = recorded_periods()
    if not ps:
        return None
    end = parse_period_end(ps[-1])
    if not end:
        return None
    s = end + timedelta(days=1)
    return s, s + timedelta(days=6)


def last_period():
    """最近一个已收录周期"""
    ps = recorded_periods()
    if not ps:
        return None
    m = re.search(r"(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})", ps[-1])
    if not m:
        return None
    s = date(*map(int, m.group(1).split("-")))
    e = date(*map(int, m.group(2).split("-")))
    return s, e


# ---------------- 配置 ----------------
def load_cfg():
    if not os.path.exists(CFG_PATH):
        tmpl = {
            "_说明": "周期看板自动导出用的创量账号（需要有全量优化师权限，李虹玉账号不行）。本文件已 gitignore，勿提交。",
            "username": "在这里填邮箱",
            "password": "在这里填密码",
            "login_url": "https://cl.mobgi.com/login",
            "username_selector": "input[placeholder='请输入邮箱号']",
            "password_selector": "input[placeholder='请输入密码']",
            "submit_selector": "button.btn-submit",
            "preview_source": "本地缓存",
        }
        json.dump(tmpl, open(CFG_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        log("已生成配置模板:", CFG_PATH)
        log("请填好 username / password 后重跑。")
        sys.exit(2)
    cfg = json.load(open(CFG_PATH, encoding="utf-8-sig"))
    if "在这里填" in str(cfg.get("username", "")) or not cfg.get("password"):
        log("!! 凭据未填写:", CFG_PATH)
        sys.exit(2)
    return cfg


# ---------------- 主流程 ----------------
def main():
    args = sys.argv[1:]
    headful = "--headful" in args
    do_import = "--no-import" not in args
    use_last = "--last" in args
    wait_sec = 900
    start = end = None
    for a in args:
        if a.startswith("--start="):
            start = a.split("=", 1)[1]
        elif a.startswith("--end="):
            end = a.split("=", 1)[1]
        elif a.startswith("--wait="):
            try:
                wait_sec = int(a.split("=", 1)[1])
            except Exception:
                pass

    if start and end:
        s = date(*map(int, start.split("-")))
        e = date(*map(int, end.split("-")))
    else:
        got = last_period() if use_last else next_period()
        if not got:
            log("!! 无法确定周期，请用 --start= --end= 指定")
            sys.exit(3)
        s, e = got

    START_DAY, END_DAY = s.isoformat(), e.isoformat()
    label = f"{START_DAY} ~ {END_DAY}"
    log("目标周期:", label, f"（{['周一','周二','周三','周四','周五','周六','周日'][s.weekday()]}~"
                            f"{['周一','周二','周三','周四','周五','周六','周日'][e.weekday()]}）")
    if e >= date.today():
        log("⚠️ 该周期今天尚未走完，导出的最后一天数据会不完整。建议明早再跑一次覆盖。")

    cfg = load_cfg()
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as p:
        b = p.chromium.launch(headless=not headful)
        ctx = b.new_context(accept_downloads=True)
        page = ctx.new_page()

        # --- 登录 ---
        log("登录…", cfg["username"])
        page.goto(cfg["login_url"], wait_until="networkidle", timeout=60000)
        page.fill(cfg["username_selector"], cfg["username"])
        page.fill(cfg["password_selector"], cfg["password"])
        try:
            page.wait_for_selector("button.btn-submit:not(.is-disabled)", timeout=10000)
        except Exception:
            pass
        page.click(cfg["submit_selector"])
        page.wait_for_timeout(3000)
        try:
            page.click("text=标准版", timeout=15000)
        except Exception:
            log("  (未找到「标准版」按钮，跳过)")
        page.wait_for_timeout(4000)
        if "/login" in page.url:
            log("!! 登录失败，仍停留在登录页。请检查账号密码 / 是否需要验证码")
            if not headful:
                log("   提示：加 --headful 可看到页面，手动过验证码")
            b.close()
            sys.exit(4)
        log("  已登录")

        # --- 进报表页 ---
        page.goto(REPORT_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(5000)

        # 媒体=不限
        try:
            page.click("label.el-radio-button:has-text('不限')", timeout=8000)
            page.wait_for_timeout(1200)
        except Exception as e:
            log("  (媒体=不限 未点到:", e, ")")
        # 粒度=日汇总
        try:
            page.click("label.el-radio-button:has-text('日汇总')", timeout=8000)
            page.wait_for_timeout(1000)
        except Exception as e:
            log("  (粒度=日汇总 未点到:", e, ")")

        # --- 日期区间 ---
        log("设置日期范围", START_DAY, "~", END_DAY)
        page.fill("input[placeholder='开始日期']", START_DAY)
        page.fill("input[placeholder='结束日期']", END_DAY)
        page.wait_for_timeout(500)
        qb = page.locator("button:has-text('查询')").first
        for _ in range(10):
            try:
                if not qb.is_disabled():
                    qb.click(timeout=8000)
                    break
            except Exception:
                pass
            page.wait_for_timeout(2000)
        try:
            page.wait_for_function(
                "() => document.querySelectorAll('.el-table__body tr').length > 0",
                timeout=60000)
        except Exception as e:
            log("  (表格未加载:", e, ")")
        page.wait_for_timeout(2000)

        # --- 先给下载中心拍个快照，避免误下旧任务 ---
        page.goto(DLCENTER_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)

        def dl_tasks():
            return page.evaluate("""() => {
                const tb = document.querySelector('.el-table');
                if (!tb) return [];
                return [...tb.querySelectorAll('tbody tr')].map(tr =>
                    [...tr.children].map(td => (td.innerText || '').trim()));
            }""")

        before = {r[0] for r in dl_tasks() if r}
        log("下载中心现有任务:", len(before))

        # --- 回到报表页触发导出 ---
        page.goto(REPORT_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(4000)
        try:
            page.click("label.el-radio-button:has-text('不限')", timeout=8000)
            page.wait_for_timeout(1000)
        except Exception:
            pass
        page.fill("input[placeholder='开始日期']", START_DAY)
        page.fill("input[placeholder='结束日期']", END_DAY)
        page.wait_for_timeout(500)
        qb = page.locator("button:has-text('查询')").first
        for _ in range(10):
            try:
                if not qb.is_disabled():
                    qb.click(timeout=8000)
                    break
            except Exception:
                pass
            page.wait_for_timeout(2000)
        page.wait_for_timeout(3000)

        log("点击「导出数据」…")
        page.locator("text=导出数据").first.click()
        try:
            dlg = page.locator('.el-dialog:has-text("请选择素材预览地址的来源"):visible')
            dlg.wait_for(timeout=15000)
            dlg.locator(f"text={cfg.get('preview_source', '本地缓存')}").first.click()
            page.wait_for_timeout(400)
            dlg.locator("button.el-button--primary").click()
        except Exception as e:
            log("  (预览来源弹窗未出现，可能直接提交了:", e, ")")

        # 关掉可能出现的提示框
        page.wait_for_timeout(2500)
        page.evaluate("""() => {
            document.querySelectorAll('.el-message-box__wrapper').forEach(w => {
                const st = getComputedStyle(w);
                if (st.display !== 'none' && st.visibility !== 'hidden') {
                    const b = w.querySelectorAll('.el-message-box__btns button');
                    if (b.length) b[b.length - 1].click();
                }
            });
        }""")
        page.wait_for_timeout(1000)

        # --- 下载中心轮询新任务 ---
        log("前往下载中心轮询（最多", wait_sec, "秒）…")
        page.goto(DLCENTER_URL, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)

        key = START_DAY.replace("-", "") + "-" + END_DAY.replace("-", "")
        done_names, deadline = [], time.time() + wait_sec
        seen_new = set()
        attempt = 0
        while time.time() < deadline:
            attempt += 1
            rows = dl_tasks()
            new_rows = [r for r in rows if r and r[0] not in before]
            for r in new_rows:
                seen_new.add(r[0])
            ready = [r[0] for r in new_rows
                     if key in r[0] and len(r) > 1 and "处理完成" in r[1]]
            other = [r[0] for r in new_rows if key in r[0] and len(r) > 1 and "处理完成" not in r[1]]
            log(f"  轮询{attempt}: 新任务 {len(seen_new)} 个，已完成 {len(ready)} 个"
                + (f"，进行中 {len(other)} 个" if other else ""))
            if ready:
                # 给创量一点时间把多个分片任务全部生成（等 2 轮不再增多）
                done_names = ready
                page.wait_for_timeout(8000)
                rows2 = [r for r in dl_tasks() if r and r[0] not in before]
                ready2 = [r[0] for r in rows2
                          if key in r[0] and len(r) > 1 and "处理完成" in r[1]]
                if len(ready2) > len(ready):
                    log(f"  分片数 {len(ready)} -> {len(ready2)}，继续等待…")
                    continue
                done_names = ready2
                break
            page.wait_for_timeout(6000)
            page.reload(wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)

        if not done_names:
            log("!! 未等到「处理完成」的导出任务。")
            log("   可能原因：导出被频控、日期区间无数据、或等待时间不够（可加大 --wait=）。")
            b.close()
            sys.exit(5)

        log(f"准备下载 {len(done_names)} 个分片…")
        saved = []
        os.makedirs(SRC, exist_ok=True)
        for i, tname in enumerate(done_names, 1):
            try:
                with page.expect_download(timeout=180000) as dl_info:
                    page.evaluate("""(taskName) => {
                        const rows = [...document.querySelectorAll('.el-table__body tr')];
                        for (const tr of rows) {
                            const tds = [...tr.children];
                            if (tds[0] && tds[0].innerText.trim() === taskName) {
                                const btn = tds[tds.length - 1].querySelector('button');
                                if (btn) btn.click();
                                break;
                            }
                        }
                    }""", tname)
                dl = dl_info.value
                sug = dl.suggested_filename or f"export_{i}.csv"
                stem, ext = os.path.splitext(sug)
                ext = ext or ".csv"
                if PERIOD_RE.search(stem):
                    fname = stem + ext
                else:
                    tail = stem.split("_")[-1] if "_" in stem else str(int(time.time()))
                    fname = f"素材报表-不限_{START_DAY}-{END_DAY}_{tail}{ext}"
                dest = os.path.join(SRC, fname)
                if os.path.exists(dest):
                    dest = os.path.join(SRC, f"{os.path.splitext(fname)[0]}__dup{ext}")
                dl.save_as(dest)
                mb = round(os.path.getsize(dest) / 1024 / 1024, 1)
                log(f"  [{i}/{len(done_names)}] {os.path.basename(dest)}  ({mb} MB)")
                saved.append(dest)
            except PWTimeout:
                log(f"  [{i}] 下载超时: {tname}")
            except Exception as e:
                log(f"  [{i}] 下载失败: {e}")

        b.close()

    if not saved:
        log("!! 没有下载到任何文件")
        sys.exit(6)
    log(f"共下载 {len(saved)} 个分片到 {SRC}")

    if do_import:
        log("接着执行 import_period.py …")
        cmd = [sys.executable, "-u", os.path.join(HERE, "import_period.py")]
        if use_last:
            cmd.append(f'--replace="{label}"')
        log("$", " ".join(cmd))
        subprocess.run(cmd, cwd=HERE)
    else:
        log("已跳过合并。手动执行：python import_period.py")


if __name__ == "__main__":
    main()
