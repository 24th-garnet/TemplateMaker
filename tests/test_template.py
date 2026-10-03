"""家具テンプレート。**セットはそれ自体が 1 つの家具**という前提を押さえる。"""
from __future__ import annotations

import json
import struct
import subprocess
import sys

import pytest

from templatemaker import asset, template


# --- 名前から id -------------------------------------------------------
def test_区切り文字の違いは同じ_idになる():
    assert template.slug("Office Set A") == "office-set-a"
    assert template.slug("office_set_a") == "office-set-a"
    assert template.slug("Office  Set  A") == "office-set-a"


def test_日本語が消えても中身を失わない():
    # 素通しすると「オフィスセットA」は "a" になり、B と区別は付くが
    # 「リビングセット」は空になる
    a = template.slug("オフィスセットA")
    b = template.slug("オフィスセットB")
    liv = template.slug("リビングセット")
    assert a != b and a not in ("a", "") and liv not in ("", "set-")
    assert all(c.isalnum() or c == "-" for c in a + b + liv)


def test_idが実行をまたいで変わらない():
    # hash() は PYTHONHASHSEED で変わる。別プロセスで同じになることを見る
    code = ("import sys; sys.path.insert(0, '.');"
            "from templatemaker import template;"
            "print(template.slug('オフィスセットA'))")
    got = {subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True).stdout.strip() for _ in range(2)}
    assert len(got) == 1 and got != {""}


# --- まとまり ----------------------------------------------------------
def size(w, h, d):
    return {"size": [w, h, d]}


def test_回すと占有が入れ替わる():
    it = template.place("A", "sofa", (0, 0), 90)
    w, d = template.footprint(it, size(2.0, 0.8, 0.9))
    assert round(w, 3) == 0.9 and round(d, 3) == 2.0


def test_外形は子から出す():
    sizes = {"A": size(1.0, 0.7, 0.6), "B": size(0.5, 0.9, 0.5)}
    items = [template.place("A", "desk", (0, 0)),
             template.place("B", "chair", (2.0, 0))]
    b = template.bbox(items, sizes)
    assert round(b["size"][0], 3) == 2.75        # -0.5 .. 2.25
    assert round(b["size"][1], 3) == 0.9         # 高い方
    assert round(b["center"][0], 3) == 0.875


def test_上に載せた分だけ高くなる():
    sizes = {"A": size(1.0, 0.75, 0.6), "B": size(0.2, 0.4, 0.2)}
    items = [template.place("A", "desk", (0, 0)),
             template.place("B", "lamp", (0, 0), y=0.75)]
    assert round(template.bbox(items, sizes)["size"][1], 3) == 1.15


def test_中心を原点へ寄せる():
    sizes = {"A": size(1.0, 0.7, 0.6), "B": size(1.0, 0.7, 0.6)}
    t = template.new("x")
    t["items"] = [template.place("A", "desk", (0, 0)),
                  template.place("B", "desk", (4.0, 2.0))]
    template.recenter(t, sizes)
    b = template.bbox(t["items"], sizes)
    assert abs(b["center"][0]) < 1e-9 and abs(b["center"][1]) < 1e-9


def test_空のまとまりでも落ちない():
    b = template.bbox([], {})
    assert b["size"] == [0.0, 0.0, 0.0]


def test_知らない素材は外形に効かない():
    items = [template.place("none", "desk", (9, 9))]
    assert template.bbox(items, {})["size"] == [0.0, 0.0, 0.0]


# --- 検証 --------------------------------------------------------------
def test_壊れた中身は理由を全部返す():
    t = {"schema_version": "x", "items": [{"translation": "no"}]}
    bad = template.validate(t)
    assert len(bad) >= 3                           # 版・名前・asset_id・translation
    assert any("版" in b for b in bad)


def test_マニフェストに無い素材を弾く():
    t = template.new("x")
    t["items"] = [template.place("ZZZ", "desk", (0, 0))]
    assert template.validate(t, known={"AAA"})
    assert not template.validate(t, known={"ZZZ"})


def test_保存して読み直せる(tmp_path):
    t = template.new("オフィスセットA")
    t["items"] = [template.place("A", "desk", (0.5, -0.25), 90)]
    p = template.save(t, tmp_path)
    assert template.load(p) == t
    assert [x["id"] for x in template.listing(tmp_path)] == [t["id"]]


def test_壊れたものも一覧から消さない(tmp_path):
    (tmp_path / "broken.json").write_text('{"schema_version":"x"}')
    got = template.listing(tmp_path)
    assert len(got) == 1 and "error" in got[0]


# --- 外形の読み取り ----------------------------------------------------
def glb(tmp_path, lo, hi, scale=1.0):
    """最小の GLB。アクセサの min/max とノードの scale だけ持つ。"""
    g = {
        "asset": {"version": "2.0"}, "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "scale": [scale] * 3}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "accessors": [{"componentType": 5126, "count": 2, "type": "VEC3",
                       "min": list(lo), "max": list(hi)}],
    }
    body = json.dumps(g).encode()
    body += b" " * (-len(body) % 4)
    out = struct.pack("<II", len(body), 0x4E4F534A) + body
    p = tmp_path / "t.glb"
    p.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + len(out)) + out)
    return p


def test_ノードのscaleを畳む(tmp_path):
    # ABO は [-1,1] のメッシュを root の scale で実寸にする
    lo, hi = asset.bounds(glb(tmp_path, (-1, -1, -1), (1, 1, 1), scale=0.5))
    assert [round(v, 6) for v in lo] == [-0.5] * 3
    assert [round(v, 6) for v in hi] == [0.5] * 3


def test_原点をbottom_centerへ寄せる(tmp_path):
    d = asset.describe(glb(tmp_path, (1.0, 2.0, 3.0), (2.0, 3.0, 5.0)))
    assert [round(v, 6) for v in d["offset"]] == [-1.5, -2.0, -4.0]
    assert round(d["height"], 6) == 1.0
    assert round(d["width"], 6) == 2.0 and round(d["depth"], 6) == 1.0


def test_glbでなければ断る(tmp_path):
    p = tmp_path / "x.glb"
    p.write_bytes(b"not a glb at all................")
    with pytest.raises(ValueError):
        asset.bounds(p)
