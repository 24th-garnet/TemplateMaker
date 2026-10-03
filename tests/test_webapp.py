"""サーバ。**経路の縛り**と**id の決め方が 1 か所であること**を見る。"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

from templatemaker import manifest, select, webapp
from tests.test_template import glb


@pytest.fixture
def site(tmp_path):
    lib = tmp_path / "library"
    (lib / "desk").mkdir(parents=True)
    glb(tmp_path, (-1, 0, -1), (1, 2, 1)).replace(lib / "desk" / "B1.glb")
    (lib / ".thumbs").mkdir()
    (lib / ".thumbs" / "B1.jpg").write_bytes(b"\xff\xd8\xff\xe0jpeg")
    man = manifest.build(
        [{"id": "B1", "source": "abo", "category": "desk", "brand": "b",
          "name": "n", "extent": [2, 2, 2], "vertices": 2, "faces": 1,
          "bytes": 9, "url": "u", "image": "ab/abcd.jpg"},
         {"id": "GONE", "source": "abo", "category": "desk", "brand": "",
          "name": "", "extent": [1, 1, 1], "vertices": 1, "faces": 1,
          "bytes": 1, "url": "u"}],
        "abo", "CC BY 4.0", "http://x", "ABO", select.criteria("a"))
    mp = tmp_path / "m.json"
    manifest.save(man, mp)
    srv, library = webapp.serve(mp, lib, tmp_path / "t", "127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield base, library, tmp_path
    srv.shutdown()
    srv.server_close()


def get(url, **kw):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, **kw)) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_実体が無いものは一覧に載せない(site):
    base, library, _ = site
    assert [a["id"] for a in library["items"]] == ["B1"]
    assert library["missing"] == 1


def test_一覧に規約が入る(site):
    base, _, _ = site
    lib = json.loads(get(base + "/api/library")[1])
    assert lib["origin"] == "bottom-center" and lib["up"] == "+Y"
    assert lib["items"][0]["offset"] == [0.0, 0.0, 0.0]
    assert lib["items"][0]["height"] == 2.0


def test_素材を配る(site):
    base, _, _ = site
    code, body = get(base + "/asset/desk/B1.glb")
    assert code == 200 and body[:4] == b"glTF"


@pytest.mark.parametrize("path", [
    "/asset/../../etc/passwd",
    "/asset/desk/..%2f..%2fpasswd.glb",
    "/asset/desk/B1.glb/extra",
    "/api/templates/..%2fx",
])
def test_経路をずらせない(site, path):
    base, _, _ = site
    assert get(base + path)[0] in (400, 404)


def test_一覧に無い素材は配らない(site):
    base, _, tmp = site
    (tmp / "library" / "desk" / "SECRET.glb").write_bytes(b"glTF....")
    assert get(base + "/asset/desk/SECRET.glb")[0] == 404


def post(base, body):
    return get(base + "/api/templates", method="POST",
               data=json.dumps(body).encode(),
               headers={"Content-Type": "application/json"})


def test_idはサーバが決める(site):
    base, _, _ = site
    # クライアントが送った id は採らない。規則が二重になるのを避ける
    code, body = post(base, {"name": "オフィスセットA", "id": "wrong",
                             "items": []})
    assert code == 200
    assert json.loads(body)["id"] != "wrong"


def test_保存して読み直せる(site):
    base, _, _ = site
    tid = json.loads(post(base, {
        "name": "Office Set A",
        "items": [{"asset_id": "B1", "category": "desk",
                   "translation": [0.5, 0, -0.25], "rotation": 90}],
    })[1])["id"]
    assert tid == "office-set-a"
    t = json.loads(get(f"{base}/api/templates/{tid}")[1])
    assert t["items"][0]["rotation"] == 90
    assert [x["id"] for x in json.loads(get(base + "/api/templates")[1])] == [tid]
    assert get(f"{base}/api/templates/{tid}", method="DELETE")[0] == 200
    assert get(f"{base}/api/templates/{tid}")[0] == 404


def test_名前が無ければ断る(site):
    base, _, _ = site
    assert post(base, {"items": []})[0] == 422


def test_マニフェストに無い素材を断る(site):
    base, _, _ = site
    code, body = post(base, {"name": "x", "items": [
        {"asset_id": "NOPE", "category": "desk",
         "translation": [0, 0, 0], "rotation": 0}]})
    assert code == 422 and b"NOPE" in body


def test_写真を配る(site):
    base, library, _ = site
    assert library["items"][0]["thumb"] is True
    code, body = get(base + "/thumb/B1.jpg")
    assert code == 200 and body.startswith(b"\xff\xd8")


def test_写真は作り直されないので持たせてよい(site):
    base, _, _ = site
    with urllib.request.urlopen(base + "/thumb/B1.jpg") as r:
        assert "max-age" in r.headers.get("Cache-Control", "")


@pytest.mark.parametrize("path", [
    "/thumb/../../etc/passwd", "/thumb/NOPE.jpg", "/thumb/B1.png",
])
def test_写真も経路をずらせない(site, path):
    base, _, _ = site
    assert get(base + path)[0] in (400, 404)
