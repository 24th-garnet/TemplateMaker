"""品目の語彙。**出どころに依存しない。**

ABO の `product_type` も Poly Haven のタグも、そのまま使うと取捨選択の基準が
出どころの数だけ増える。各ソースは自分の語彙をここへ写してから渡し、
基準はこの語彙だけを見る。ソースを足しても `select` は触らずに済む。

語彙の粒度は**置き方が変わる単位**で切ってある。壁に掛ける（`mirror`,
`wall_decor`）、天井から吊る（`ceiling_light`）、床に敷く（`rug`）、床に置く
（残り）で扱いが分かれるため、見た目が似ていても別の品目にしている。
"""
from __future__ import annotations

#: 床に置く家具
CHAIR = "chair"
SOFA = "sofa"
STOOL = "stool"
BENCH = "bench"
TABLE = "table"
DESK = "desk"
BED = "bed"
STORAGE = "storage"
LAMP = "lamp"
PLANTER = "planter"
DECOR = "decor"

#: 床に敷く
RUG = "rug"

#: 壁に付く
HEADBOARD = "headboard"
MIRROR = "mirror"
WALL_DECOR = "wall_decor"

#: 天井から吊る
CEILING_LIGHT = "ceiling_light"

ALL = (CHAIR, SOFA, STOOL, BENCH, TABLE, DESK, BED, STORAGE, LAMP,
       PLANTER, DECOR, RUG, HEADBOARD, MIRROR, WALL_DECOR, CEILING_LIGHT)

#: 置き方。配置の既定値を決めるのに使う
PLACEMENT = {
    RUG: "floor_flat",
    HEADBOARD: "wall",
    MIRROR: "wall",
    WALL_DECOR: "wall",
    CEILING_LIGHT: "ceiling",
}


def placement(cat: str) -> str:
    """品目の置き方。既定は床置き。"""
    return PLACEMENT.get(cat, "floor")
