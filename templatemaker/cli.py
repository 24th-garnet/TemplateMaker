"""コマンド。取得・選定・ダウンロード・帰属表記を分けて持つ。

選定（`select`）と取得（`fetch`）が別のコマンドなのは意図的で、基準を直して
選び直しても再ダウンロードが起きないようにしてある。
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import manifest, select, webapp
from .sources import abo

CACHE = Path(".cache/abo")
LIBRARY = Path("library")
CATALOG = Path("catalog")
TEMPLATES = Path("templates")


def _gb(n: int) -> str:
    return f"{n / 1e9:.2f} GB"


def _bar(frac: float, width: int = 24) -> str:
    """進捗の棒。八分割の罫線で 1 文字未満も出す。"""
    frac = min(max(frac, 0.0), 1.0)
    full, rest = divmod(int(frac * width * 8), 8)
    return ("█" * full + (" ▏▎▍▌▋▊▉"[rest] if rest else "")).ljust(width, "░")


def _span(sec: float) -> str:
    if sec < 0 or sec != sec or sec > 86400:
        return "--:--"
    return f"{int(sec) // 60:d}:{int(sec) % 60:02d}"


def _line(text: str) -> None:
    """同じ行へ書き直す。端末でなければ普通に 1 行ずつ出す。

    端末でないときに `\r` を使うと、ログが 1 行の塊になって読めなくなる。
    """
    if sys.stderr.isatty():
        w = shutil.get_terminal_size((100, 24)).columns
        print("\r" + text[:w - 1].ljust(w - 1), end="", file=sys.stderr,
              flush=True)
    else:
        print(text, file=sys.stderr, flush=True)


def _endline() -> None:
    if sys.stderr.isatty():
        print(file=sys.stderr, flush=True)


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
          file=sys.stderr, flush=True)
    if a.dry_run:
        return 0

    # 写真を先に引く。1 枚 10KB ほどで、これが揃うと GLB を待たずに一覧が選べる
    thumbs = [it for it in items if it.get("image")
              and not (a.into / manifest.thumb_path(it)).exists()]
    if thumbs and not a.no_thumbs:
        tf = 0
        with ThreadPoolExecutor(max_workers=a.jobs) as ex:
            futs = [ex.submit(abo.fetch_thumb, it["image"],
                              a.into / manifest.thumb_path(it)) for it in thumbs]
            for i, f in enumerate(as_completed(futs), 1):
                try:
                    f.result()
                except Exception:                     # noqa: BLE001
                    tf += 1
                _line(f"  写真 {i}/{len(thumbs)}")
        _endline()
        print(f"写真 {len(thumbs) - tf} 枚" + (f" / 失敗 {tf} 枚" if tf else ""),
              file=sys.stderr)

    if not todo:
        return 0
    t0 = time.monotonic()
    done = failed = got = 0
    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        futs = {ex.submit(abo.fetch_glb, it["id"],
                          a.into / manifest.rel_path(it)): it for it in todo}
        for f in as_completed(futs):
            it = futs[f]
            try:
                got += f.result()
                done += 1
            except Exception as e:                    # noqa: BLE001
                failed += 1
                _endline()
                print(f"  失敗 {it['id']}: {e}", file=sys.stderr, flush=True)
            el = time.monotonic() - t0
            rate = got / el if el > 0.5 else 0
            left = (total - got) / rate if rate > 0 else -1
            _line(f"  {_bar((done + failed) / len(todo))} "
                  f"{done + failed}/{len(todo)}  "
                  f"{_gb(got)}/{_gb(total)}  "
                  f"{rate / 1e6:5.1f} MB/s  残り {_span(left)}  "
                  f"{it['category']}/{it['id']}")
    _endline()
    print(f"完了 {done} 体 / {_gb(got)} / {_span(time.monotonic() - t0)}"
          + (f" / 失敗 {failed} 体" if failed else ""), file=sys.stderr)
    return 1 if failed else 0


def cmd_status(a: argparse.Namespace) -> int:
    """取得状況を見る。走っている fetch とは別の端末から覗ける。"""
    m = manifest.load(a.manifest)
    prev: tuple[float, int] | None = None
    while True:
        st = manifest.status(m, a.into)
        got = st["bytes_done"] + st["bytes_partial"]
        frac = got / st["bytes_total"] if st["bytes_total"] else 1.0
        now = time.monotonic()
        rate = ((got - prev[1]) / (now - prev[0])) if prev else 0
        prev = (now, got)

        out = [f"{a.manifest}  ({m['source']} / {m['license']})", "",
               f"  {_bar(frac, 36)} {frac * 100:5.1f}%",
               f"  {st['done']}/{st['total']} 体   "
               f"{_gb(st['bytes_done'])}/{_gb(st['bytes_total'])}"
               + (f"   取得中 {st['inflight']} 体" if st["inflight"] else "")
               + (f"   {rate / 1e6:.1f} MB/s" if a.watch and rate > 0 else ""),
               ""]
        for c, (d, t, bd, bt) in st["by_category"].items():
            mark = "✓" if d == t else " "
            out.append(f"  {mark} {c:<14s} {_bar(d / t, 16)} {d:4d}/{t:<4d}"
                       f" {_gb(bd):>8s}")
        body = "\n".join(out)

        if not a.watch:
            print(body)
            return 0 if st["done"] == st["total"] else 1
        # 画面を消して描き直す。差分を追うより端末を選ばない
        print("\033[H\033[2J" + body + "\n\n  Ctrl-C で終了", flush=True)
        if st["done"] == st["total"]:
            print("\n  取得完了", flush=True)
            return 0
        time.sleep(a.interval)


def cmd_web(a: argparse.Namespace) -> int:
    """テンプレートを組むサーバを立てる。既定で localhost だけに開く。"""
    srv, lib = webapp.serve(a.manifest, a.into, a.templates, a.host, a.port,
                            a.read_only)
    host = "127.0.0.1" if a.host in ("", "0.0.0.0") else a.host
    print(f"素材 {len(lib['items'])} 体"
          + (f"（実体が無いもの {lib['missing']} 体）" if lib["missing"] else "")
          + f" / {lib['license']}", file=sys.stderr)
    print(f"テンプレート: {a.templates}/", file=sys.stderr)
    print(f"\n  http://{host}:{srv.server_address[1]}/\n", file=sys.stderr)
    if a.host not in ("127.0.0.1", "localhost"):
        print("  ※ localhost 以外へ開いています", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("終了", file=sys.stderr)
    finally:
        srv.server_close()
    return 0


def cmd_notice(a: argparse.Namespace) -> int:
    """CC BY の帰属表記を書き出す。素材を配るなら要る。"""
    ms = [manifest.load(p) for p in a.manifests]
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(manifest.notice(ms), encoding="utf-8")
    # 段階は入れ子なので足さずに畳んで数える
    n = len({it["id"] for m in ms for it in m["items"]})
    print(f"{a.out}: {n} 体", file=sys.stderr)
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
    s.add_argument("--no-thumbs", action="store_true", help="写真を引かない")
    s.set_defaults(fn=cmd_fetch)

    s = sub.add_parser("status", help="取得状況を見る")
    s.add_argument("manifest", type=Path)
    s.add_argument("--into", type=Path, default=LIBRARY)
    s.add_argument("-w", "--watch", action="store_true",
                   help="終わるまで描き直し続ける")
    s.add_argument("--interval", type=float, default=1.0)
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser("web", help="テンプレートを組むサーバを立てる")
    s.add_argument("manifest", type=Path, nargs="?",
                   default=CATALOG / "abo.tier-b.json")
    s.add_argument("--into", type=Path, default=LIBRARY)
    s.add_argument("--templates", type=Path, default=TEMPLATES)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("-p", "--port", type=int, default=3000)
    s.add_argument("--read-only", action="store_true")
    s.set_defaults(fn=cmd_web)

    s = sub.add_parser("notice", help="CC BY の帰属表記を書き出す")
    s.add_argument("manifests", type=Path, nargs="+")
    s.add_argument("-o", "--out", type=Path, default=LIBRARY / "NOTICE.md")
    s.set_defaults(fn=cmd_notice)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
