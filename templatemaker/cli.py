"""コマンド。取得・選定・ダウンロード・帰属表記を分けて持つ。

選定（`select`）と取得（`fetch`）が別のコマンドなのは意図的で、基準を直して
選び直しても再ダウンロードが起きないようにしてある。
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import manifest, select
from .sources import abo

CACHE = Path(".cache/abo")
LIBRARY = Path("library")
CATALOG = Path("catalog")


def _gb(n: int) -> str:
    return f"{n / 1e9:.2f} GB"


def cmd_catalog(a: argparse.Namespace) -> int:
    """カタログの素データを取る。"""
    print(f"ABO のカタログを {a.cache} へ取得中…", file=sys.stderr)
    abo.fetch_catalog(a.cache)
    items = list(abo.load(a.cache))
    print(f"3D モデル {len(items)} 体", file=sys.stderr)
    return 0


def cmd_survey(a: argparse.Namespace) -> int:
    """基準をかけたときの残り数と総量を出す。取る前に見る用。"""
    items = list(abo.load(a.cache))

    def row(label: str, got: list[dict]) -> None:
        n = sum(x["bytes"] for x in got)
        print(f"{label:38s} {len(got):5d} 体  {_gb(n):>9s}")

    row("全件", items)
    known = [x for x in items if x["category"] in select.LIMITS]
    row("品目が決まるもの", known)
    sane = [x for x in known if select.is_sane(x)]
    row(f"寸法サニティ ({select.SANE_MIN}〜{select.SANE_MAX}m)", sane)
    fit = [x for x in sane if select.fits(x)]
    row("品目ごとの寸法上限", fit)
    kept = select.filter_items(items)
    row("形状の重複を除去", kept)
    print()
    for t in select.TIERS:
        got = select.per_category(kept, select.TIERS[t])
        n = sum(x["bytes"] for x in got)
        per = select.TIERS[t]
        label = f"tier {t} (各品目 {per if per else '全'} 体)"
        print(f"  {label:28s} {len(got):5d} 体  {_gb(n):>9s}")
    print()
    c = Counter(x["category"] for x in kept)
    for k, n in sorted(c.items(), key=lambda kv: -kv[1]):
        print(f"  {n:5d}  {k}")
    return 0


def cmd_select(a: argparse.Namespace) -> int:
    """基準を適用してマニフェストを書く。ここでは何もダウンロードしない。"""
    items = list(abo.load(a.cache))
    got = select.apply(items, a.tier)
    m = manifest.build(got, "abo", abo.LICENSE, abo.LICENSE_URL,
                       abo.ATTRIBUTION, select.criteria(a.tier))
    out = a.out or a.catalog / f"abo.tier-{a.tier}.json"
    manifest.save(m, out)
    total = sum(x["bytes"] for x in got)
    print(f"{out}: {len(got)} 体 / 取得量 {_gb(total)}", file=sys.stderr)
    for k, n in sorted(Counter(x["category"] for x in got).items()):
        print(f"  {n:4d}  {k}", file=sys.stderr)
    return 0


def cmd_fetch(a: argparse.Namespace) -> int:
    """マニフェストの GLB を引く。すでにあるものは触らない。"""
    m = manifest.load(a.manifest)
    items = m["items"]
    todo = [it for it in items
            if not (a.into / manifest.rel_path(it)).exists()]
    total = sum(it["bytes"] for it in todo)
    print(f"{len(items)} 体中 {len(todo)} 体を取得（{_gb(total)}）",
          file=sys.stderr)
    if a.dry_run or not todo:
        return 0

    done = failed = 0
    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futs = {ex.submit(abo.fetch_glb, it["id"],
                          a.into / manifest.rel_path(it)): it for it in todo}
        for f in as_completed(futs):
            it = futs[f]
            try:
                f.result()
                done += 1
            except Exception as e:                    # noqa: BLE001
                failed += 1
                print(f"  失敗 {it['id']}: {e}", file=sys.stderr)
            if (done + failed) % 25 == 0 or done + failed == len(todo):
                print(f"  {done + failed}/{len(todo)}", file=sys.stderr)
    print(f"完了 {done} 体" + (f" / 失敗 {failed} 体" if failed else ""),
          file=sys.stderr)
    return 1 if failed else 0


def cmd_notice(a: argparse.Namespace) -> int:
    """CC BY の帰属表記を書き出す。素材を配るなら要る。"""
    ms = [manifest.load(p) for p in a.manifests]
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(manifest.notice(ms), encoding="utf-8")
    print(f"{a.out}: {sum(m['count'] for m in ms)} 体", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="templatemaker",
        description="公開 3D アセットからサンプル家具セットを組み立てる")
    p.add_argument("--cache", type=Path, default=CACHE,
                   help=f"カタログの置き場所（既定 {CACHE}）")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("catalog", help="カタログの素データを取る").set_defaults(
        fn=cmd_catalog)
    sub.add_parser("survey", help="基準をかけた残り数と総量を見る").set_defaults(
        fn=cmd_survey)

    s = sub.add_parser("select", help="基準を適用してマニフェストを書く")
    s.add_argument("--tier", default="a", choices=list(select.TIERS))
    s.add_argument("-o", "--out", type=Path)
    s.add_argument("--catalog", type=Path, default=CATALOG)
    s.set_defaults(fn=cmd_select)

    s = sub.add_parser("fetch", help="マニフェストの GLB を引く")
    s.add_argument("manifest", type=Path)
    s.add_argument("--into", type=Path, default=LIBRARY)
    s.add_argument("-j", "--jobs", type=int, default=8)
    s.add_argument("-n", "--dry-run", action="store_true")
    s.set_defaults(fn=cmd_fetch)

    s = sub.add_parser("notice", help="CC BY の帰属表記を書き出す")
    s.add_argument("manifests", type=Path, nargs="+")
    s.add_argument("-o", "--out", type=Path, default=LIBRARY / "NOTICE.md")
    s.set_defaults(fn=cmd_notice)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
