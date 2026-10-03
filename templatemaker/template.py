"""家具テンプレート。「オフィスセットA」のような、名前のついた家具のまとまり。

形は Habitat の scene instance に倣う。素材（マニフェスト）と配置（ここ）を
分け、配置は素材を `asset_id` で参照して `translation` と `rotation` だけ持つ。
素材を差し替えてもテンプレートは壊れない。

**テンプレートはそれ自体が 1 つの家具。** Sweet Home 3D の `HomeFurnitureGroup`
が `HomePieceOfFurniture` を継承しているのと同じ考え方で、外形は子の外形から
出し、動かせば子が同じだけ動き、回せば子がまとめて回る。こうしておくと、置く
側がセットと単品を区別せずに済む。

回転は鉛直軸まわりだけ持つ。家具は倒れない。Sweet Home 3D は 20 年運用した
末に `horizontallyRotatable` を足しているが、それは例外を表す旗で、既定は
鉛直軸まわりのまま。最初から 3 軸を持つと、使われない自由度のために置く側の
処理が重くなる。
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import UTC, datetime
from pathlib import Path

VERSION = "tm-template-1"

#: 受理する版。増えたら足す。黙って読み飛ばさない
SUPPORTED = (VERSION,)

_SEP = re.compile(r"[\s_-]+")
_ID = re.compile(r"[^a-z0-9-]+")


def slug(name: str) -> str:
    """名前からファイル名を作る。

    **日本語の名前は ASCII に落ちると中身が消える。**「オフィスセットA」を
    素通しすると `a` になり、「リビングセット」は空になる。消えた分は名前
    そのものから安定な短縮を作って足す。`hash()` は実行ごとに変わるので
    使えない——同じ名前が実行のたびに別のファイルになる。
    """
    low = _SEP.sub("-", name.strip().lower()).strip("-")
    s = _ID.sub("-", low).strip("-")
    # 空白と下線を `-` に直すのは**欠落ではない**。字が落ちたときだけ足す
    if s == low and s:
        return s
    h = hashlib.sha1(name.strip().lower().encode("utf-8")).hexdigest()[:7]
    return f"{s}-{h}" if s else f"set-{h}"


def new(name: str, source: str = "") -> dict:
    return {
        "schema_version": VERSION,
        "id": slug(name),
        "name": name,
        "source_manifest": source,
        "created_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": [],
    }


def place(asset_id: str, category: str, xz: tuple[float, float],
          rotation: float = 0.0, y: float = 0.0) -> dict:
    """1 体を置く。`translation` は素材の bottom-center をどこへ運ぶか。

    y を持たせてあるのは、机の上のランプや壁掛けのため。床置きなら 0。
    """
    return {
        "asset_id": asset_id,
        "category": category,
        "translation": [xz[0], y, xz[1]],
        "rotation": rotation % 360,
    }


def footprint(item: dict, size: dict) -> tuple[float, float]:
    """回した後の水平の占有。回転は鉛直軸まわりなので 2 次元で足りる。"""
    t = math.radians(item["rotation"])
    c, s = abs(math.cos(t)), abs(math.sin(t))
    w, d = size["size"][0], size["size"][2]
    return w * c + d * s, w * s + d * c


def bbox(items: list[dict], sizes: dict[str, dict]) -> dict:
    """まとまりの外形。子から出す。空なら原点の一点。"""
    if not items:
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0],
                "size": [0.0, 0.0, 0.0], "center": [0.0, 0.0]}
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for it in items:
        s = sizes.get(it["asset_id"])
        if not s:
            continue
        fw, fd = footprint(it, s)
        x, y, z = it["translation"]
        for i, (c, half) in enumerate(((x, fw / 2), (None, None), (z, fd / 2))):
            if c is None:
                continue
            lo[i] = min(lo[i], c - half)
            hi[i] = max(hi[i], c + half)
        lo[1] = min(lo[1], y)
        hi[1] = max(hi[1], y + s["size"][1])
    if lo[0] == float("inf"):
        return bbox([], sizes)
    return {
        "min": lo, "max": hi,
        "size": [hi[i] - lo[i] for i in range(3)],
        "center": [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2],
    }


def recenter(t: dict, sizes: dict[str, dict]) -> dict:
    """まとまりの footprint 中心を原点へ寄せる。

    中心を基準にするのは、置いた後に回したとき**セットが自分の場所で回る**
    ため。先頭の家具を基準にすると、回すたびに全体が振り回される。
    """
    b = bbox(t["items"], sizes)
    cx, cz = b["center"]
    for it in t["items"]:
        it["translation"][0] -= cx
        it["translation"][2] -= cz
    return t


def validate(t: dict, known: set[str] | None = None) -> list[str]:
    """読めない理由を並べて返す。1 つ目で止めない——直す側は全部見たい。"""
    bad: list[str] = []
    if t.get("schema_version") not in SUPPORTED:
        bad.append(f"知らない版: {t.get('schema_version')}")
    if not t.get("name"):
        bad.append("名前が無い")
    for i, it in enumerate(t.get("items", [])):
        where = f"items[{i}]"
        if not it.get("asset_id"):
            bad.append(f"{where}: asset_id が無い")
        elif known is not None and it["asset_id"] not in known:
            bad.append(f"{where}: マニフェストに無い素材 {it['asset_id']}")
        tr = it.get("translation")
        if not (isinstance(tr, list) and len(tr) == 3
                and all(isinstance(v, (int, float)) for v in tr)):
            bad.append(f"{where}: translation が 3 つの数でない")
        if not isinstance(it.get("rotation"), (int, float)):
            bad.append(f"{where}: rotation が数でない")
    return bad


def save(t: dict, into: Path) -> Path:
    into.mkdir(parents=True, exist_ok=True)
    p = into / f"{t['id']}.json"
    p.write_text(json.dumps(t, ensure_ascii=False, indent=1) + "\n",
                 encoding="utf-8")
    return p


def load(path: Path) -> dict:
    t = json.loads(Path(path).read_text(encoding="utf-8"))
    if bad := validate(t):
        raise ValueError("; ".join(bad))
    return t


def listing(into: Path) -> list[dict]:
    """置いてあるテンプレートの一覧。壊れたものは理由を付けて残す。"""
    out = []
    for p in sorted(Path(into).glob("*.json")):
        try:
            t = load(p)
            out.append({"id": t["id"], "name": t["name"],
                        "count": len(t["items"]), "path": str(p)})
        except Exception as e:                        # noqa: BLE001
            out.append({"id": p.stem, "name": p.stem, "count": 0,
                        "path": str(p), "error": str(e)[:200]})
    return out
