// =====================================================================
//  Brick system: part generators
//
//  Every part is built from the connectors in connectors.scad and the
//  values in config.scad. All parts are modelled in their print
//  orientation: flat side on z=0, studs up, no supports needed.
//
//  Coordinates: grid cell (x, y) spans [8x, 8x+8] x [8y, 8y+8]; the
//  part's outer faces sit GAP (0.1) inside the grid. X is the part's
//  length, Y its width, Z up.
//
//  Generators
//    block()        plates, bricks, tiles, round and corner/L/T parts,
//                   optional side slots, top slots, hollowing
//    slope()        slopes and inverted slopes
//    wedge()        wedge plates/bricks (angled footprint)
//    arch()         arches with a support-free 45° opening
//    axle_brick()   brick with horizontal axle bores across its width
//    wheel(), tire(), grip_collar(), printed_axle()
//    hinge_leaf()   knuckle hinge halves on a Ø3 pin
//    clip_sheet()   clips laid out for printing
//    coupon()       calibration coupon: one fit value in 5 steps
// =====================================================================

include <connectors.scad>

// ---------------------------------------------------------------------
//  Cell lists and footprints
// ---------------------------------------------------------------------

function _rect_cells(nx, ny) = [for (y = [0:ny-1], x = [0:nx-1]) [x, y]];

// Cells from a mask string. Rows are separated by "/", the first row is
// y=0 (front). "X" (or "#") = filled, "." = empty. Example L-corner: "XX/X."
function _mask_cells(s, i = 0, x = 0, y = 0) =
    i >= len(s) ? [] :
    s[i] == "/" ? _mask_cells(s, i + 1, 0, y + 1) :
    s[i] == " " ? _mask_cells(s, i + 1, x, y) :
    concat((s[i] == "X" || s[i] == "x" || s[i] == "#") ? [[x, y]] : [], _mask_cells(s, i + 1, x + 1, y));

function _mask_size(cells) = [max([for (c = cells) c[0]]) + 1, max([for (c = cells) c[1]]) + 1];

// Cells of a round footprint whose socket keeps a WALL_1 wall. When none
// fit (2x2), a single connector sits in the centre (on the half grid).
function _round_cells(n) =
    let(R = n*PITCH/2 - GAP, c0 = n*PITCH/2,
        fit = [for (c = _rect_cells(n, n))
                 if (norm([cell(c[0]) - c0, cell(c[1]) - c0]) + SOCKET_D/2 + WALL_1 <= R) c])
    len(fit) > 0 ? fit : [[(n - 1)/2, (n - 1)/2]];

// Signed distance of p from edge a->b (positive = left = inside for CCW).
function _edge_dist(p, a, b) = ((b[0] - a[0])*(p[1] - a[1]) - (b[1] - a[1])*(p[0] - a[0])) / norm(b - a);
function _inside(p, pts, m) = min([for (i = [0:len(pts)-1]) _edge_dist(p, pts[i], pts[(i + 1) % len(pts)])]) >= m;

function _contains(list, c) = len([for (e = list) if (e[0] == c[0] && e[1] == c[1]) 1]) > 0;

// 2D footprint of a block.
//   shape    "rect" | "round"
//   mask     optional cell mask (see _mask_cells); overrides size
//   corner_r rounding radius of the outer corners (rect only)
module footprint_2d(size, shape = "rect", mask = "", corner_r = 0) {
    nx = size[0]; ny = size[1];
    if (mask != "")
        offset(delta = -GAP) union() for (c = _mask_cells(mask)) translate(c*PITCH) square(PITCH);
    else if (shape == "round")
        translate([nx*PITCH/2, ny*PITCH/2]) circle(d = min(nx, ny)*PITCH - 2*GAP, $fn = 32*min(nx, ny) + 32);
    else if (corner_r > 0)
        translate([GAP, GAP]) offset(r = corner_r) offset(delta = -corner_r) square([nx*PITCH - 2*GAP, ny*PITCH - 2*GAP]);
    else
        translate([GAP, GAP]) square([nx*PITCH - 2*GAP, ny*PITCH - 2*GAP]);
}

// ---------------------------------------------------------------------
//  Side slots
// ---------------------------------------------------------------------

