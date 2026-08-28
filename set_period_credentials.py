# -*- coding: utf-8 -*-
"""交互式写入周期报表导出用的创量账号凭据。

这样密码不会出现在聊天记录里。在文件夹里双击 run_set_credentials.bat 即可，
或命令行执行：python set_period_credentials.py

写入的文件 period-export.config.json 已被 .gitignore 忽略，不会提交到 GitHub。
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "period-export.config.json")


def ask(prompt, secret=False):
    if secret:
        try:
            import getpass
            return getpass.getpass(prompt)
        except Exception:
            pass
    try:
        return input(prompt)
    except EOFError:
        return ""


def main():
    print("=" * 58)
    print("  周期看板 · 创量账号配置")
    print("  需要【有全量优化师权限】的账号（能看到广义新/低活/标点）")
    print("  李虹玉账号只能看个人数据，填在这里没有用")
    print("=" * 58)

    cur = {}
    if os.path.exists(CFG):
        try:
            cur = json.load(open(CFG, encoding="utf-8-sig"))
        except Exception:
            cur = {}

    u_default = cur.get("username", "")
    if "在这里填" in str(u_default):
        u_default = ""
    if u_default:
        print(f"当前账号: {u_default}")
    u = ask(f"邮箱/账号 [{u_default or '必填'}]: ").strip() or u_default
    if not u:
        print("!! 账号不能为空")
        sys.exit(1)

    print("密码输入时不显示，回车确认")
    pw = ask("密码: ", secret=True).strip()
    if not pw:
        print("!! 密码不能为空")
        sys.exit(1)

    cfg = {
        "_说明": "周期看板自动导出用的创量账号（需全量优化师权限）。已 gitignore，勿提交。",
        "username": u,
        "password": pw,
        "login_url": "https://cl.mobgi.com/login",
        "username_selector": "input[placeholder='请输入邮箱号']",
        "password_selector": "input[placeholder='请输入密码']",
        "submit_selector": "button.btn-submit",
        "preview_source": "本地缓存",
    }
    json.dump(cfg, open(CFG, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print()
    print(f"已写入 {CFG}")
    print(f"账号: {u}   密码: {'*' * len(pw)}")
    print()
    print("下一步：运行 run_export_period.bat 导出最新周期")


if __name__ == "__main__":
    main()
