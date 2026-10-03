"""ABO 固有の対応づけ。語彙の写し間違いをここで止める。"""
from __future__ import annotations

from templatemaker import category as cat
from templatemaker import manifest, select
from templatemaker.sources import abo


def test_glb_の場所は末尾一桁の棚():
    assert abo.glb_url("B075QDV397").endswith("3dmodels/original/7/B075QDV397.glb")


def test_素直な品目はそのまま写る():
    assert abo.resolve("CHAIR", None) == cat.CHAIR
    assert abo.resolve("BEAN_BAG_CHAIR", None) == cat.CHAIR
    assert abo.resolve("BED_FRAME", None) == cat.BED
    assert abo.resolve("LIGHT_FIXTURE", None) == cat.CEILING_LIGHT


def test_内装に関係ないものは品目にならない():
    assert abo.resolve("SPORTING_GOODS", "treadmill") is None
    assert abo.resolve("AUTO_ACCESSORY", "car mat") is None


def test_混在バケツは商品名で解き直す():
    # HOME_FURNITURE_AND_DECOR はソファもラグも収納も入っている
    f = "HOME_FURNITURE_AND_DECOR"
    assert abo.resolve(f, "Stone & Beam Andover Slipcover Sectional") == cat.SOFA
    assert abo.resolve(f, "Stone & Beam Leila Leather Ottoman, 34in") == cat.STOOL
    assert abo.resolve(f, "Stone & Beam Floral Wool Area Rug") == cat.RUG
    assert abo.resolve(f, "Ravenna Home 3-Shelf Wood Storage TV Console") == cat.STORAGE


def test_HOME_はほぼ壁掛け():
    assert abo.resolve("HOME", "Rivet Triangles in White Frame Wall Art") == cat.WALL_DECOR
    assert abo.resolve("HOME", "Rivet Round Glass Hanging Wall Mirror") == cat.MIRROR


def test_商品名から引けなければ諦める():
    assert abo.resolve("HOME", "Amazon Brand - unspecified thing") is None
    assert abo.resolve("HOME", None) is None


def test_長い語を先に当てる():
    # "love seat" を "seat" や "bed" より先に見ないとソファがベッドになる
    assert abo.resolve("HOME_FURNITURE_AND_DECOR", "Brooker Down-Filled Love Seat") == cat.SOFA
    assert abo.resolve("HOME_FURNITURE_AND_DECOR", "Upholstered Bed Headboard") == cat.HEADBOARD


def test_マニフェストは往復する(tmp_path):
    it = dict(id="B1", source="abo", category=cat.BED, brand="Rivet",
              name="Nova Bed", extent=[1.4, 1.1, 2.0], vertices=10,
              faces=100, bytes=5, url=abo.glb_url("B1"))
    m = manifest.build([it], "abo", abo.LICENSE, abo.LICENSE_URL,
                       abo.ATTRIBUTION, select.criteria("a"))
    p = tmp_path / "m.json"
    manifest.save(m, p)
    assert manifest.load(p) == m


def test_実体の置き場所は品目で分ける():
    assert manifest.rel_path({"category": "bed", "id": "B1"}) == "bed/B1.glb"


def test_帰属表記にライセンスと変更が入る():
    m = manifest.build([], "abo", abo.LICENSE, abo.LICENSE_URL,
                       abo.ATTRIBUTION, select.criteria("a"))
    out = manifest.notice([m])
    assert "CC BY 4.0" in out
    assert abo.LICENSE_URL in out
    assert "変更" in out


def test_平たくないヘッドボードはベッドへ回す():
    # ABO の HEADBOARD は 206 体中 195 体がベッドごと。語彙を信じると
    # ベッドが壁に貼り付く
    flat = [1.55, 0.94, 0.11]
    whole = [2.23, 1.15, 1.66]
    assert abo.refine(cat.HEADBOARD, flat) == cat.HEADBOARD
    assert abo.refine(cat.HEADBOARD, whole) == cat.BED


def test_寸法で直すのはヘッドボードだけ():
    whole = [2.23, 1.15, 1.66]
    assert abo.refine(cat.SOFA, whole) == cat.SOFA
    assert abo.refine(None, whole) is None