// Height of a side slot's centre. Above the sockets there must be
// WALL_1 of material, so in low parts the slot moves up.
function _slot_zc(orient, h) = max(h/2, SOCKET_DEPTH + WALL_1 + slot_side_h(orient)/2);

// Upright slots need 9.0 mm of height above the sockets; fall back to flat.
function _slot_orient(orient, h) =
    orient == "upright" && _slot_zc("upright", h) + slot_side_h("upright")/2 + WALL_1 > h ? "flat" : orient;

// Resolve per-face index lists into placements [x, y, zc, rotation, orient].
// The slot cutter's local +Y (into the part) is rotated to face inward.
function _side_slots(nx, ny, h, x0 = [], x1 = [], y0 = [], y1 = [], orient = "flat") =
    h < SIDE_SLOT_MIN_H ? [] :
    let(o = _slot_orient(orient, h), z = _slot_zc(o, h))
    concat(
        [for (i = y0) [cell(i), GAP, z, 0, o]],
        [for (i = y1) [cell(i), ny*PITCH - GAP, z, 180, o]],
        [for (i = x0) [GAP, cell(i), z, -90, o]],
        [for (i = x1) [nx*PITCH - GAP, cell(i), z, 90, o]]);

// Solid kept around a side slot when the part is hollow: the slot plus
// WALL_2, reaching down to the socket roof so it never overhangs.
module _slot_boss(s) {
    H = slot_side_h(s[4]);
    L = s[4] == "upright" ? SLOT_T : slot_len();
    translate([s[0], s[1], 0]) rotate(s[3])
        translate([-L/2 - WALL_2, -eps, SOCKET_DEPTH]) cube([L + 2*WALL_2, SLOT_DEPTH + WALL_2, s[2] + H/2 + WALL_2 - SOCKET_DEPTH]);
}

// ---------------------------------------------------------------------
//  The core builder
// ---------------------------------------------------------------------

// Adds studs, sockets, hollowing, slots and bores to a body.
//   children(0)   the solid body (already shaped: sloped, notched, ...)
//   h             height of the stud plane
//   socket_cells  cells with a socket underneath
//   stud_cells    cells with a stud on top
//   cavity_cells  cells hollowed above their socket (only where it's safe)
//   side_slots    placements from _side_slots()
//   top_slots     [[x, y], ...] or [[x, y, rotation], ...]: vertical slots in the top
//   bores         [[x_mm, z_mm, "grip"|"spin", length, top], ...]: bores along Y,
//                 centred in the part's width
module _block(h, socket_cells, stud_cells, cavity_cells = [], side_slots = [], top_slots = [], bores = [], width = PITCH, rib_d = RIB_D) {
    difference() {
        union() {
            difference() {
                children(0);
                for (c = cavity_cells) translate([cell(c[0]), cell(c[1]), 0]) socket_cavity(h - ROOF);
            }
            // keep solid material around features inside a hollow part
            if (len(cavity_cells) > 0) intersection() {
                children(0);
                union() {
                    for (s = side_slots) _slot_boss(s);
                    for (t = top_slots) translate([cell(t[0]), cell(t[1]), 0]) rotate(len(t) > 2 ? t[2] : 0)
                        translate([-slot_len()/2 - WALL_2, -SLOT_T/2 - WALL_2, SOCKET_DEPTH]) cube([slot_len() + 2*WALL_2, SLOT_T + 2*WALL_2, h]);
                    for (b = bores) translate([b[0] - GRIP_BORE_D/2 - WALL_2, -1, SOCKET_DEPTH])
                        cube([GRIP_BORE_D + 2*WALL_2, width + 2, b[1] + GRIP_BORE_D*0.71 + WALL_2 - SOCKET_DEPTH]);
                }
            }
        }
        for (c = socket_cells) translate([cell(c[0]), cell(c[1]), 0]) socket(rib_d);
        for (s = side_slots) translate([s[0], s[1], s[2]]) rotate(s[3]) slot_side(s[4]);
        for (t = top_slots) translate([cell(t[0]), cell(t[1]), h]) rotate(len(t) > 2 ? t[2] : 0) slot_v();
        for (b = bores) translate([b[0], width/2, b[1]])
            if (b[2] == "spin") bore_spin(b[3], top = b[4]);
            else bore_grip(b[3], top = b[4]);
    }
    for (c = stud_cells) if (!_contains(top_slots, c))
        translate([cell(c[0]), cell(c[1]), h - eps]) stud();
}

