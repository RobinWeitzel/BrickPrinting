"""Render, check and package the brick library.

    .venv/bin/python scad/tools/build.py [--only ID_SUBSTRING] [--thumbs DIR] [--jobs N]

Steps
  1. Rebuild every reference coupon part from the library and compare it
     with reference/coupon.scad (must match within 0.01 mm).
  2. Render every preset in library.json to out/stl/<id>.stl
     (OpenSCAD CLI, manifold backend).
  3. Check each mesh: watertight, no steep overhangs, bridges <= 6 mm
     (see meshcheck.py).
  4. PNG previews (out/preview/), cross-sections of the connector areas
     for presets with a "section" entry (out/section/), and optional
     256 px thumbnails for the web app (--thumbs).
  5. One 3MF print plate per category (out/plates/<category>.3mf) with
     each part as a separate named object.
  6. out/report.md with everything above.
"""

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).parent))
import meshcheck  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent       # scad/
OUT = ROOT / "out"
OPENSCAD = os.environ.get("OPENSCAD", "openscad")
COLOR = "#E8B33A"
PLATE_SIZE = 250.0       # usable bed (mm)
SPACING = 5.0

COUPON_PARTS = ["socket_bar", "stud_plug", "plate2x2", "slot_block", "clip", "clip_sheet",
                "axle_block", "hub_spin", "hub_grip", "printed_axle"]


def scad_literal(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, list):
        return "[" + ",".join(scad_literal(x) for x in v) + "]"
    return repr(v)


def openscad(args, cwd=ROOT):
    r = subprocess.run([OPENSCAD, *args], cwd=cwd, capture_output=True, text=True)
    log = r.stdout + r.stderr
    warnings = [l.strip() for l in log.splitlines() if "WARNING" in l or "ERROR" in l]
    if r.returncode != 0:
        raise RuntimeError(f"openscad {' '.join(args)} failed:\n{log}")
    return warnings


def render(preset):
    out = OUT / "stl" / f"{preset['id']}.stl"
    out.parent.mkdir(parents=True, exist_ok=True)
    args = [f"families/{preset['family']}.scad", "-o", str(out), "--backend=manifold", "--export-format=binstl"]
    for k, v in preset["params"].items():
        args += ["-D", f"{k}={scad_literal(v)}"]
    return out, openscad(args)


def png(scad_src, out, size=(800, 600), camera="0,0,0,55,0,25,0", ortho=False):
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".scad")
    tmp.write_text(scad_src)
    args = [str(tmp), "-o", str(out), "--render", "--autocenter", "--viewall",
            f"--imgsize={size[0]},{size[1]}", "--colorscheme=Tomorrow", f"--camera={camera}"]
    if ortho:
        args.append("--projection=o")
    openscad(args)
    tmp.unlink()


def preview(preset, stl, thumbs):
    png(f'color("{COLOR}") import("{stl}");', OUT / "preview" / f"{preset['id']}.png")
    if thumbs:
        png(f'color("{COLOR}") import("{stl}");', Path(thumbs) / f"{preset['id']}.png", size=(256, 256))


def section(preset, stl):
    """2D profile of the part cut through the connector area (projection(cut=true))."""
    sec = preset.get("section")
    if not sec:
        return None
    at = sec["at"]
    # map the cut plane to z=0 and the remaining two axes to the 2D view (horizontal, Z up)
    m = ("[[1,0,0,0],[0,0,1,0],[0,1,0,%s]]" if sec["axis"] == "y" else "[[0,1,0,0],[0,0,1,0],[1,0,0,%s]]") % (-at)
    out = OUT / "section" / f"{preset['id']}.png"
    png(f'color("{COLOR}") projection(cut = true) multmatrix({m}) import("{stl}");', out,
        camera="0,0,0,0,0,0,0", ortho=True)
    return out


def verify_coupon(jobs):
    tmp = OUT / "coupon"
    tmp.mkdir(parents=True, exist_ok=True)

    def one(p):
        a, b = tmp / f"ref_{p}.stl", tmp / f"lib_{p}.stl"
        openscad(["reference/coupon.scad", "-D", f'part="{p}"', "-o", str(a), "--backend=manifold"])
        openscad(["tests/coupon_repro.scad", "-D", f'part="{p}"', "-o", str(b), "--backend=manifold"])
        return p, meshcheck.compare(str(a), str(b))

    with ThreadPoolExecutor(jobs) as ex:
        return list(ex.map(one, COUPON_PARTS))


