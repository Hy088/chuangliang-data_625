"""把 period-materials.json 的「视频/图片」素材类型占比预聚合进 period-meta.json，
新增顶层 typeShare 字段，使前端模块3(素材结构分析)首屏即可渲染，不再依赖 35MB 素材明细。
"""
import json
from collections import defaultdict

META = "period-meta.json"
MAT = "period-materials.json"


def main():
    with open(META, encoding="utf-8") as f:
        meta = json.load(f)
    with open(MAT, encoding="utf-8") as f:
        mat = json.load(f)

    cols = mat.get("cols", [])
    iMt = cols.index("mtype")
    iCost = cols.index("cost")
    iImp = cols.index("imp")
    iClk = cols.index("clk")
    iCv = cols.index("cv")

    t = defaultdict(lambda: {"cost": 0.0, "imp": 0, "clk": 0, "cv": 0, "n": 0})
    for r in mat.get("rows", []):
        k = r[iMt] or "其他"
        o = t[k]
        o["cost"] += r[iCost]
        o["imp"] += r[iImp]
        o["clk"] += r[iClk]
        o["cv"] += r[iCv]
        o["n"] += 1

    typeShare = [{"type": k, **t[k]} for k in sorted(t, key=lambda k: -t[k]["cost"])]
    meta["typeShare"] = typeShare

    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print("typeShare 注入完成，类型数:", len(typeShare))
    for x in typeShare:
        print("  %s  消耗=%.2f 素材数=%d 转化=%d" % (x["type"], x["cost"], x["n"], x["cv"]))


if __name__ == "__main__":
    main()