// ---------------------------------------------------------------------
//  block(): plates, bricks, tiles, round, corner parts
// ---------------------------------------------------------------------

//   size        [x, y] in studs (ignored when mask is set)
//   plates      height in plates (1 = plate, 3 = brick)
//   shape       "rect" | "round"
//   mask        cell mask for L/T/cross parts, e.g. "XX/X." (rows "/"-separated)
//   corner_r    outer corner rounding (mm), rect only
//   tile        no studs (smooth top)
//   hollow      hollow cells above their sockets (saves ~30-40 % on bricks)
//   slots_x0 .. slots_y1   cell indices that get a side slot on that face
//                          (x0 = left end, x1 = right end, y0 = front, y1 = back)
//   slot_orient "flat" (5.4 bridge, fits 2-plate parts) | "upright" (bricks only)
//   slots_top   [[x, y], ...] cells with a vertical slot instead of a stud
module block(size = [2, 2], plates = 3, shape = "rect", mask = "", corner_r = 0,
             tile = false, hollow = false,
             slots_x0 = [], slots_x1 = [], slots_y0 = [], slots_y1 = [],
             slot_orient = "flat", slots_top = [], rib_d = RIB_D) {
    cells = mask != "" ? _mask_cells(mask)
          : shape == "round" ? _round_cells(min(size[0], size[1]))
          : _rect_cells(size[0], size[1]);
    sz = mask != "" ? _mask_size(cells) : size;
    h = plates * PLATE;
    sides = _side_slots(sz[0], sz[1], h, slots_x0, slots_x1, slots_y0, slots_y1, slot_orient);
    if (h < SIDE_SLOT_MIN_H && len(concat(slots_x0, slots_x1, slots_y0, slots_y1)) > 0)
        echo(str("WARNING: side slots need at least ", SIDE_SLOT_MIN_H, " mm height; ignored"));
    if (h < PLATE*2 && len(slots_top) > 0)
        echo("WARNING: top slots need at least 2 plates of height");
    _block(h, cells, tile ? [] : cells, hollow && plates > 1 ? cells : [],
           sides, h >= 2*PLATE ? slots_top : [], [], sz[1]*PITCH, rib_d)
        linear_extrude(h) footprint_2d(sz, shape, mask, corner_r);
}

// ---------------------------------------------------------------------
//  slope(): slopes and inverted slopes
// ---------------------------------------------------------------------

//   size      [x, y]; the slope falls towards +X
//   plates    height in plates
//   run       number of cells (along X) the slope covers; the rest is flat with studs
//   lip       height of the low edge in mm; -1 = lowest that keeps WALL_1
//             above the sockets
//   inverted  slope on the underside (studs on all cells, sockets only under
//             the flat part). The underside is kept at 45° or steeper; the part
//             gets taller if needed.
module slope(size = [2, 1], plates = 3, run = 1, lip = -1, inverted = false, hollow = false, rib_d = RIB_D) {
    nx = size[0]; ny = size[1]; h = plates * PLATE;
    xe = nx*PITCH - GAP;                       // far (low) end
    x0 = max((nx - run)*PITCH, GAP);           // where the slope starts
    flat = [for (c = _rect_cells(nx, ny)) if (c[0] < nx - run) c];
    module extrude_xz(pts) {
        translate([0, ny*PITCH - GAP, 0]) rotate([90, 0, 0]) linear_extrude(ny*PITCH - 2*GAP) polygon(pts);
    }
    if (!inverted) {
        // keep SOCKET_DEPTH + WALL_1 under the slope at the far socket edge
        zmin = SOCKET_DEPTH + WALL_1;
        xs = cell(nx - 1) + SOCKET_D/2;
        lip_min = h - (h - zmin)*(xe - x0)/(xs - x0);
        lip_eff = lip < 0 ? ceil(max(lip_min, LAYER)/LAYER)*LAYER : max(lip, lip_min);
        if (lip >= 0 && lip < lip_min) echo(str("WARNING: slope lip raised to ", lip_min, " mm to keep the socket roof"));
        _block(h, _rect_cells(nx, ny), flat, hollow && plates > 1 ? flat : [], width = ny*PITCH, rib_d = rib_d)
            extrude_xz([[GAP, 0], [xe, 0], [xe, lip_eff], [x0, h], [GAP, h]]);
    } else {
        // underside rises at exactly 45° from x0, leaving t_end at the far top edge
        t_end = h - (xe - x0);
        if (t_end < ROOF) echo(str("WARNING: inverted slope too low for 45°: top edge only ", t_end, " mm thick; add plates"));
        _block(h, flat, _rect_cells(nx, ny), hollow && plates > 1 ? flat : [], width = ny*PITCH, rib_d = rib_d)
            extrude_xz([[GAP, 0], [x0, 0], [xe, h - max(t_end, ROOF)], [xe, h], [GAP, h]]);
    }
}

