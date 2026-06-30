#!/usr/bin/env python3
"""Оставляет в экспорте Superset только дашборд(ы), чей заголовок (или путь файла)
матчит KEEP_PATTERN, и их замыкание зависимостей: charts -> datasets -> databases.

Использование:  KEEP_PATTERN=GigaID python3 _prune_export.py <src.zip> <dst.zip>
"""
import os
import re
import sys
import zipfile

KEEP = re.compile(os.environ.get("KEEP_PATTERN", "GigaID"), re.I)


def main(src: str, dst: str) -> None:
    z = zipfile.ZipFile(src)
    names = z.namelist()
    rd = lambda n: z.read(n).decode("utf-8", "replace")
    # standalone `uuid:` (не dataset_uuid/database_uuid/theme_uuid — там перед uuid '_')
    uuids = lambda t: set(re.findall(r"\buuid:\s*([0-9a-f-]{36})", t))
    field = lambda t, k: set(re.findall(r"\b" + k + r":\s*([0-9a-f-]{36})", t))

    meta = [n for n in names if n.endswith("/metadata.yaml")]
    dash = [n for n in names if "/dashboards/" in n]
    charts = [n for n in names if "/charts/" in n]
    dsets = [n for n in names if "/datasets/" in n]
    dbs = [n for n in names if "/databases/" in n]

    ref_uuids: set = set()
    keep_dash = []
    for n in dash:
        t = rd(n)
        m = re.search(r"dashboard_title:\s*(.*)", t)
        title = m.group(1) if m else ""
        if KEEP.search(title) or KEEP.search(n):
            keep_dash.append(n)
            ref_uuids |= uuids(t)

    if not keep_dash:
        sys.exit(f"_prune_export: ни один дашборд не матчит KEEP_PATTERN={KEEP.pattern!r}")

    keep_charts, need_ds = [], set()
    for n in charts:
        t = rd(n)
        if field(t, "uuid") & ref_uuids:
            keep_charts.append(n)
            need_ds |= field(t, "dataset_uuid")

    keep_ds, need_db = [], set()
    for n in dsets:
        t = rd(n)
        if field(t, "uuid") & need_ds:
            keep_ds.append(n)
            need_db |= field(t, "database_uuid")

    keep_db = [n for n in dbs if field(rd(n), "uuid") & need_db]

    keep = set(meta) | set(keep_dash) | set(keep_charts) | set(keep_ds) | set(keep_db)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
        for n in names:
            if n in keep:
                zo.writestr(n, z.read(n))

    print(f"   оставлено {len(keep)} из {len(names)} файлов:")
    for n in sorted(keep):
        print("     ", n.split("/", 1)[-1])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: KEEP_PATTERN=<re> _prune_export.py <src.zip> <dst.zip>")
    main(sys.argv[1], sys.argv[2])
