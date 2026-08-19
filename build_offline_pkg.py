# -*- coding: utf-8 -*-
"""组装数据看板离线便携包：必需文件 + 便携启动器 -> zip"""
import os, shutil, zipfile

SRC = r"C:/Users/EDY/chuangliang_data"
PKG = os.path.join(SRC, "_exports", "offline_pkg")
OUT_ZIP = r"C:/Users/EDY/Desktop/数据看板离线包_2026-08-19.zip"

FILES = [
    # 页面与脚本
    "index.html", "chart.umd.js", "personal-enhance.js", "vparse-deep.js", "seedance-gen.js",
    # 数据
    "cases.json", "changelog.json",
    "period-meta.json", "period-data.json", "period-materials.json",
    "me-data.csv", "me-history.csv", "me-materials.csv", "me-uploads.csv", "me-uploads-august.csv",
    # 便携启动器
    "serve.js", "serve_offline.ps1", "start-offline.bat",
]

README = """【数据看板 · 离线便携版】使用说明
====================================

一、怎么打开
  1. 把整个文件夹（或解压后的文件夹）拷到任意 Windows 电脑
  2. 双击「start-offline.bat」
  3. 等浏览器自动打开 http://127.0.0.1:8788/ 即可看板
  4. 用完直接关掉黑色窗口

  原理：脚本会自动按 优先级 node → python → Windows自带PowerShell
  启动一个本地静态服务，任何电脑免安装都能打开。

二、能看什么（离线全部可用）
  - 项目看板 / 品类方向 / 素材·爆款（全部历史周期数据）
  - 视频解析 · 我的解析案例库（cases.json 已内置）
  - 个人数据（本地缓存数据）

三、哪些功能在这台电脑上不可用（属正常）
  - 「🎬 AI视频生成台」按钮：依赖本机 8900 端口的生成工具，
    只在工具主人自己的电脑上有效
  - AI 拆解/口播转写等联网 AI 功能：需要密钥与外网，
    离线包出于安全考虑不带密钥

四、数据更新
  离线包是打包时刻的快照。要看最新数据请用在线版：
  https://hy088.github.io/chuangliang-data_625/
"""

def main():
    if os.path.exists(PKG):
        shutil.rmtree(PKG)
    os.makedirs(PKG)
    missing = []
    total = 0
    for f in FILES:
        s = os.path.join(SRC, f)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(PKG, f))
            total += os.path.getsize(s)
        else:
            missing.append(f)
    with open(os.path.join(PKG, "README-使用说明.txt"), "w", encoding="utf-8-sig") as fp:
        fp.write(README)
    print("missing:", missing)
    print("package size: %.1f MB" % (total / 1024 / 1024))

    if os.path.exists(OUT_ZIP):
        os.remove(OUT_ZIP)
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in sorted(os.listdir(PKG)):
            z.write(os.path.join(PKG, f), "数据看板离线包/" + f)
    print("zip size: %.1f MB" % (os.path.getsize(OUT_ZIP) / 1024 / 1024))
    print("zip ->", OUT_ZIP)

if __name__ == "__main__":
    main()