// ---------------------------------------------------------------------
//  wedge(): angled footprint
// ---------------------------------------------------------------------

//   size   [length x, width y]
//   side   "right": the angled edge is on the back (+Y) side; "left": mirrored
//   tip    width (in studs) left at the far end; 0 = pointed
//   Cells get a stud/socket only where it fits completely inside.
module wedge(size = [3, 2], plates = 1, side = "right", tip = 0, tile = false, hollow = false, rib_d = RIB_D) {
    nx = size[0]; ny = size[1]; h = plates * PLATE;
    L = nx*PITCH; W = ny*PITCH; tw = tip*PITCH;
    poly = side == "right"
        ? (tw > 0 ? [[0, 0], [L, 0], [L, tw], [0, W]] : [[0, 0], [L, 0], [0, W]])
        : (tw > 0 ? [[0, 0], [L, W - tw], [L, W], [0, W]] : [[0, 0], [L, W], [0, W]]);
    sock = [for (c = _rect_cells(nx, ny)) if (_inside([cell(c[0]), cell(c[1])], poly, GAP + SOCKET_D/2 + WALL_1)) c];
    studs = [for (c = _rect_cells(nx, ny)) if (_inside([cell(c[0]), cell(c[1])], poly, GAP + STUD_D/2 + STUD_FILLET)) c];
    _block(h, sock, tile ? [] : studs, hollow && plates > 1 ? sock : [], width = W, rib_d = rib_d)
        linear_extrude(h) offset(delta = -GAP) polygon(poly);
}

// ---------------------------------------------------------------------
//  arch(): opening with 45° flanks and a flat top bridge <= BRIDGE_MAX
// ---------------------------------------------------------------------

//   size   [x, y]; the opening spans all cells except the two end cells
module arch(size = [4, 1], plates = 3, hollow = false, rib_d = RIB_D) {
    nx = size[0]; ny = size[1]; h = plates * PLATE;
    xa = PITCH; xb = (nx - 1)*PITCH; W = xb - xa;
    top = h - ROOF;
    f0 = min(BRIDGE_MAX, W);
    zs0 = top - (W - f0)/2;
    flatw = zs0 >= 0 ? f0 : W - 2*top;          // too low for 45°: widen the top
    zs = max(zs0, 0);
    rise = (W - flatw)/2;
    if (zs0 < 0) echo(str("WARNING: arch too low for 45° flanks; top bridge is ", flatw, " mm (add plates)"));
    ends = [for (c = _rect_cells(nx, ny)) if (c[0] == 0 || c[0] == nx - 1) c];
    _block(h, ends, _rect_cells(nx, ny), hollow && plates > 1 ? ends : [], width = ny*PITCH, rib_d = rib_d)
        difference() {
            linear_extrude(h) footprint_2d([nx, ny]);
            translate([0, ny*PITCH + 1, 0]) rotate([90, 0, 0]) linear_extrude(ny*PITCH + 2)
                polygon([[xa, -1], [xb, -1], [xb, zs], [xb - rise, top], [xa + rise, top], [xa, zs]]);
        }
}

