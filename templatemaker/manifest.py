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
          "extent", "vertices", "faces", "bytes", "url", "image")


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


def thumb_path(item: dict) -> str:
    """写真の置き場所。素材と並べず隠しておく——配るのは GLB の方。"""
    return f".thumbs/{item['id']}.jpg"


def rel_path(item: dict) -> str:
    """実体の置き場所。品目で分けて、どの棚に何があるか見て分かるようにする。"""
    return f"{item['category']}/{item['id']}.glb"


def notice(manifests: list[dict]) -> str:
    """CC BY の帰属表記。素材を同梱するなら要る。

    「変更したか」まで書くのは CC BY 4.0 の求めるところで、間引きと
    テクスチャの縮小は変更にあたる。

    **段階ごとのマニフェストは入れ子になっている**（tier a ⊂ tier b）ので、
    同じ出どころのものは畳んでから数える。帰属表記に同じ ASIN が二度出ると、
    何体を誰に帰属させているのかが読めなくなる。
    """
    out = ["# 同梱素材の出典", "",
           "このディレクトリの 3D 素材は以下に由来する。", ""]
    by_source: dict[str, dict] = {}
    for m in manifests:
        g = by_source.setdefault(m["source"], {"head": m, "items": {}})
        for it in m["items"]:
            g["items"][it["id"]] = it
    for g in by_source.values():
        m, items = g["head"], sorted(g["items"].values(),
                                     key=lambda x: x["id"])
        out += [f"## {m['attribution']}", "",
                f"- ライセンス: [{m['license']}]({m['license_url']})",
                f"- 収録数: {len(items)} 体",
                "- 変更: 面数の間引き、テクスチャの縮小を行っている場合がある",
                "", "<details><summary>内訳</summary>", ""]
        for it in items:
            name = (it.get("name") or "").replace("|", "/")
            out.append(f"- `{it['id']}` {name} — {it.get('brand') or ''}")
        out += ["", "</details>", ""]
    return "\n".join(out)


def status(m: dict, into: Path) -> dict:
    """マニフェストに対する取得状況。

    **走っている fetch と通信しない。** 状態はファイルの有無と大きさだけ
    から作る。取得は中断して再開できるので、進捗の持ち主をプロセスにすると
    再開したとき行方不明になる。ファイルから作れば、別の端末からでも、
    何度中断しても同じものが見える。

    `.part` は取得途中。中身は信用できないが、どこまで来たかは分かる。
    """
    done = part = 0
    got = partial = total = 0
    by: dict[str, list[int]] = {}
    for it in m["items"]:
        p = Path(into) / rel_path(it)
        n = it.get("bytes") or 0
        c = by.setdefault(it["category"], [0, 0, 0, 0])
        c[1] += 1
        c[3] += n
        total += n
        if p.exists():
            done += 1
            got += n
            c[0] += 1
            c[2] += n
        elif (q := p.with_suffix(".part")).exists():
            part += 1
            partial += q.stat().st_size
    return {
        "done": done, "total": len(m["items"]), "inflight": part,
        "bytes_done": got, "bytes_partial": partial, "bytes_total": total,
        "by_category": {k: tuple(v) for k, v in sorted(by.items())},
    }
