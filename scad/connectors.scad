// =====================================================================
//  Brick system: connector modules
//
//  The shapes are taken 1:1 from the validated test coupon
//  (reference/coupon.scad); only the values moved to config.scad.
//  tests/coupon_repro.scad rebuilds every coupon part from these
//  modules and scripts/check.py compares the meshes.
//
//  Conventions
//    * "Cutter" modules (socket, slot_*, bore_*) return the volume to
//      subtract. They overshoot the face by eps so differences are clean.
//    * Male parts (stud, clip) are positive volumes.
//    * Z is up = the print direction. Nothing here needs support.
// =====================================================================

include <config.scad>

// ---------------------------------------------------------------------
//  Labels
// ---------------------------------------------------------------------

// Raised label (0.4 mm), sized for a 0.4 mm nozzle. Place at a top face.
module label(txt, size = 3.0, depth = 0.4) {
    translate([0, 0, -eps]) linear_extrude(depth + eps)
        text(txt, size = size, font = FONT, halign = "center", valign = "center");
}

// Font-free label: `n` raised dots in a row (works in the browser build,
// which ships no fonts). Dot = 0.9 mm (2 lines), 0.4 mm tall.
module dot_label(n, depth = 0.4) {
    pitch = 1.5;
    for (k = [0:n-1]) translate([(k - (n-1)/2) * pitch, 0, -eps])
        cylinder(d = 0.9, h = depth + eps, $fn = 16);
}

// ---------------------------------------------------------------------
//  Connector 1: stud + crush-rib socket (vertical stacking)
// ---------------------------------------------------------------------

// Stud with root fillet and top chamfer, base at z=0.
module stud() {
    r = STUD_D/2; f = STUD_FILLET; c = STUD_CHAMFER; h = STUD_H;
    arc = [for (a = [270:-10:180]) [r + f + f*cos(a), f + f*sin(a)]];
    rotate_extrude()
        polygon(concat([[0, 0]], arc, [[r, h - c], [r - c, h], [0, h]]));
}

// Socket cutter, opening at z=0 going up.
//   rib_d  diameter across the rib tips (the fit value)
module socket(rib_d = RIB_D) {
    R = SOCKET_D/2;
    rib_c = rib_d/2 + RIB_R;           // rib centre radius -> tips at rib_d/2
    start = SOCKET_CHAMF + 0.2;        // ribs begin above the entry chamfer
    difference() {
        translate([0, 0, -eps]) cylinder(d = SOCKET_D, h = SOCKET_DEPTH + eps);
        for (k = [0:RIB_N-1]) rotate(45 + k*360/RIB_N) translate([rib_c, 0, 0]) {
            translate([0, 0, start]) cylinder(r = RIB_R, h = SOCKET_DEPTH, $fn = 24);
            // 45° taper so the rib start is not an overhang
            translate([0, 0, start - RIB_R]) cylinder(r1 = 0, r2 = RIB_R, h = RIB_R + eps, $fn = 24);
        }
    }
    translate([0, 0, -eps]) cylinder(d1 = SOCKET_D + 2*SOCKET_CHAMF, d2 = SOCKET_D, h = SOCKET_CHAMF + eps);
}

// Hollowing cavity above a socket: the socket bore continued upward with
// a flat ceiling (a Ø5.4 bridge, same as the socket roof). z=0 is the
// bottom face; the cavity starts inside the socket and ends at `top`.
module socket_cavity(top) {
    if (top > SOCKET_DEPTH)
        translate([0, 0, SOCKET_DEPTH - eps]) cylinder(d = SOCKET_D, h = top - SOCKET_DEPTH + eps);
}

// ---------------------------------------------------------------------
//  Connector 2: slot + flat clip (sideways and special connections)
// ---------------------------------------------------------------------

// Clip 2D profile, insertion axis = X, width = Y, centred.
module clip_2d() {
    w = CLIP_W/2; a = CLIP_ARM; L = CLIP_HALF; b = CLIP_BAND/2;
    // round the inner root corners (concave) to spread stress
    offset(r = -CLIP_ROOT_R) offset(delta = CLIP_ROOT_R) union() {
        clip_half_2d();
        mirror([1, 0]) clip_half_2d();
    }
}

// One half of the clip (+X side), including half the centre band.
// Shared by clip_2d() and the hinge clip in parts.scad.
module clip_half_2d() {
    w = CLIP_W/2; a = CLIP_ARM; L = CLIP_HALF; b = CLIP_BAND/2;
    translate([0, -w]) square([b + eps, 2*w]);              // centre band
    for (m = [0, 1]) mirror([0, m]) polygon([               // arm with barb
        [b,       w - a],
        [L,       w - a],
        [L,       w - BARB_LEAD],    // tip lead-in
        [L - 1.0, w + BARB],         // ramp up to barb
        [L - 2.0, w + BARB],         // barb flat
        [L - 2.4, w],                // back down to body width
        [b,       w]
    ]);
}

