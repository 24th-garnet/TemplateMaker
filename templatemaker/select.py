"""取捨選択の基準。**純関数だけを置く。** 取得も書き出しもここではしない。

選定は安価で決定的、取得は高価。分けておくと、基準を直して選び直しても
再ダウンロードが起きない。基準は `criteria()` でそのまま書き出せる形にして
マニフェストへ埋め、**何でこの集合になったのか**を後から読めるようにする。

寸法は品目ごとに上限を持つ。一律の上限にしないのは、ソファの 2.1m と
ミラーの 2.1m が住宅に対して持つ意味がまるで違うため。北米カタログを
日本の住宅へ持ち込むときに効くのはここなので、表を外から見える場所に置く。
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence

from . import category as cat

#: 寸法が壊れているものを外す。ABO には 221m の家具が実在する
SANE_MIN = 0.02
SANE_MAX = 3.5

#: 間引き前の面数の上限。これを超えるものは素材として扱いにくい
MAX_FACES = 200_000

#: 品目ごとの上限 (幅, 奥行, 高さ)。単位 m
#:
#: **幅は水平の長い方、奥行は短い方。** glTF の X/Z のどちらが幅かは
#: 書き出し側の都合で決まり当てにできないので、大小で取る。高さだけは
#: Y-up が保証されるので Y をそのまま見る。
#:
#: 値は日本の住宅を通る上限。ベッドの奥行 1.6m はダブル（140cm）までを
#: 通しキング（200cm 級）を落とすため。
LIMITS: dict[str, tuple[float, float, float]] = {
    cat.CHAIR:         (0.90, 0.95, 1.40),
    cat.SOFA:          (2.10, 1.00, 1.00),
    cat.STOOL:         (0.90, 0.80, 0.70),
    cat.BENCH:         (1.70, 0.60, 1.00),
    cat.TABLE:         (1.80, 1.10, 0.85),
    cat.DESK:          (1.60, 0.80, 1.30),
    cat.BED:           (2.15, 1.60, 1.30),
    cat.STORAGE:       (1.40, 0.60, 2.10),
    cat.LAMP:          (0.70, 0.70, 1.90),
    cat.PLANTER:       (0.80, 0.80, 1.60),
    cat.DECOR:         (0.60, 0.60, 0.90),
    cat.RUG:           (3.00, 2.20, 0.08),
    cat.HEADBOARD:     (1.60, 0.30, 1.40),
    cat.MIRROR:        (1.10, 0.30, 2.00),
    cat.WALL_DECOR:    (1.50, 0.20, 1.50),
    cat.CEILING_LIGHT: (1.00, 1.00, 1.20),
}

#: 間引きやすい面数の帯。ここを外れるものは後回しにする（除外はしない）
EASY_FACES = (3_000, 60_000)


def wdh(extent: Sequence[float]) -> tuple[float, float, float]:
    """(x, y, z) を (幅, 奥行, 高さ) に直す。"""
    x, y, z = extent
    return max(x, z), min(x, z), y


def is_sane(item: dict) -> bool:
    """寸法が壊れていないか。"""
    return all(SANE_MIN <= v <= SANE_MAX for v in item["extent"])


def fits(item: dict) -> bool:
    """品目の上限に収まるか。未知の品目は通さない。"""
    lim = LIMITS.get(item.get("category"))
    if lim is None:
        return False
    return all(v <= m for v, m in zip(wdh(item["extent"]), lim))


def signature(item: dict) -> tuple:
    """形の同一性。色違いバリアントをまとめるための鍵。

    ABO は同じ家具を色だけ変えて別 ASIN で出す。頂点数・面数・寸法が
    揃えば同じ形とみなしてよい（最大 11 体が同一形状だった）。
    """
    return (item["vertices"], item["faces"],
            *(round(v, 4) for v in item["extent"]))


def handling(item: dict) -> tuple[float, int]:
    """取り回しの良さ。小さいほど良い。並べ替えにだけ使う。"""
    f = item["faces"]
    lo, hi = EASY_FACES
    penalty = 0.0 if lo <= f <= hi else abs(f - hi) / hi
    return (penalty, item["bytes"])


def passes(item: dict) -> bool:
    """1 体が基準を通るか。"""
    return (item.get("category") in LIMITS
            and is_sane(item)
            and fits(item)
            and item["faces"] <= MAX_FACES)


def filter_items(items: Iterable[dict]) -> list[dict]:
    """基準を通し、同じ形は 1 体に畳む。

    畳むときは取り回しの良い方を残す。どれが残るかが実行ごとに変わると
    マニフェストの差分が無意味になるので、同点は id で決める。
    """
    kept: dict[tuple, dict] = {}
    for it in sorted(items, key=lambda x: (handling(x), x["id"])):
        if not passes(it):
            continue
        kept.setdefault(signature(it), it)
    return sorted(kept.values(), key=lambda x: (x["category"], x["id"]))


def per_category(items: Iterable[dict], n: int | None) -> list[dict]:
    """品目ごとに上位 n 体へ絞る。n が None なら絞らない。

    全体で n 体にしないのは、椅子が 907 体ある一方でベンチが 34 体しか
    無いため。総数で切ると椅子だけのセットになる。
    """
    items = list(items)
    if n is None:
        return sorted(items, key=lambda x: (x["category"], x["id"]))
    by: dict[str, list[dict]] = {}
    for it in items:
        by.setdefault(it["category"], []).append(it)
    out: list[dict] = []
    for c in sorted(by):
        out += sorted(by[c], key=lambda x: (handling(x), x["id"]))[:n]
    return sorted(out, key=lambda x: (x["category"], x["id"]))


#: 段階。少ない方から試して、通ったら広げる
TIERS: dict[str, int | None] = {"a": 5, "b": 25, "c": 100, "d": None}


def criteria(tier: str) -> dict:
    """適用した基準。マニフェストへ埋めて再現できるようにする。"""
    return {
        "tier": tier,
        "per_category": TIERS[tier],
        "sane_range_m": [SANE_MIN, SANE_MAX],
        "max_faces": MAX_FACES,
        "limits_wdh_m": {k: list(v) for k, v in sorted(LIMITS.items())},
    }


def apply(items: Iterable[dict], tier: str) -> list[dict]:
    """基準を通して段階まで絞る。"""
    if tier not in TIERS:
        raise ValueError(f"知らない段階: {tier}（{'/'.join(TIERS)}）")
    return per_category(filter_items(items), TIERS[tier])