// ---------------------------------------------------------------------
//  Wheel set
// ---------------------------------------------------------------------

// Height of a horizontal axle bore centre above the bed in a part with
// sockets (WALL_1 between socket roof and bore) and the bore's top.
AXLE_Z = SOCKET_DEPTH + WALL_1 + GRIP_BORE_D/2;     // 4.4
function _bore_top(type) = (type == "spin" ? BORE_SPIN_D : GRIP_BORE_D)/2 * sqrt(2);

// Brick with horizontal axle bores across its width (along Y).
//   axle_x  bore positions along X in studs from the left end
//           (0.5 = centre of the first cell, 1 = between cells 1 and 2)
//   bore    "grip": the axle is clamped (wheels spin on it) | "spin"
module axle_brick(size = [2, 2], plates = 3, axle_x = [1], bore = "grip", hollow = false, rib_d = RIB_D) {
    nx = size[0]; ny = size[1]; h = plates * PLATE;
    if (AXLE_Z + _bore_top(bore) + WALL_1 > h) echo("WARNING: axle_brick needs 3 plates of height for the bore");
    cells = _rect_cells(nx, ny);
    // cells whose cavity would cut the bore stay solid
    free = [for (c = cells) if (min([for (x = axle_x) abs(cell(c[0]) - x*PITCH)]) > SOCKET_D/2 + GRIP_BORE_D/2 + WALL_1) c];
    _block(h, cells, cells, hollow ? free : [], [], [],
           [for (x = axle_x) [x*PITCH, AXLE_Z, bore, ny*PITCH + 1, undef]], ny*PITCH, rib_d)
        linear_extrude(h) footprint_2d([nx, ny]);
}

// Wheel hub, printed flat (axle vertical). The bore spins on the axle.
//   d      rim diameter
//   w      width (height when printed)
//   tread  "none" | "grooves" (printed tread) | "tire" (channel for tire())
//   holes  lightening holes (only drawn when there is room)
//   boss   spacer ring around the bore on the top face (faces the brick)
module wheel(d = 16, w = 6.4, tread = "none", holes = true, boss = 0.6, bore = "spin") {
    rb = 3.5;                                     // boss radius
    rim_in = d/2 - (tread == "tire" ? _channel_td(w) : 0) - WALL_3;
    hole_d = min(5, rim_in - rb - 2*WALL_1);
    difference() {
        union() {
            cylinder(d = d, h = w, $fn = 96);
            if (boss > 0) translate([0, 0, w - eps]) cylinder(r = rb, h = boss + eps);
        }
        if (bore == "spin") bore_spin_v(w + boss); else bore_grip_v(w + boss);
        if (tread == "grooves") {
            n = floor(PI*d / 2.0);
            for (k = [0:n-1]) rotate(k*360/n) translate([d/2 - 0.6, -0.45, -eps]) cube([1, 0.9, w + 2*eps]);
        }
        if (tread == "tire") rotate_extrude($fn = 96) polygon(_tire_channel(d, w, 1));
        if (holes && hole_d >= 2) {
            rr = (rb + rim_in)/2;
            for (k = [0:5]) rotate(k*60) translate([rr, 0, -eps]) cylinder(d = hole_d, h = w + 2*eps, $fn = 32);
        }
    }
}

// Depth of the tyre channel: WHEEL_CHANNEL, shallower on narrow wheels so the
// channel floor stays at least 0.8 mm wide.
function _channel_td(w) = max(0.4, min(WHEEL_CHANNEL, (w - 2*WALL_1 - 0.8)/2));

// Tyre channel cross-section (r, z): 45° flanks, rim lips of WALL_1.
//   grow  extends the polygon outward (for clean cutting)
function _tire_channel(d, w, grow = 0) =
    let(td = _channel_td(w), b = (w - 2*WALL_1 - 2*td)/2, r = d/2)
    [[r - td, w/2 - b], [r + grow, w/2 - b - td - grow], [r + grow, w/2 + b + td + grow], [r - td, w/2 + b]];

