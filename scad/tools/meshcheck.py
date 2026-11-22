"""Mesh checks for the brick system (used by build.py, also runnable alone).

    python meshcheck.py check part.stl [more.stl ...]
    python meshcheck.py compare a.stl b.stl

check:   watertight / winding / volume, plus a printability report:
         * steep overhangs: downward faces steeper than 45° (from vertical)
           that are not on the bed. Small ones (<= MINOR_WIDTH wide, e.g.
           grip ribs, curved facets) are reported as minor.
         * flat bridges: horizontal downward faces above the bed; each
           connected region must be <= BRIDGE_MAX across (2 x the largest
           inscribed circle radius, i.e. its shortest span).
compare: symmetric surface distance (sampled) and volume difference.
"""

import sys
import numpy as np
import trimesh
from shapely.geometry import Polygon
from shapely.ops import unary_union, polylabel

BED_TOL = 0.05          # faces this close to z=0 rest on the bed
FLAT_COS = 0.999        # |nz| above this counts as horizontal
STEEP_NZ = -np.cos(np.radians(45)) - 1e-3   # nz below this is steeper than 45°
MINOR_WIDTH = 1.0       # steep overhang regions narrower than this are minor
BRIDGE_MAX = 6.0


def load(path):
    m = trimesh.load(path, force="mesh")
    m.merge_vertices()
    return m


def _regions(mesh, face_idx):
    """Connected face groups (by shared edges) as lists of face indices."""
    if len(face_idx) == 0:
        return []
    sub = mesh.submesh([face_idx], append=True, repair=False)
    groups = trimesh.graph.connected_components(sub.face_adjacency, nodes=np.arange(len(sub.faces)), min_len=1)
    return [(sub, g) for g in groups]


def _footprint(sub, group):
    tris = sub.triangles[group][:, :, :2]
    polys = [Polygon(t) for t in tris if Polygon(t).area > 1e-9]
    if not polys:
        return None
    return unary_union(polys).buffer(1e-4).buffer(-1e-4)


def _width(shape):
    """Shortest span of a 2D region: 2 x largest inscribed circle radius."""
    geoms = getattr(shape, "geoms", [shape])
    best = 0.0
    for g in geoms:
        if g.is_empty or g.area < 1e-6:
            continue
        p = polylabel(g, tolerance=0.01)
        best = max(best, 2 * g.exterior.distance(p) if not g.interiors else 2 * g.boundary.distance(p))
    return best


def check(path):
    m = load(path)
    res = {
        "file": path,
        "watertight": bool(m.is_watertight),
        "winding": bool(m.is_winding_consistent),
        "volume": float(m.volume),
        "bounds": m.bounds.round(3).tolist(),
        "bridges": [],
        "overhangs": [],
        "minor_overhang_area": 0.0,
    }
    n = m.face_normals
    zmin = m.triangles[:, :, 2].min(axis=1)
    above_bed = zmin > m.bounds[0][2] + BED_TOL

    # flat ceilings: merge per height level, then split into separate areas
    flat_down = np.where((n[:, 2] < -FLAT_COS) & above_bed)[0]
    levels = {}
    for f in flat_down:
        levels.setdefault(round(float(m.triangles[f][:, 2].mean()), 2), []).append(f)
    for z, faces in sorted(levels.items()):
        fp = unary_union([Polygon(m.triangles[f][:, :2]) for f in faces if Polygon(m.triangles[f][:, :2]).area > 1e-9])
        fp = fp.buffer(1e-4).buffer(-1e-4)
        for g in getattr(fp, "geoms", [fp]):
            if g.is_empty or g.area < 1e-4:
                continue
            w = _width(g)
            res["bridges"].append({"z": z, "span": round(w, 2), "area": round(g.area, 2), "ok": w <= BRIDGE_MAX + 0.05})

    steep = np.where((n[:, 2] < STEEP_NZ) & (n[:, 2] >= -FLAT_COS) & above_bed)[0]
    for sub, g in _regions(m, steep):
        fp = _footprint(sub, g)
        if fp is None:
            continue
        w = _width(fp)
        z = float(sub.triangles[g][:, :, 2].mean())
        if w <= MINOR_WIDTH:
            res["minor_overhang_area"] += fp.area
        else:
            res["overhangs"].append({"z": round(z, 2), "width": round(w, 2), "area": round(fp.area, 2)})
    res["minor_overhang_area"] = round(res["minor_overhang_area"], 2)
    res["ok"] = res["watertight"] and res["winding"] and res["volume"] > 0 \
        and all(b["ok"] for b in res["bridges"]) and not res["overhangs"]
    return res


def compare(a_path, b_path, samples=20000):
    a, b = load(a_path), load(b_path)
    pa, _ = trimesh.sample.sample_surface(a, samples, seed=1)
    pb, _ = trimesh.sample.sample_surface(b, samples, seed=2)
    # include all vertices too, so sharp features are covered exactly
    pa = np.vstack([pa, a.vertices])
    pb = np.vstack([pb, b.vertices])
    _, d_ab, _ = trimesh.proximity.closest_point(b, pa)
    _, d_ba, _ = trimesh.proximity.closest_point(a, pb)
    return {
        "max_dist": float(max(d_ab.max(), d_ba.max())),
        "volume_a": float(a.volume),
        "volume_b": float(b.volume),
        "volume_diff": float(abs(a.volume - b.volume)),
    }


def fmt_check(r):
    lines = [f"{'OK  ' if r['ok'] else 'FAIL'} {r['file']}: watertight={r['watertight']} vol={r['volume']:.1f} mm³"]
    bad_b = [b for b in r["bridges"] if not b["ok"]]
    if r["bridges"]:
        lines.append(f"     bridges: {len(r['bridges'])}, longest span {max(b['span'] for b in r['bridges']):.2f} mm" + (f"  TOO LONG: {bad_b}" if bad_b else ""))
    if r["overhangs"]:
        lines.append(f"     STEEP OVERHANGS: {r['overhangs']}")
    if r["minor_overhang_area"]:
        lines.append(f"     minor steep facets (< {MINOR_WIDTH} mm wide): {r['minor_overhang_area']} mm²")
    return "\n".join(lines)


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    if cmd == "check":
        ok = True
        for p in args:
            r = check(p)
            ok &= r["ok"]
            print(fmt_check(r))
        sys.exit(0 if ok else 1)
    elif cmd == "compare":
        r = compare(*args)
        print(r)
        sys.exit(0 if r["max_dist"] <= 0.01 else 1)
