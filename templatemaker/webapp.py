"""家具テンプレートを組むための手元サーバ。

**標準ライブラリだけ。** CaptureVisualizer と同じく単一利用者の道具なので
`http.server` で足りる。3D は three.js を CDN から読む。

GLB はそのままブラウザへ渡し、解くのは向こうでやる。ここで解いて頂点を
JSON で送ると、40MB の素材が 100MB を超える。外形だけはサーバで出して
一覧に載せる——置き場所を決めるのに素材本体を落とす必要はない。
"""
from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import asset, manifest, template

WEB = Path(__file__).parent / "web"
_SAFE = re.compile(r"^[A-Za-z0-9_-]+$")
_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
          ".css": "text/css; charset=utf-8", ".json": "application/json",
          ".glb": "model/gltf-binary", ".jpg": "image/jpeg"}


def build_library(man: dict, lib: Path) -> dict:
    """一覧を組む。外形はここで出す。

    起動時に 1 度だけ。376 体でも頂点を読まないので一瞬で終わる。
    実体が無いものは**黙って落とさず**、理由を付けて残す。
    """
    items, missing = [], 0
    for it in man["items"]:
        p = lib / manifest.rel_path(it)
        if not p.exists():
            missing += 1
            continue
        has_thumb = (lib / manifest.thumb_path(it)).is_file()
        try:
            d = asset.describe(p)
        except Exception as e:                        # noqa: BLE001
            items.append({**_head(it), "thumb": has_thumb,
                          "error": str(e)[:120]})
            continue
        items.append({**_head(it), "thumb": has_thumb,
                      "size": [round(v, 4) for v in d["size"]],
                      "offset": [round(v, 4) for v in d["offset"]],
                      "width": round(d["width"], 3),
                      "depth": round(d["depth"], 3),
                      "height": round(d["height"], 3)})
    cats: dict[str, int] = {}
    for it in items:
        cats[it["category"]] = cats.get(it["category"], 0) + 1
    return {"origin": asset.ORIGIN, "up": asset.UP, "units": "m",
            "source": man["source"], "license": man["license"],
            "attribution": man["attribution"], "missing": missing,
            "categories": dict(sorted(cats.items())), "items": items}


def _head(it: dict) -> dict:
    return {"id": it["id"], "category": it["category"],
            "name": it.get("name") or it["id"], "brand": it.get("brand") or "",
            "faces": it.get("faces", 0), "bytes": it.get("bytes", 0)}


def make_handler(library: dict, lib_dir: Path, tpl_dir: Path, read_only: bool):
    known = {it["id"] for it in library["items"]}

    class Handler(BaseHTTPRequestHandler):
        server_version = "TemplateMaker"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *a):               # 既定の標準エラー出力は賑やかすぎる
            pass

        # --- 返し方 ---
        def _send(self, code: int, body: bytes, ctype: str,
                  cache: str = "no-store") -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, obj, code: int = 200) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False).encode(),
                       "application/json; charset=utf-8")

        def _err(self, code: int, msg: str) -> None:
            self._json({"error": msg}, code)

        def _file(self, p: Path, cache: str = "no-store") -> None:
            if not p.is_file():
                return self._err(404, f"無い: {p.name}")
            self._send(200, p.read_bytes(),
                       _TYPES.get(p.suffix, "application/octet-stream"), cache)

        # --- 経路 ---
        def do_GET(self) -> None:                     # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/":
                return self._file(WEB / "index.html")
            if path in ("/app.js", "/style.css"):
                return self._file(WEB / path.lstrip("/"))
            if path == "/api/library":
                return self._json(library)
            if path == "/api/templates":
                return self._json(template.listing(tpl_dir))
            if path.startswith("/api/templates/"):
                tid = path[len("/api/templates/"):]
                if not _SAFE.match(tid):
                    return self._err(400, "名前が不正")
                try:
                    return self._json(template.load(tpl_dir / f"{tid}.json"))
                except FileNotFoundError:
                    return self._err(404, "無い")
                except ValueError as e:
                    return self._err(422, str(e))
            if path.startswith("/thumb/"):
                name = path[len("/thumb/"):]
                if not name.endswith(".jpg") or not _SAFE.match(name[:-4]):
                    return self._err(400, "名前が不正")
                if name[:-4] not in known:
                    return self._err(404, "一覧に無い素材")
                # 写真も素材も中身は変わらない。一覧を繰るたびに取り直さない
                return self._file(lib_dir / ".thumbs" / name, "max-age=86400")
            if path.startswith("/asset/"):
                parts = path[len("/asset/"):].split("/")
                if len(parts) != 2 or not parts[1].endswith(".glb"):
                    return self._err(400, "経路が不正")
                cat, name = parts[0], parts[1][:-4]
                # **名前は字種で縛る。** 経路を組み立ててから正規化で弾くより、
                # 組み立てる前に通さない方が抜けが無い
                if not (_SAFE.match(cat) and _SAFE.match(name)):
                    return self._err(400, "名前が不正")
                if name not in known:
                    return self._err(404, "一覧に無い素材")
                return self._file(lib_dir / cat / f"{name}.glb", "max-age=86400")
            self._err(404, "無い")

        do_HEAD = do_GET

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4 << 20:
                raise ValueError("本文が大きすぎる")
            return json.loads(self.rfile.read(n) or b"{}")

        def do_POST(self) -> None:                    # noqa: N802
            """名前から id を決めるのは**サーバだけ**。

            ブラウザ側にも同じ規則を置くと、日本語の扱いが片方だけ直って
            別のファイルに保存される。入口を 1 つにしておく。
            """
            if read_only:
                return self._err(403, "読み取り専用")
            if self.path.rstrip("/") != "/api/templates":
                return self._err(404, "無い")
            try:
                t = self._body()
            except Exception as e:                    # noqa: BLE001
                return self._err(400, str(e)[:200])
            if not (t.get("name") or "").strip():
                return self._err(422, "名前が無い")
            t.setdefault("schema_version", template.VERSION)
            tid = t["id"] = template.slug(t["name"])
            if not _SAFE.match(tid):
                return self._err(422, f"名前から作れない id: {tid}")
            if bad := template.validate(t, known):
                return self._err(422, "; ".join(bad))
            p = template.save(t, tpl_dir)
            self._json({"saved": str(p), "id": tid, "count": len(t["items"])})

        def do_DELETE(self) -> None:                  # noqa: N802
            if read_only:
                return self._err(403, "読み取り専用")
            if not self.path.startswith("/api/templates/"):
                return self._err(404, "無い")
            tid = self.path[len("/api/templates/"):]
            if not _SAFE.match(tid):
                return self._err(400, "名前が不正")
            p = tpl_dir / f"{tid}.json"
            if not p.is_file():
                return self._err(404, "無い")
            p.unlink()
            self._json({"deleted": tid})

    return Handler


def serve(man_path: Path, lib_dir: Path, tpl_dir: Path, host: str, port: int,
          read_only: bool = False) -> tuple[ThreadingHTTPServer, dict]:
    man = manifest.load(man_path)
    library = build_library(man, lib_dir)
    tpl_dir.mkdir(parents=True, exist_ok=True)
    handler = make_handler(library, lib_dir, tpl_dir, read_only)
    return ThreadingHTTPServer((host, port), handler), library
