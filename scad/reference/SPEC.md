# Brick system – connector spec (validated 2026-11-22)

LEGO-scale building system for FDM printing with a **0.4 mm nozzle, 0.2 mm layers**.
Deliberately **not** LEGO-compatible. Validated on a test coupon (`coupon.scad`)
printed in PLA, 3 walls, Arachne, XY compensation 0, no supports.

## Design rules

1. Only short, thick studs may protrude, and only upward (+Z). Anything that would
   stick out sideways becomes a slot or bore with a separate part in it.
2. Every part prints flat side down, **no supports**. Horizontal holes are teardrop-
   shaped (45° apex up) or short flat bridges (≤ 6 mm span).
3. Fit comes from compliance, not precision: crush ribs in holes, spring arms on
   clips. The male side stays rigid.
4. Walls are multiples of the line width: 0.9 / 1.3 / 1.8 mm, nothing below 0.9 mm.
   Heights are multiples of 0.2 mm.
5. All fit values are global parameters, so they can be re-tuned per printer/filament.

## Grid

| | value |
|---|---|
| Horizontal pitch | 8.0 mm |
| Plate height | 3.2 mm |
| Brick height | 9.6 mm (3 plates) |
| Outer size | n × 8.0 − 0.2 mm (0.1 mm gap per side) |

## Connector 1 – stud + crush-rib socket (vertical stacking)

| | value | status |
|---|---|---|
| Stud | Ø5.0, 1.6 mm tall, 0.4 top chamfer, 0.4 root fillet | validated |
| Socket bore | Ø5.4, 1.8 mm deep, 0.4 entry chamfer | validated |
| Crush ribs | 4 × half-cylinder r0.5, start 0.6 mm above entry with 45° taper | validated |
| Rib tip diameter | **4.75** (4.8 and 4.7 good, 4.9 loose, ≥5.0 falls out) | 4.75 itself not printed yet |
| Layout | one socket per grid cell (no tubes), so half-offset building works | |
| Plate section | 1.8 socket + 1.4 roof + studs | validated |

## Connector 2 – slot + flat clip (sideways, special connections)

| | value | status |
|---|---|---|
| Clip | flat 2D profile, 2.0 thick, 5.0 body width, 6.8 long (3.4 per side), printed flat | validated |
| Clip arms | 0.9 wide, barb +0.3 per side, 0.15 tip lead-in, 0.8 centre band, r0.3 root fillets | |
| Slot | thickness 2.3, length = 5.0 + 2·(0.3 − interference), depth 3.6, 0.4 entry chamfer | validated |
| Interference | **0.10 mm per side** → slot length 5.4 | validated |
| Side slots | upright (2.3 bridge) and flat (5.4 bridge) both printed cleanly | validated |
| Min. part height for side slots | 6.4 mm (2 plates); plates don't get side slots | |

## Axles and wheels

| | value | status |
|---|---|---|
| Axle | Ø3 mm steel rod / M3 screw; printed Ø3 axle with 0.3 flat as alternative | |
| Spinning bore | **Ø3.2** teardrop (3.3 too wobbly) | validated |
| Grip bore | base Ø3.4 teardrop + 3 ribs, tips at **Ø2.8**; holds axially, axle can still twist | validated |
| Architecture | **axle clamped in the chassis brick (grip bore), wheels spin on it (Ø3.2 hub)**, retained by a grip collar on the outside | design decision |

## Open items to verify in the first real parts

- Rib tip 4.75 directly (interpolated between two good values), and how clutch scales
  on large plates (2×8, 4×4) – may need a slightly looser value for many studs.
- Clip arm durability over many insert/remove cycles (strain is near PLA's limit).
- If a wheel must be fixed to its axle (not spinning), use a D-profile axle + D-bore,
  not a tighter grip bore.