def pack_plates(category, items):
    """Shelf-pack parts (split into bodies) onto 250 mm plates; returns 3MF paths."""
    bodies = []
    for preset, stl in items:
        mesh = trimesh.load(stl, force="mesh")
        parts = mesh.split(only_watertight=False) if preset["family"] in ("clips", "coupon", "hinge") else [mesh]
        for i, m in enumerate(sorted(parts, key=lambda m: (m.bounds[0][1], m.bounds[0][0]))):
            name = preset["name"] if len(parts) == 1 else f"{preset['name']} #{i + 1}"
            bodies.append((name, m))
    bodies.sort(key=lambda b: -(b[1].extents[1]))
    plates, scene = [], trimesh.Scene()
    x = y = row_h = 0.0
    for name, m in bodies:
        ex, ey = m.extents[0], m.extents[1]
        if x + ex > PLATE_SIZE:
            x, y, row_h = 0.0, y + row_h + SPACING, 0.0
        if y + ey > PLATE_SIZE:
            plates.append(scene)
            scene, x, y, row_h = trimesh.Scene(), 0.0, 0.0, 0.0
        m = m.copy()
        m.apply_translation([x - m.bounds[0][0], y - m.bounds[0][1], -m.bounds[0][2]])
        scene.add_geometry(m, node_name=name, geom_name=name)
        x += ex + SPACING
        row_h = max(row_h, ey)
    plates.append(scene)
    paths = []
    for i, sc in enumerate(plates):
        p = OUT / "plates" / (f"{category}.3mf" if len(plates) == 1 else f"{category}-{i + 1}.3mf")
        p.parent.mkdir(parents=True, exist_ok=True)
        sc.export(str(p))
        paths.append(p)
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="only presets whose id contains this")
    ap.add_argument("--thumbs", help="also write 256 px thumbnails to this directory")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--skip-coupon", action="store_true")
    a = ap.parse_args()

    lib = json.loads((ROOT / "library.json").read_text())
    presets = [p for p in lib["presets"] if not a.only or a.only in p["id"]]
    report = ["# Brick library build report", ""]
    failed = False

    if not a.skip_coupon:
        print("== coupon reproduction")
        report += ["## Coupon reproduction (library vs reference/coupon.scad)", "", "| part | max deviation (mm) | volume diff (mm³) |", "|---|---|---|"]
        for p, r in verify_coupon(a.jobs):
            ok = r["max_dist"] <= 0.01
            failed |= not ok
            print(f"  {'OK  ' if ok else 'FAIL'} {p}: {r['max_dist']:.2e} mm")
            report.append(f"| {p} | {r['max_dist']:.1e}{'' if ok else ' **FAIL**'} | {r['volume_diff']:.3f} |")
        report.append("")

    print(f"== rendering {len(presets)} presets")

    def work(p):
        stl, warns = render(p)
        chk = meshcheck.check(str(stl))
        preview(p, stl, a.thumbs)
        sec = section(p, stl)
        return p, stl, warns, chk, sec

    with ThreadPoolExecutor(a.jobs) as ex:
        results = list(ex.map(work, presets))

    report += ["## Parts", "", "| part | watertight | volume (cm³) | longest bridge (mm) | steep overhangs | minor facets (mm²) | warnings |", "|---|---|---|---|---|---|---|"]
    for p, stl, warns, chk, sec in results:
        # an assembled preview contains touching separate bodies; it is never printed
        ok = chk["ok"] or (p["params"].get("leaf") == "assembled")
        failed |= not ok
        print(meshcheck.fmt_check(chk).replace(str(stl), p["id"]))
        for w in warns:
            print("     " + w)
        lb = max((b["span"] for b in chk["bridges"]), default=0)
        report.append(f"| {p['name']} | {'yes' if chk['watertight'] else '**no**'} | {chk['volume']/1000:.2f} | {lb:.2f} | "
                      f"{chk['overhangs'] or 'none'} | {chk['minor_overhang_area']} | {'; '.join(warns)} |")

    print("== print plates")
    report += ["", "## Print plates", ""]
    by_cat = {}
    for p, stl, *_ in results:
        by_cat.setdefault(p["category"], []).append((p, stl))
    for cat, items in by_cat.items():
        for path in pack_plates(cat, items):
            print(f"  {path.relative_to(ROOT)}")
            report.append(f"- `{path.relative_to(ROOT)}`")

    (OUT / "report.md").write_text("\n".join(report) + "\n")
    print(f"== report: {(OUT / 'report.md').relative_to(ROOT)}  {'FAILED' if failed else 'all OK'}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