module clip() { linear_extrude(CLIP_T) clip_2d(); }

// Vertical slot cutter in a top face (z=0 is the face, going down).
//   len  slot length; default = clip width + barbs - interference
//   t    slot thickness; default = clip thickness + 2 x clearance
module slot_v(len = slot_len(), t = SLOT_T) {
    translate([-len/2, -t/2, -SLOT_DEPTH]) cube([len, t, SLOT_DEPTH + eps]);
    // entry chamfer
    hull() {
        translate([-len/2, -t/2, -eps]) cube([len, t, eps]);
        translate([-len/2 - SLOT_CHAMF, -t/2 - SLOT_CHAMF, 0]) cube([len + 2*SLOT_CHAMF, t + 2*SLOT_CHAMF, eps]);
        translate([-len/2, -t/2, -SLOT_CHAMF]) cube([len, t, eps]);
    }
}

// Side slot cutter. Local frame: the face is the plane y=0, the slot goes
// into +Y, centred on x=0 and z=0 (z = height of the slot centre).
//   orient "upright": long axis vertical, ceiling is a 2.3 mm bridge
//          "flat":    long axis horizontal, ceiling is a 5.4 mm bridge
module slot_side(orient = "upright", len = slot_len()) {
    if (orient == "upright")
        translate([-SLOT_T/2, -eps, -len/2]) cube([SLOT_T, SLOT_DEPTH + eps, len]);
    else
        translate([-len/2, -eps, -SLOT_T/2]) cube([len, SLOT_DEPTH + eps, SLOT_T]);
}

// Height a side slot occupies (for placement and wall checks).
function slot_side_h(orient, len = slot_len()) = orient == "upright" ? len : SLOT_T;

// ---------------------------------------------------------------------
//  Axle bores
// ---------------------------------------------------------------------

// Horizontal teardrop along Y, centred at origin, 45° apex up (+Z).
//   top  optional: cut the apex flat at this height above the centre
//        (keeps a minimum wall in low parts; the flat is a tiny bridge)
module teardrop_y(d, len, top = undef) {
    module full() {
        rotate([-90, 0, 0]) translate([0, 0, -len/2])
            linear_extrude(len)
                rotate(180) hull() {          // after rotate([-90..]) +Y of 2D maps to -Z
                    circle(d = d);
                    rotate(45) square(d/2);  // 45° roof
                }
    }
    if (top == undef) full();
    else intersection() {
        full();
        translate([-d, -len, -d]) cube([2*d, 2*len, d + top]);
    }
}

// Free-running horizontal bore along Y (wheels, hinges).
module bore_spin(len, d = BORE_SPIN_D, top = undef) { teardrop_y(d, len, top); }

// Gripping horizontal bore along Y: teardrop + 3 crush ribs (left, right,
// bottom; none at the apex). Holds the axle axially, it can still twist.
module bore_grip(len, rib_d = BORE_GRIP_D, top = undef) {
    rib_c = rib_d/2 + RIB_R;
    difference() {
        teardrop_y(GRIP_BORE_D, len + 2*eps, top);
        for (a = [0, 180, 270]) rotate([0, -a, 0]) translate([rib_c, 0, 0])
            rotate([90, 0, 0]) cylinder(r = RIB_R, h = len + 4, center = true, $fn = 24);
    }
}

// Vertical bores (parts printed with the axle axis vertical: hubs, collars).
// Base at z=0, height h, through.
module bore_spin_v(h, d = BORE_SPIN_D) {
    translate([0, 0, -eps]) cylinder(d = d, h = h + 2*eps);
}

module bore_grip_v(h, rib_d = BORE_GRIP_D) {
    rib_c = rib_d/2 + RIB_R;
    difference() {
        translate([0, 0, -eps]) cylinder(d = GRIP_BORE_D, h = h + 2*eps);
        for (k = [0:2]) rotate(k*120) translate([rib_c, 0, -1]) cylinder(r = RIB_R, h = h + 2, $fn = 24);
    }
}

// Ø3 axle lying flat along +X from x=0 (flat on the bed side).
module printed_axle(len = 40) {
    intersection() {
        translate([0, 0, AXLE_D/2 - AXLE_FLAT]) rotate([0, 90, 0]) cylinder(d = AXLE_D, h = len);
        translate([-1, -AXLE_D, 0]) cube([len + 2, 2*AXLE_D, AXLE_D]);
    }
}
