# -*- coding: utf-8 -*-
"""把桌面离线包打包成便携 zip（排除备份/快捷方式），用于拷到其他电脑预览。"""
import os, zipfile, sys

SRC = r"C:\Users\EDY\Desktop\数据看板离线包"
OUT = r"F:\Workbuddy.renwu\2026-08-27-14-06-10\数据看板离线包_v20260829n.zip"
EXCLUDE = {"viral-kb.js.bak.20260827", "打开离线看板.url", ".env"}

def main():
    files = []
    for fn in sorted(os.listdir(SRC)):
        if fn in EXCLUDE:
            print("排除:", fn)
            continue
        p = os.path.join(SRC, fn)
        if os.path.isfile(p):
            files.append((fn, os.path.getsize(p)))
    total = sum(s for _, s in files)
    print(f"将打包 {len(files)} 个文件，共 {total/1024/1024:.1f} MB")
    done = 0
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for fn, size in files:
            z.write(os.path.join(SRC, fn), fn)
            done += 1
            if done % 5 == 0 or done == len(files):
                print(f"  [{done}/{len(files)}] {fn} ({size/1024/1024:.1f} MB)")
    zs = os.path.getsize(OUT) / 1024 / 1024
    print(f"\n完成: {OUT}")
    print(f"压缩后 {zs:.1f} MB（压缩率 {(1-zs/(total/1024/1024))*100:.0f}%）")

if __name__ == "__main__":
    main()
