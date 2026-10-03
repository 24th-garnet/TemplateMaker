"""マニフェスト。**取得とアプリ本体のあいだの契約。**

選定の結果だけを持ち、GLB は持たない。これが成果物なので git に入れる。
実体は `fetch` でいつでも取り直せるし、同じマニフェストからは誰が引いても
同じ集合になる。段階を広げるときはマニフェストの差分として見える。

`criteria` を一緒に埋めるのは、**なぜこの集合なのか**を集合の外に置かない
ため。基準を書き換えた後で古いマニフェストを読んでも、何で選ばれたのかが
そのファイルの中で分かる。
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

VERSION = "tm-manifest-1"

#: マニフェストに残す項目。GLB を引くのと帰属表記に要るものだけ
FIELDS = ("id", "source", "category", "brand", "name",
          "extent", "vertices", "faces", "bytes", "url")


def build(items: list[dict], source: str, license_: str, license_url: str,
          attribution: str, criteria: dict) -> dict:
    return {
        "schema_version": VERSION,
        "source": source,
        "license": license_,
        "license_url": license_url,
        "attribution": attribution,
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "criteria": criteria,
        "count": len(items),
        "items": [{k: it.get(k) for k in FIELDS} for it in items],
    }


def save(m: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n",
                    encoding="utf-8")


def load(path: Path) -> dict:
    m = json.loads(Path(path).read_text(encoding="utf-8"))
    if m.get("schema_version") != VERSION:
        raise ValueError(f"知らない版: {m.get('schema_version')}")
    return m


def rel_path(item: dict) -> str:
    """実体の置き場所。品目で分けて、どの棚に何があるか見て分かるようにする。"""
    return f"{item['category']}/{item['id']}.glb"


def notice(manifests: list[dict]) -> str:
    """CC BY の帰属表記。素材を同梱するなら要る。

    「変更したか」まで書くのは CC BY 4.0 の求めるところで、間引きと
    テクスチャの縮小は変更にあたる。
    """
    out = ["# 同梱素材の出典", "",
           "このディレクトリの 3D 素材は以下に由来する。", ""]
    for m in manifests:
        out += [f"## {m['attribution']}", "",
                f"- ライセンス: [{m['license']}]({m['license_url']})",
                f"- 収録数: {m['count']} 体",
                "- 変更: 面数の間引き、テクスチャの縮小を行っている場合がある",
                "", "<details><summary>内訳</summary>", ""]
        for it in m["items"]:
            name = (it.get("name") or "").replace("|", "/")
            out.append(f"- `{it['id']}` {name} — {it.get('brand') or ''}")
        out += ["", "</details>", ""]
    return "\n".join(out)
