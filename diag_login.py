# -*- coding: utf-8 -*-
"""诊断：登录后到底停在哪个页面，页面上有什么按钮。用于校准 export_period.py 的流程。"""
import json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
cfg = json.load(open(HERE / "period-export.config.json", "r", encoding="utf-8-sig"))
from playwright.sync_api import sync_playwright

OUT = HERE / "_diag"
OUT.mkdir(exist_ok=True)
HEADFUL = "--headful" in sys.argv


def dump(page, tag):
    try:
        page.screenshot(path=str(OUT / f"{tag}.png"), full_page=True)
    except Exception as e:
        print("  screenshot fail:", e)
    try:
        info = page.evaluate("""() => ({
            url: location.href,
            title: document.title,
            buttons: [...document.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,40),
            inputs: [...document.querySelectorAll('input')].map(i=>({ph:i.placeholder||'', type:i.type, val:(i.type==='password'?'***':(i.value||''))})).slice(0,20),
            bodyText: (document.body.innerText||'').slice(0,1200)
        })""")
        print(f"--- {tag} ---")
        print("URL   :", info["url"])
        print("TITLE :", info["title"])
        print("BUTTON:", info["buttons"])
        print("INPUT :", info["inputs"])
        print("TEXT  :", info["bodyText"].replace("\n", " | ")[:900])
    except Exception as e:
        print("  evaluate fail:", e)


with sync_playwright() as p:
    b = p.chromium.launch(headless=not HEADFUL)
    ctx = b.new_context(accept_downloads=True)
    page = ctx.new_page()

    print("== 1) 打开登录页 ==")
    page.goto(cfg["login_url"], wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(2000)
    dump(page, "1_login")

    print("== 2) 填账号密码 ==")
    page.fill(cfg["username_selector"], cfg["username"])
    page.fill(cfg["password_selector"], cfg["password"])
    page.wait_for_timeout(800)
    dump(page, "2_filled")

    print("== 3) 点提交 ==")
    try:
        page.wait_for_selector("button.btn-submit:not(.is-disabled)", timeout=10000)
    except Exception:
        pass
    page.click(cfg["submit_selector"])
    page.wait_for_timeout(6000)
    dump(page, "3_after_submit")

    print("== 4) 等 10 秒看是否有跳转 ==")
    page.wait_for_timeout(10000)
    dump(page, "4_after_wait")

    print("== 5) 直接访问报表页 ==")
    page.goto("https://cl.mobgi.com/material/common/materialreport", wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(5000)
    dump(page, "5_report")

    if HEADFUL:
        print("\n浏览器保持打开，按回车结束…")
        input()
    b.close()
print("诊断完成，截图在", OUT)