// TPU tyre for wheel(tread="tire"), printed flat. Its inner bead fills
// the rim channel; it is TIRE_STRETCH smaller so it stays on.
//   t  tread thickness
module tire(d = 16, w = 6.4, t = 1.6) {
    td = _channel_td(w); b = (w - 2*WALL_1 - 2*td)/2;
    r0 = d/2 - TIRE_STRETCH; ri = r0 - td; ro = d/2 + t;
    rotate_extrude($fn = 96) polygon([
        [r0, 0], [ro, 0], [ro, w], [r0, w],
        [r0, w/2 + b + td], [ri, w/2 + b], [ri, w/2 - b], [r0, w/2 - b - td]]);
}

// Ring that grips the axle outside a wheel and keeps it on.
module grip_collar(d = 8, h = 3.2) {
    difference() {
        cylinder(d = d, h = h);
        bore_grip_v(h);
    }
}

// ---------------------------------------------------------------------
//  Hinge: two knuckle leaves on a Ø3 pin (steel rod or printed_axle)
// ---------------------------------------------------------------------
//
//  Side view (XZ) at the hinge axis, x = size[0]*8:
//
//      own knuckle segment            other leaf's segment
//      ┌────────────╮                 ┌────────╲
//      │         ( o )                │         ╲  notch: 45° top,
//      │          ╱                   │          )  clears the other
//      └─────────╱                    └─────────┘   leaf's knuckle
//
//  Knuckles alternate along Y; leaf "a" owns the even segments (incl.
//  both ends), leaf "b" the odd ones. Turn leaf b by 180° around Z to
//  assemble. Leaf a clamps the pin (grip bore), leaf b turns on it.
//  Rotation: from flat, about -90° (fold down) to +70° (fold up).
//  The last column has no studs/sockets (the knuckles live there).
//
//   leaf       "a" | "b"
//   slots_x0   side slots in the far end face, to attach the leaf with clips
module hinge_leaf(size = [2, 2], plates = 2, leaf = "a", hollow = false, slots_x0 = [], rib_d = RIB_D) {
    nx = size[0]; ny = size[1]; h = plates * PLATE;
    m = h/2; R = m; xa = nx*PITCH; c = HINGE_CLEAR;
    k = R*(sqrt(2) - 1);                         // half-width of the 45° foot under the knuckle
    Re = sqrt(R*R + k*k) + c;                    // swept radius of a knuckle + clearance
    K = 2*ny + 1;                                // knuckle segments along Y
    y0 = GAP; s = (ny*PITCH - 2*GAP)/K;
    own = leaf == "a" ? 0 : 1;
    bore = leaf == "a" ? "grip" : "spin";
    cells = [for (cc = _rect_cells(nx - 1, ny)) cc];

    module own_profile() {
        translate([GAP, 0]) square([xa - GAP, h]);
        hull() {
            translate([xa, m]) circle(r = R);
            translate([xa - k, 0]) square([2*k, 0.01]);
        }
    }
    module foreign_profile() {
        difference() {
            translate([GAP, 0]) square([xa - GAP, h]);
            hull() {
                translate([xa, m]) circle(r = Re);
                polygon([[xa - Re, -1], [xa + Re + 1, -1], [xa + Re + 1, h + 1],
                         [xa - Re/sqrt(2) + (h + 1 - m - Re/sqrt(2)), h + 1]]);
            }
        }
    }
    module body() {
        for (i = [0:K-1]) {
            mine = (i % 2) == own;
            ya = y0 + i*s       + (i == 0     ? 0 : (mine ? c/2 : -c/2));
            yb = y0 + (i + 1)*s - (i == K - 1 ? 0 : (mine ? c/2 : -c/2));
            // segments overlap by eps so their union has no zero-thickness seams
            ya2 = i == 0 ? ya : ya - eps;
            yb2 = i == K - 1 ? yb : yb + eps;
            translate([0, yb2, 0]) rotate([90, 0, 0]) linear_extrude(yb2 - ya2)
                if (mine) own_profile(); else foreign_profile();
        }
    }
    if (nx < 2) echo("WARNING: hinge_leaf needs size[0] >= 2");
    _block(h, cells, cells, hollow && plates > 1 ? cells : [],
           _side_slots(nx, ny, h, x0 = slots_x0), [],
           [[xa, m, bore, ny*PITCH + 1, R - WALL_1]], ny*PITCH, rib_d)
        body();
}

