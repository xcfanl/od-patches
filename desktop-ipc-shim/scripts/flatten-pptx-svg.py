#!/usr/bin/env python3
"""Flatten OOXML svgBlip dual-embeds to PNG-only pictures.

dom-to-pptx / pptxgenjs embeds decorative SVG (borders, gradients) as:
  PNG preview (rIdN) + SVG vector (rIdN+1) with <asvg:svgBlip>.
WPS / older PowerPoint often treat that as structural damage and "repair"
(or mangling) the deck. Keep the PNG and drop the SVG part.
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path


SVG_BLIP_RE = re.compile(
    r"(<a:blip\b[^>]*\br:embed=\"(rId\d+)\"[^>]*>)"
    r"([\s\S]*?)"
    r"(</a:blip>)",
    re.IGNORECASE,
)
EXT_LST_RE = re.compile(r"<a:extLst\b[\s\S]*?</a:extLst>", re.IGNORECASE)
SVG_BLIP_RID_RE = re.compile(
    r"<asvg:svgBlip\b[^>]*\br:embed=\"(rId\d+)\"",
    re.IGNORECASE,
)
REL_RE = re.compile(
    r"<Relationship\b[^>]*?\bId=\"(rId\d+)\"[^>]*?/>",
    re.IGNORECASE,
)


def flatten_slide_xml(xml: str) -> tuple[str, set[str]]:
    drop_rids: set[str] = set()

    def repl(match: re.Match[str]) -> str:
        open_tag, _png_rid, inner, close_tag = match.group(1), match.group(2), match.group(3), match.group(4)
        svg_rids = SVG_BLIP_RID_RE.findall(inner)
        if not svg_rids:
            return match.group(0)
        for rid in svg_rids:
            drop_rids.add(rid)
        # Keep PNG blip; strip Office SVG extension list.
        cleaned_inner = EXT_LST_RE.sub("", inner)
        return open_tag + cleaned_inner + close_tag

    return SVG_BLIP_RE.sub(repl, xml), drop_rids


def strip_rels(rels_xml: str, drop_rids: set[str]) -> tuple[str, set[str]]:
    removed_targets: set[str] = set()
    if not drop_rids:
        return rels_xml, removed_targets

    def repl(match: re.Match[str]) -> str:
        tag = match.group(0)
        rid = match.group(1)
        if rid not in drop_rids:
            return tag
        target_m = re.search(r'\bTarget="([^"]+)"', tag)
        if target_m:
            removed_targets.add(target_m.group(1))
        return ""

    return REL_RE.sub(repl, rels_xml), removed_targets


def flatten_pptx(path: Path) -> dict[str, int]:
    with zipfile.ZipFile(path, "r") as zin:
        names = zin.namelist()
        files = {name: zin.read(name) for name in names}

    stats = {"slides": 0, "svg_rids": 0, "media_removed": 0}
    media_to_delete: set[str] = set()

    for name in list(files):
        if not (name.startswith("ppt/slides/slide") and name.endswith(".xml")):
            continue
        if "/_rels/" in name:
            continue
        xml = files[name].decode("utf-8")
        new_xml, drop_rids = flatten_slide_xml(xml)
        if not drop_rids:
            continue
        stats["slides"] += 1
        stats["svg_rids"] += len(drop_rids)
        files[name] = new_xml.encode("utf-8")

        rels_name = f"ppt/slides/_rels/{Path(name).name}.rels"
        if rels_name not in files:
            continue
        rels_xml = files[rels_name].decode("utf-8")
        new_rels, targets = strip_rels(rels_xml, drop_rids)
        files[rels_name] = new_rels.encode("utf-8")
        for target in targets:
            if target.startswith("../media/"):
                media_to_delete.add("ppt/media/" + target.split("/")[-1])
            elif target.startswith("/ppt/media/"):
                media_to_delete.add(target.lstrip("/"))
            elif target.startswith("ppt/media/"):
                media_to_delete.add(target)

    for media_path in media_to_delete:
        if media_path in files:
            del files[media_path]
            stats["media_removed"] += 1

    tmp = path.with_suffix(path.suffix + ".flattening")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        written: set[str] = set()
        for name in names:
            if name in files and name not in written:
                zout.writestr(name, files[name])
                written.add(name)
        for name, data in files.items():
            if name not in written:
                zout.writestr(name, data)
    tmp.replace(path)
    return stats


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: flatten-pptx-svg.py <file.pptx>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"missing file: {path}", file=sys.stderr)
        return 2
    stats = flatten_pptx(path)
    print(
        f"flattened slides={stats['slides']} svg_rids={stats['svg_rids']} "
        f"media_removed={stats['media_removed']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
