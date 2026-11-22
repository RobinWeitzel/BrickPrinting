# Brick system: OpenSCAD part library

A LEGO-scale building system (8 mm grid, 3.2 mm plates) designed for FDM printing
with a 0.4 mm nozzle. **It is not LEGO compatible.** The connector values were
print-tested; see [reference/SPEC.md](reference/SPEC.md) (binding) and
[reference/coupon.scad](reference/coupon.scad) (the tested geometry).

## Layout

| File | What it is |
|---|---|
| `config.scad` | Every grid and fit value from SPEC.md as a global. Values marked `[fit]` are the ones to re-tune. |
| `connectors.scad` | `stud()`, `socket()`, `clip()`, `slot_v()`, `slot_side()`, `bore_spin()`, `bore_grip()` (+ vertical variants), `printed_axle()`. Shapes copied 1:1 from the coupon. |
| `parts.scad` | Part generators built only from the connectors: `block()`, `slope()`, `wedge()`, `arch()`, `axle_brick()`, `wheel()`, `tire()`, `grip_collar()`, `hinge_leaf()`/`hinge_pair()`, `clip_sheet()`, `coupon()`. |
| `families/*.scad` | One Customizer front-end per generator. The web app and the build script render these with `-D` overrides. |
| `library.json` | The base set: named presets (family + parameters), grouped into categories. |
| `tests/coupon_repro.scad` | Rebuilds every coupon part from the library, to check it still matches the tested geometry. |
| `tools/build.py` | Renders, checks and packages everything (see below). |
| `tools/meshcheck.py` | Watertight/overhang/bridge checks and mesh comparison. |

Open a family file in the OpenSCAD GUI to use the Customizer, or include the library:

```scad
include <parts.scad>
block([2, 4], plates = 3, hollow = true, slots_x0 = [0, 1]);
```

## Design rules (from SPEC.md)

1. Only studs protrude, and only upward. Anything sideways is a slot or bore with a separate part in it (clip, axle).
2. Every part prints flat side down without supports. Overhangs are 45° at most; flat bridges are at most 6 mm.
3. Fit comes from compliance: crush ribs in sockets and grip bores, spring arms on clips. Male parts stay rigid.
4. Walls are multiples of the line width (0.9 / 1.3 / 1.8 mm); heights are multiples of 0.2 mm.

How the generators keep to them:

- **Sockets**: one per grid cell (no tubes), so half-offset building works.
- **Side slots** sit at least `WALL_1` above the socket roof. A 2-plate part fits a *flat* slot (5.4 mm bridge); an *upright* slot (2.3 mm bridge) needs a full brick and falls back to flat otherwise. Slots on two faces of the same corner cell, or on opposite faces of a 1-wide part, cut into each other; avoid those combinations.
- **Hollow** parts extend each socket bore upward with a Ø5.4 flat ceiling. Around slots and bores the material stays solid.
- **Slopes** keep `WALL_1` over the sockets (the low edge rises if needed). **Inverted slopes** are exactly 45° underneath and only get sockets under the flat part.
- **Arches** use 45° flanks and a flat top of at most 6 mm. A wide arch needs more height and prints a warning if it doesn't fit.
- **Wedges and round parts** only get studs/sockets where they fit completely inside the outline. A round 2x2 has one connector in the centre, on the half grid.

## Wheels and hinges

- **Axle**: Ø3 steel rod or M3 screw (or `printed_axle()`). `axle_brick()` has horizontal **grip** bores (the axle is clamped). Wheels spin on it (Ø3.2 bore), and a `grip_collar()` keeps each wheel on.
- **Wheels** print flat. `tread = "tire"` cuts a 45° channel for a TPU `tire()` with the same `d`/`w`.
- **Hinges**: two knuckle leaves on a Ø3 pin (length = width × 8 − 0.2 mm). Leaf A grips the pin, leaf B turns on it. The knuckles are shaped for 45° printing. The hinge folds from about −90° to +70°. The leaves attach to the rest of the model with studs/sockets and, optionally, clips in side slots in the far end (`slots_x0`). A hinge made purely from a clip in a slot can't fold more than a few degrees before the bricks collide, so the pivot uses the axle system.

## Building and checking

Requirements: the OpenSCAD CLI (2025+ snapshot, manifold backend) and Python with trimesh:

```bash
brew install --cask openscad@snapshot
```

```bash
python3 -m venv .venv && .venv/bin/pip install trimesh numpy scipy shapely networkx lxml rtree manifold3d pillow
```

Then, from the repository root:

```bash
.venv/bin/python scad/tools/build.py
```

The build:

1. Rebuilds every coupon part from the library and compares it with `reference/coupon.scad`. They must match within 0.01 mm (they currently match exactly).
2. Renders every preset in `library.json` to `scad/out/stl/`.
3. Checks each mesh: watertight, no downward faces steeper than 45° (regions narrower than 1 mm count as minor, e.g. crush ribs), and every flat ceiling at most 6 mm across.
4. Writes PNG previews (`out/preview/`) and 2D cross-sections of the connector areas (`out/section/`).
5. Packs one 3MF print plate per category (`out/plates/<category>.3mf`), with every part as a separate named object.
6. Writes `out/report.md`.

`npm run build-library` regenerates the web app's catalog from this folder. Add `-- --thumbs` to also re-render the thumbnails.

## Print settings

| Setting | Value |
|---|---|
| Nozzle / layer | 0.4 mm / 0.20 mm |
| Walls | 3 perimeters, Arachne wall generator |
| Infill | 15–20 % |
| XY hole / contour compensation | **0** (the geometry already includes the fit) |
| Elephant's foot compensation | your usual (0.1–0.15 mm); sockets also have a 0.4 mm entry chamfer |
| Supports | **none** |
| Seam | rear / aligned |
| Clips | print flat, as modelled; PLA works, PETG is tougher for many cycles |
| Tyres | TPU (95A) |

If your slicer imports a plate as one object, use *Split to objects*.

## Re-calibrating with the coupon generator

Every fit value is a global in `config.scad`:

| Value | Coupon `param` | Tested default |
|---|---|---|
| `RIB_D`: socket rib tips | `rib_d` | 4.75 |
| `SLOT_INTERF`: clip barb interference | `slot_interf` | 0.10 |
| `SLOT_CLEAR`: slot clearance (thickness) | `slot_clear` | 0.15 |
| `BORE_SPIN_D`: spinning bore | `bore_spin` | 3.2 |
| `BORE_GRIP_D`: grip bore rib tips | `bore_grip` | 2.8 |

1. Print a coupon for the value you want to tune (new printer, new filament, or parts are too tight or too loose):

   ```bash
   openscad -o coupon.stl -D 'param="rib_d"' -D 'labels="text"' scad/families/coupon.scad
   ```

   It has the connector in 5 steps: centre ± 2 × `step` (default 0.05) around the current value. `center` and `step` can be set too. Labels are either the values as text (needs a font) or 1–5 dots (dot 3 = current value). The coupon comes with its mating parts (stud plugs or clips).
2. Test each sample as in the original test protocol: **X** won't fit · **T** very tight · **G** good (firm, holds upside down, removable by hand) · **L** loose · **F** falls out. Do 10 insert/remove cycles on the best one.
3. Put the winner into `config.scad`, or pass it with `-D` (`-D RIB_D=4.8`). In the web app it goes under **Settings → Fit (calibration)**, which regenerates every part.
4. If you move far from the tested values, re-run `tools/build.py`. The fit values don't change part outlines, but the checks are cheap.
