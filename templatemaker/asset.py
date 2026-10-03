"""GLB の外形を読む。**頂点は読まない。**

アクセサが持つ `min`/`max` とノード変換だけで外形が出る。376 体で 938MB ある
ので、置き場所を決めるためだけに頂点を全部舐めるのは割に合わない。

ABO のメッシュは [-1, 1] に正規化され、実寸は root ノードの `scale` が持つ。
ノード変換を畳まないと全部 1 辺 2m になるので、ここで畳む。

**原点は bottom-center に揃える。** 素材ごとに原点がばらばらだと、床に置く
操作が素材の素性を知っていないと書けない。実測では ABO の 376 体のうち、
X 中心が 97%、下端 Y=0 が 77%、Z 中心が 57% しか揃っていない。
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

#: 外形の取り方。Room Studio (Apache-2.0) の asset manifest と同じ規約に揃える
ORIGIN = "bottom-center"
UP = "+Y"

_NUM = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _gltf(path: Path) -> dict:
    """JSON チャンクだけ読む。

    外形はアクセサの `min`/`max` から出るので、頂点が入っている BIN を読む
    必要がない。1 体 40MB のものもあるので、先頭だけで済ませる差は大きい。
    """
    with Path(path).open("rb") as f:
        magic, _, _ = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise ValueError("GLB ではない")
        ln, ty = struct.unpack("<II", f.read(8))
        if ty != 0x4E4F534A:
            raise ValueError("先頭が JSON チャンクではない")
        return json.loads(f.read(ln).decode("utf-8"))


def _mul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)]
            for i in range(4)]


def _node_matrix(node: dict) -> list[list[float]]:
    if "matrix" in node:
        m = node["matrix"]                       # 列優先で来る
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    out = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
    if "scale" in node:
        for i, s in enumerate(node["scale"]):
            out[i][i] = s
    if "rotation" in node:
        x, y, z, w = node["rotation"]
        r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
             [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
             [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        out = [[sum(r[i][k] * out[k][j] for k in range(3)) + (0.0 if j < 3 else 0.0)
                for j in range(4)] for i in range(3)] + [[0, 0, 0, 1]]
    if "translation" in node:
        for i, t in enumerate(node["translation"]):
            out[i][3] = t
    return out


def bounds(path: str | Path) -> tuple[list[float], list[float]]:
    """世界座標での外形 (最小, 最大)。

    各プリミティブの箱の 8 隅を変換して包む。回転が 90 度の倍数なら厳密、
    斜めなら外側に膨らむ。家具の書き出しで斜めの根ノードは出てこない。
    """
    g = _gltf(Path(path))
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3

    def walk(i: int, parent: list[list[float]]) -> None:
        node = g["nodes"][i]
        m = _mul(parent, _node_matrix(node))
        if "mesh" in node:
            for prim in g["meshes"][node["mesh"]].get("primitives", []):
                a = g["accessors"][prim["attributes"].get("POSITION", -1)] \
                    if "POSITION" in prim["attributes"] else None
                if not a or "min" not in a or "max" not in a:
                    continue
                for bits in range(8):
                    p = [a["max" if bits >> k & 1 else "min"][k] for k in range(3)]
                    for r in range(3):
                        v = sum(m[r][c] * p[c] for c in range(3)) + m[r][3]
                        lo[r] = min(lo[r], v)
                        hi[r] = max(hi[r], v)
        for c in node.get("children", []):
            walk(c, m)

    scene = g.get("scenes", [{}])[g.get("scene", 0)]
    eye = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
    for i in scene.get("nodes", range(len(g.get("nodes", [])))):
        walk(i, eye)
    if lo[0] == float("inf"):
        raise ValueError("外形が取れない")
    return lo, hi


def describe(path: str | Path) -> dict:
    """置くために要るものだけを返す。

    `offset` を足すと bottom-center が原点に来る。素材そのものは書き換えない
    ——測ったものと直したものを別に保つのは、スキャンを変形させないのと同じ。
    """
    lo, hi = bounds(path)
    size = [hi[i] - lo[i] for i in range(3)]
    return {
        "size": size,
        "width": max(size[0], size[2]),
        "depth": min(size[0], size[2]),
        "height": size[1],
        "offset": [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2],
        "deep_axis": "z" if size[2] >= size[0] else "x",
        "origin": ORIGIN,
        "up": UP,
    }
