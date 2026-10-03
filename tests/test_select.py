"""取捨選択の基準。**数字を直したら落ちる**ように書く。"""
from __future__ import annotations

import pytest

from templatemaker import category as cat
from templatemaker import select


def item(**kw) -> dict:
    base = dict(id="B0", source="abo", category=cat.CHAIR,
                extent=[0.6, 0.9, 0.6], vertices=100, faces=10_000,
                bytes=1_000_000)
    return base | kw


def test_wdh_は水平の長い方を幅にする():
    # X/Z のどちらが幅かは書き出し側の都合で決まるので大小で取る
    assert select.wdh([0.6, 1.1, 2.0]) == (2.0, 0.6, 1.1)
    assert select.wdh([2.0, 1.1, 0.6]) == (2.0, 0.6, 1.1)


def test_寸法が壊れたものを外す():
    assert select.is_sane(item())
    assert not select.is_sane(item(extent=[221.18, 99.71, 85.24]))
    assert not select.is_sane(item(extent=[0.001, 0.001, 0.001]))


def test_ベッドはダブルを通しキングを落とす():
    double = item(category=cat.BED, extent=[1.40, 1.10, 1.95])
    king = item(category=cat.BED, extent=[2.02, 1.17, 2.15])
    assert select.fits(double)
    assert not select.fits(king)


def test_品目が分からないものは通さない():
    assert not select.fits(item(category=None))
    assert not select.fits(item(category="sporting_goods"))


def test_品目ごとに上限が違う():
    # 高さ 2.0m は収納なら通り、ソファなら通らない
    tall = [0.8, 2.0, 0.5]
    assert select.fits(item(category=cat.STORAGE, extent=tall))
    assert not select.fits(item(category=cat.SOFA, extent=tall))


def test_面数の上限():
    assert select.passes(item(faces=select.MAX_FACES))
    assert not select.passes(item(faces=select.MAX_FACES + 1))


def test_同じ形は一体に畳む():
    # 色違いバリアント。頂点数・面数・寸法が揃えば同じ形
    a = item(id="B1", bytes=5_000_000)
    b = item(id="B2", bytes=1_000_000)
    got = select.filter_items([a, b])
    assert [x["id"] for x in got] == ["B2"]      # 軽い方が残る


def test_畳む相手が同点でも結果が揺れない():
    a, b = item(id="B2"), item(id="B1")
    assert select.filter_items([a, b]) == select.filter_items([b, a])


def test_寸法が違えば別の形として残す():
    a = item(id="B1")
    b = item(id="B2", extent=[0.6, 0.91, 0.6])
    assert len(select.filter_items([a, b])) == 2


def test_段階は品目ごとに切る():
    # 総数で切ると数の多い品目だけが残ってしまう
    items = [item(id=f"C{i}", category=cat.CHAIR, vertices=i) for i in range(10)]
    items += [item(id=f"T{i}", category=cat.TABLE, vertices=i,
                   extent=[1.2, 0.7, 0.8]) for i in range(3)]
    got = select.per_category(select.filter_items(items), 5)
    assert sum(1 for x in got if x["category"] == cat.CHAIR) == 5
    assert sum(1 for x in got if x["category"] == cat.TABLE) == 3


def test_段階が広がるほど集合が大きくなる():
    items = [item(id=f"C{i}", vertices=i) for i in range(200)]
    sizes = [len(select.apply(items, t)) for t in ("a", "b", "c", "d")]
    assert sizes == sorted(sizes)


def test_全品目に上限が定義されている():
    assert set(select.LIMITS) == set(cat.ALL)


def test_知らない段階は弾く():
    with pytest.raises(ValueError):
        select.apply([], "z")


def test_基準を書き出せる():
    c = select.criteria("a")
    assert c["per_category"] == 5
    assert c["limits_wdh_m"]["bed"] == list(select.LIMITS[cat.BED])
