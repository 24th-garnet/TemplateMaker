"""取得状況の表示。**ファイルの有無だけから作れている**ことを確かめる。"""
from __future__ import annotations

from templatemaker import cli, manifest


def man(*items) -> dict:
    return {"schema_version": manifest.VERSION, "source": "abo",
            "license": "CC BY 4.0", "items": list(items)}


def it(i: str, c: str, n: int) -> dict:
    return {"id": i, "category": c, "bytes": n}


def test_取得したものを数える(tmp_path):
    m = man(it("A", "chair", 100), it("B", "chair", 300))
    (tmp_path / "chair").mkdir()
    (tmp_path / "chair/A.glb").write_bytes(b"x")
    st = manifest.status(m, tmp_path)
    assert (st["done"], st["total"]) == (1, 2)
    assert (st["bytes_done"], st["bytes_total"]) == (100, 400)


def test_取得途中は別に数える(tmp_path):
    m = man(it("A", "chair", 100))
    (tmp_path / "chair").mkdir()
    (tmp_path / "chair/A.part").write_bytes(b"xyz")
    st = manifest.status(m, tmp_path)
    assert st["done"] == 0
    assert st["inflight"] == 1
    assert st["bytes_partial"] == 3


def test_品目ごとに分ける(tmp_path):
    m = man(it("A", "chair", 10), it("B", "table", 20), it("C", "table", 30))
    (tmp_path / "table").mkdir()
    (tmp_path / "table/B.glb").write_bytes(b"x")
    by = manifest.status(m, tmp_path)["by_category"]
    assert by["chair"] == (0, 1, 0, 10)
    assert by["table"] == (1, 2, 20, 50)


def test_走っているプロセスに触らない(tmp_path):
    # 同じ状態からは何度読んでも同じものが出る
    m = man(it("A", "chair", 10))
    assert manifest.status(m, tmp_path) == manifest.status(m, tmp_path)


def test_何も無くても落ちない(tmp_path):
    st = manifest.status(man(), tmp_path)
    assert st["done"] == st["total"] == 0
    assert st["by_category"] == {}


def test_棒の両端():
    assert cli._bar(0.0, 8) == "░" * 8
    assert cli._bar(1.0, 8) == "█" * 8
    assert len(cli._bar(0.37, 8)) == 8


def test_棒は範囲を外れても壊れない():
    assert len(cli._bar(-1.0, 8)) == 8
    assert len(cli._bar(99.0, 8)) == 8


def test_残り時間():
    assert cli._span(0) == "0:00"
    assert cli._span(125) == "2:05"
    assert cli._span(-1) == "--:--"       # 速度が出るまでは出さない
    assert cli._span(float("inf")) == "--:--"


def test_段階が入れ子でも帰属表記は重複しない():
    # tier a ⊂ tier b。足し算すると実在しない体数になる
    from templatemaker import manifest as mf
    base = dict(source="abo", license="CC BY 4.0",
                license_url="http://x", attribution="ABO")
    a = base | {"items": [{"id": "A", "name": "a", "brand": "b"}], "count": 1}
    b = base | {"items": [{"id": "A", "name": "a", "brand": "b"},
                          {"id": "B", "name": "b", "brand": "b"}], "count": 2}
    out = mf.notice([a, b])
    assert "収録数: 2 体" in out
    assert out.count("- `A`") == 1


def test_出どころが違えば節を分ける():
    from templatemaker import manifest as mf
    a = dict(source="abo", license="CC BY 4.0", license_url="u1",
             attribution="ABO", items=[{"id": "A"}], count=1)
    p = dict(source="polyhaven", license="CC0", license_url="u2",
             attribution="Poly Haven", items=[{"id": "P"}], count=1)
    out = mf.notice([a, p])
    assert "## ABO" in out and "## Poly Haven" in out