// Both leaves: laid out for printing, or assembled (flat) for a preview.
module hinge_pair(size = [2, 2], plates = 2, assembled = false, slots_x0 = []) {
    hinge_leaf(size, plates, "a", slots_x0 = slots_x0);
    if (assembled)
        translate([2*size[0]*PITCH, size[1]*PITCH, 0]) rotate(180) hinge_leaf(size, plates, "b", slots_x0 = slots_x0);
    else
        translate([0, size[1]*PITCH + 6, 0]) hinge_leaf(size, plates, "b", slots_x0 = slots_x0);
}

// ---------------------------------------------------------------------
//  Clip sheet
// ---------------------------------------------------------------------

module clip_sheet(n = 10, cols = 5) {
    for (i = [0:n-1]) translate([(i % cols)*9, floor(i/cols)*8, 0]) clip();
}

// ---------------------------------------------------------------------
//  Calibration coupon: one fit value in 5 steps (centre +- 2 steps)
// ---------------------------------------------------------------------
//
//   param   "rib_d"       socket rib tips (1x5 plate) + 2 stud plugs
//           "slot_interf" clip barb interference (5 top slots) + 5 clips
//           "slot_clear"  slot clearance in clip thickness (5 top slots) + 5 clips
//           "bore_spin"   spinning bore diameter (1x5 brick)
//           "bore_grip"   grip bore rib tip diameter (1x5 brick)
//   center  middle value (default: the current config value)
//   step    increment (default 0.05)
//   labels  "text" (values, needs a font) | "dots" (1-5 dots) | "none"
function coupon_default(param) =
    param == "rib_d" ? RIB_D : param == "slot_interf" ? SLOT_INTERF : param == "slot_clear" ? SLOT_CLEAR :
    param == "bore_spin" ? BORE_SPIN_D : param == "bore_grip" ? BORE_GRIP_D : undef;

function _fmt(v) = let(r = round(v*100)) str(r < 0 ? "-" : "", floor(abs(r)/100), ".", abs(r) % 100 < 10 ? "0" : "", abs(r) % 100);

module coupon(param = "rib_d", center = -1, step = 0.05, labels = "dots") {
    c = center < 0 ? coupon_default(param) : center;
    vals = [for (k = [-2:2]) c + k*step];
    assert(c != undef, str("unknown coupon parameter ", param));
    module lab(i) {
        if (labels == "text") label(_fmt(vals[i]), 2.2);
        else if (labels == "dots") dot_label(i + 1);
    }
    module body(nx, ny, h) { linear_extrude(h) footprint_2d([nx, ny]); }

    if (param == "rib_d") {
        difference() {
            body(5, 1, PLATE);
            for (i = [0:4]) translate([cell(i), cell(0), 0]) socket(vals[i]);
        }
        for (i = [0:4]) translate([cell(i), cell(0), PLATE]) lab(i);
        for (i = [0:1]) translate([i*PITCH, -PITCH - 2, 0]) {          // stud plugs
            body(1, 1, PLATE);
            translate([cell(0), cell(0), PLATE - eps]) stud();
        }
    } else if (param == "slot_interf" || param == "slot_clear") {
        h = 2*PLATE;
        difference() {
            body(5, 2, h);
            for (i = [0:4]) translate([cell(i), cell(1), h])
                if (param == "slot_interf") slot_v(slot_len(vals[i]));
                else slot_v(slot_len(), CLIP_T + 2*vals[i]);
        }
        for (i = [0:4]) translate([cell(i), cell(0), h]) lab(i);
        translate([CLIP_HALF + 1, -CLIP_W - 2, 0]) clip_sheet(5, 5);
    } else {
        difference() {
            body(5, 1, BRICK);
            for (i = [0:4]) translate([cell(i), cell(0), BRICK/2 - 0.5])
                if (param == "bore_spin") bore_spin(PITCH + 1, vals[i]);
                else bore_grip(PITCH + 1, vals[i]);
        }
        for (i = [0:4]) translate([cell(i), cell(0), BRICK]) lab(i);
    }
}
