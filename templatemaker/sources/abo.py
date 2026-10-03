"""Amazon Berkeley Objects。**ABO 固有の事情はここに閉じ込める。**

7,953 点の glTF 2.0 が、ASIN 指定で 1 体ずつ公開 S3 から引ける。ライセンスは
2023 年に CC BY-NC から CC BY 4.0 へ変わっており、帰属表記だけで商用に使える。

**メッシュは [-1, 1] に正規化され、実寸は root ノードの `scale` が持つ。**
頂点をそのまま読むと全部 1 辺 2m になる。ここでは GLB を解かないので直接の
問題にはならないが、受け取る側がノード変換を畳むことを前提にしている
（CaptureVisualizer の `assets.read_glb` は畳む）。寸法はカタログ側の
`extent_x/y/z` を信じる。こちらは実寸（m）で入っている。
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import re
import urllib.parse
import urllib.request
from collections.abc import Iterator, Sequence
from pathlib import Path

from .. import category as cat

BASE = "https://amazon-berkeley-objects.s3.amazonaws.com/"
MODELS_CSV = "3dmodels/metadata/3dmodels.csv.gz"
IMAGES_CSV = "images/metadata/images.csv.gz"
LISTING_SHARDS = "0123456789abcdef"

LICENSE = "CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = "Amazon Berkeley Objects (ABO)"

#: 商品名を読む言語。**上から順に探す。** ja_JP は無い
#:
#: 指定せず先頭を取ると韓国語や中国語が入る。en_US は 6,729 体にしか無く、
#: 欧州ブランド（Movian など）は en_GB か現地語しか持たない。帰属表記は
#: 作品を特定できないと意味がないので、英語が無ければ現地語へ落とす。
LANGS = ("en_US", "en_GB", "en_IN", "en_CA", "en_AE", "en_SG")

#: `product_type` から品目へ。ここに無いものは素材として使わない
PRODUCT_TYPE = {
    "CHAIR": cat.CHAIR, "BEAN_BAG_CHAIR": cat.CHAIR,
    "SOFA": cat.SOFA,
    "STOOL_SEATING": cat.STOOL, "OTTOMAN": cat.STOOL,
    "BENCH": cat.BENCH,
    "TABLE": cat.TABLE,
    "DESK": cat.DESK,
    "BED": cat.BED, "BED_FRAME": cat.BED,
    "HEADBOARD": cat.HEADBOARD,
    "CABINET": cat.STORAGE, "SHELF": cat.STORAGE, "DRESSER": cat.STORAGE,
    "STORAGE_BOX": cat.STORAGE, "CLOTHES_RACK": cat.STORAGE,
    "LAMP": cat.LAMP,
    "LIGHT_FIXTURE": cat.CEILING_LIGHT,
    "HOME_MIRROR": cat.MIRROR,
    "RUG": cat.RUG,
    "WALL_ART": cat.WALL_DECOR,
    "PLANTER": cat.PLANTER,
    "VASE": cat.DECOR,
}

#: 中身が混ざっている `product_type`。商品名で解き直す
#:
#: `HOME_FURNITURE_AND_DECOR`（549 体）はソファ・オットマン・ラグ・収納が
#: 同居し、`HOME`（176 体）はほぼ壁掛けアートとミラー。数が多いので捨てられず、
#: かといって 1 つの品目へ寄せると配置の既定値が壊れる。
MIXED = {"HOME_FURNITURE_AND_DECOR", "HOME", "FURNITURE", "HOME_BED_AND_BATH"}

#: 商品名から品目を引く。**上から順に当てる。** 長い語を先に置く
KEYWORDS: tuple[tuple[str, str], ...] = (
    ("love seat", cat.SOFA), ("loveseat", cat.SOFA), ("sectional", cat.SOFA),
    ("sofa", cat.SOFA), ("couch", cat.SOFA), ("settee", cat.SOFA),
    ("ottoman", cat.STOOL), ("pouf", cat.STOOL), ("footstool", cat.STOOL),
    ("stool", cat.STOOL),
    ("bench", cat.BENCH),
    ("runner rug", cat.RUG), ("area rug", cat.RUG), ("rug", cat.RUG),
    ("headboard", cat.HEADBOARD),
    ("mirror", cat.MIRROR),
    ("wall art", cat.WALL_DECOR), ("chalkboard", cat.WALL_DECOR),
    ("wall decor", cat.WALL_DECOR), ("canvas", cat.WALL_DECOR),
    ("bookcase", cat.STORAGE), ("etagere", cat.STORAGE),
    ("sideboard", cat.STORAGE), ("credenza", cat.STORAGE),
    ("nightstand", cat.STORAGE), ("dresser", cat.STORAGE),
    ("cabinet", cat.STORAGE), ("console", cat.STORAGE),
    ("shelf", cat.STORAGE), ("cart", cat.STORAGE), ("chest", cat.STORAGE),
    ("desk", cat.DESK),
    ("table", cat.TABLE),
    ("recliner", cat.CHAIR), ("armchair", cat.CHAIR), ("chair", cat.CHAIR),
    ("lamp", cat.LAMP),
    ("planter", cat.PLANTER), ("vase", cat.DECOR),
    ("bed", cat.BED),
)


#: 壁に付く板とみなす奥行の上限（m）
#:
#: ABO の `HEADBOARD` は 8 割がベッドごと（奥行の中央値 1.81m）で、壁付けの
#: 板は 1 割しかない。語彙をそのまま信じると、ベッドが壁に貼り付く。
#: **品目は置き方を決めるので、形と合わない語彙は形で直す。**
FLAT_DEPTH = 0.35


def refine(c: str | None, extent: Sequence[float]) -> str | None:
    """寸法で品目を直す。カタログの語彙が形と合わないときがある。"""
    if c == cat.HEADBOARD and min(extent[0], extent[2]) > FLAT_DEPTH:
        return cat.BED
    return c


def resolve(product_type: str | None, name: str | None) -> str | None:
    """品目を決める。混在バケツだけ商品名へ落ちる。"""
    if product_type in PRODUCT_TYPE:
        return PRODUCT_TYPE[product_type]
    if product_type not in MIXED or not name:
        return None
    low = name.lower()
    for word, c in KEYWORDS:
        if word in low:
            return c
    return None


# --- 取得 ---------------------------------------------------------------

def _get(key: str, dest: Path) -> Path:
    """S3 から 1 本取る。すでにあれば触らない。"""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(BASE + key) as r, tmp.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(dest)
    return dest


def fetch_catalog(cache: Path) -> None:
    """カタログの素データを取る。合計 90MB ほど。"""
    _get(MODELS_CSV, cache / "3dmodels.csv.gz")
    for h in LISTING_SHARDS:
        _get(f"listings/metadata/listings_{h}.json.gz",
             cache / f"listings_{h}.json.gz")
    _get(IMAGES_CSV, cache / "images.csv.gz")
    fetch_sizes(cache)


def fetch_sizes(cache: Path) -> dict[str, int]:
    """GLB のバイト数を全件引く。バケットの一覧 8 回で済む。

    選ぶ前に大きさが分かっていると、**取る前に総量が言える**。1 体ずつ
    HEAD を打つと選定のたびに数千回叩くことになるので一覧で取る。
    """
    dest = cache / "sizes.json"
    if dest.exists():
        return json.loads(dest.read_text())
    sizes: dict[str, int] = {}
    token = None
    while True:
        q = {"list-type": "2", "prefix": "3dmodels/original/",
             "max-keys": "1000"}
        if token:
            q["continuation-token"] = token
        url = BASE + "?" + urllib.parse.urlencode(q)
        with urllib.request.urlopen(url) as r:
            x = r.read().decode()
        for k, n in re.findall(r"<Key>(.*?)</Key>.*?<Size>(\d+)</Size>", x,
                               re.S):
            if k.endswith(".glb"):
                sizes[k.rsplit("/", 1)[1][:-4]] = int(n)
        m = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>",
                      x)
        if not m:
            break
        token = m.group(1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(sizes))
    return sizes


def thumb_url(path: str) -> str:
    """商品写真の場所。`small` は一辺 256px 程度で 1 枚 10KB ほど。

    一覧で形を見分けるのに要る。寸法と名前だけで 376 体から選ぶのは無理。
    """
    return f"{BASE}images/small/{path}"


def fetch_thumb(path: str, dest: Path) -> int:
    if dest.exists() and dest.stat().st_size > 0:
        return dest.stat().st_size
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(thumb_url(path)) as r, tmp.open("wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    tmp.replace(dest)
    return dest.stat().st_size


def _images(cache: Path) -> dict[str, str]:
    """`image_id` から写真の置き場所へ。無ければ空で返す（写真は必須ではない）。"""
    p = cache / "images.csv.gz"
    if not p.exists():
        return {}
    text = gzip.decompress(p.read_bytes()).decode("utf-8")
    return {r["image_id"]: r["path"] for r in csv.DictReader(io.StringIO(text))}


def glb_url(asin: str) -> str:
    """GLB の場所。末尾 1 桁で割った棚に入っている。"""
    return f"{BASE}3dmodels/original/{asin[-1]}/{asin}.glb"


def fetch_glb(asin: str, dest: Path) -> int:
    """GLB を 1 体取る。すでにあれば触らない。戻り値はバイト数。"""
    if dest.exists() and dest.stat().st_size > 0:
        return dest.stat().st_size
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with urllib.request.urlopen(glb_url(asin)) as r, tmp.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(dest)
    return dest.stat().st_size


# --- 読み込み -----------------------------------------------------------

def _listings(cache: Path) -> dict[str, dict]:
    """ASIN ごとのブランド・商品名・`product_type`。

    同じ ASIN が国ごとに何度も出てくる。`item_name` は言語を選ばないと
    韓国語などが入るので `LANG` で絞り、無ければ諦めて品目だけ拾う。
    """
    out: dict[str, dict] = {}
    for h in LISTING_SHARDS:
        p = cache / f"listings_{h}.json.gz"
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                d = out.setdefault(r["item_id"], {})
                if pt := r.get("product_type"):
                    d.setdefault("product_type", pt[0]["value"])
                if br := r.get("brand"):
                    d.setdefault("brand", br[0]["value"])
                if mi := r.get("main_image_id"):
                    d.setdefault("main_image_id", mi)
                for nm in r.get("item_name", []):
                    tag = nm.get("language_tag")
                    rank = LANGS.index(tag) if tag in LANGS else len(LANGS)
                    if rank < d.get("name_rank", len(LANGS) + 1):
                        d["name"], d["name_rank"] = nm["value"], rank
    for d in out.values():
        d.pop("name_rank", None)
    return out


def load(cache: Path) -> Iterator[dict]:
    """カタログを品目つきの素材として読む。

    `select` が見るのはこの形だけ。ABO の語彙はここで外に出さない。
    """
    meta = _listings(cache)
    sizes = fetch_sizes(cache)
    images = _images(cache)
    raw = (cache / "3dmodels.csv.gz").read_bytes()
    text = gzip.decompress(raw).decode("utf-8")
    for r in csv.DictReader(io.StringIO(text)):
        asin = r["3dmodel_id"]
        m = meta.get(asin, {})
        name = m.get("name")
        extent = [float(r["extent_x"]), float(r["extent_y"]),
                  float(r["extent_z"])]
        yield {
            "id": asin,
            "source": "abo",
            "category": refine(resolve(m.get("product_type"), name), extent),
            "product_type": m.get("product_type"),
            "brand": m.get("brand"),
            "name": name,
            "extent": extent,
            "vertices": int(r["vertices"]),
            "faces": int(r["faces"]),
            "bytes": sizes.get(asin, 0),
            "image": images.get(m.get("main_image_id", ""), ""),
            "path": r["path"],
            "url": glb_url(asin),
        }
