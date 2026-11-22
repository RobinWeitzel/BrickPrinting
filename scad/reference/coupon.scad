// =====================================================================
//  Brick system – connector validation coupon (0.4 mm nozzle)
//  LEGO scale (8 mm pitch, 3.2 mm plate), NOT LEGO compatible.
//
//  Render a single part:
//    openscad -D 'part="socket_bar"' -o socket_bar.stl coupon.scad
//  Parts: socket_bar, stud_plug, plate2x2, slot_block, clip, clip_sheet,
//         axle_block, hub_spin, hub_grip, printed_axle, all
//  Every part prints in the orientation it is modelled in, no supports.
// =====================================================================

part = "all";

$fn = 64;
eps = 0.01;
FONT = "DejaVu Sans:style=Bold";

// ---------- grid ----------
PITCH = 8.0;      // horizontal grid
PLATE = 3.2;      // plate height
BRICK = 9.6;      // 3 plates
GAP   = 0.1;      // per side, so neighbours don't rub (outer size = n*8 - 0.2)

// ---------- connector 1: stud + crush-rib socket ----------
STUD_D        = 5.0;
STUD_H        = 1.6;
STUD_CHAMFER  = 0.4;   // lead-in on top of stud
STUD_FILLET   = 0.4;   // root fillet against layer-line breakage
SOCKET_D      = 5.4;   // bore, i.e. 0.2 mm clearance per side before ribs
SOCKET_DEPTH  = 1.8;   // leaves a 1.4 mm roof in a 3.2 mm plate
SOCKET_CHAMF  = 0.4;   // entry chamfer (also hides elephant's foot)
RIB_R         = 0.5;   // rib = vertical half-cylinder, r = 0.5
RIB_N         = 4;
RIB_D_TEST    = [5.1, 5.0, 4.9, 4.8, 4.7];  // diameter across rib tips
RIB_LABELS    = ["5.1", "5.0", "4.9", "4.8", "4.7"];
RIB_D_DEFAULT = 4.75;                        // VALIDATED: 4.8 and 4.7 good, 4.9 loose, >=5.0 falls out

// ---------- connector 2: slot + flat clip ----------
CLIP_T     = 2.0;   // thickness (Z when printed flat)
CLIP_W     = 5.0;   // body width
CLIP_HALF  = 3.4;   // engagement depth per side (total clip length 6.8)
CLIP_ARM   = 0.9;   // spring arm width (2 lines at 0.4)
CLIP_BAND  = 0.8;   // solid centre band
BARB       = 0.3;   // barb height above body width, per side
BARB_LEAD  = 0.15;  // chamfer at arm tip
SLOT_T     = CLIP_T + 2*0.15;   // 2.3, plain clearance in thickness direction
SLOT_DEPTH = CLIP_HALF + 0.2;
SLOT_INTERF_TEST = [0.05, 0.10, 0.15];  // barb interference per side
SLOT_INTERF_DEFAULT = 0.10;             // VALIDATED
SLOT_LABELS      = [".05", ".10", ".15"];
function slot_len(i) = CLIP_W + 2*(BARB - i);

// ---------- axles ----------
AXLE_D        = 3.0;               // steel rod / M3 screw
BORE_SPIN     = [3.2, 3.3];        // free-running bores  (VALIDATED: 3.2 good, 3.3 wobbly)
BORE_GRIP     = [2.9, 2.8];        // diameter across rib tips (VALIDATED: 2.8 holds axially, axle can still twist)
GRIP_BORE_D   = 3.4;               // base bore under the ribs

// =====================================================================
//  helpers
// =====================================================================
function cell(i) = PITCH*i + PITCH/2;

module body(nx, ny, h) {
    translate([GAP, GAP, 0]) cube([nx*PITCH - 2*GAP, ny*PITCH - 2*GAP, h]);
}

// Raised label (0.4 mm), sized for a 0.4 mm nozzle. Place at the top face.
module label(txt, size=3.0, depth=0.4) {
    translate([0,0,-eps]) linear_extrude(depth + eps)
        text(txt, size=size, font=FONT, halign="center", valign="center");
}

// Stud with root fillet and top chamfer, base at z=0.
module stud() {
    r = STUD_D/2; f = STUD_FILLET; c = STUD_CHAMFER; h = STUD_H;
    arc = [for (a=[270:-10:180]) [r + f + f*cos(a), f + f*sin(a)]];
    rotate_extrude()
        polygon(concat([[0,0]], arc, [[r, h - c], [r - c, h], [0, h]]));
}

// Socket cutter, opening at z=0 going up.
module socket(rib_d) {
    R = SOCKET_D/2;
    rib_c = rib_d/2 + RIB_R;           // rib centre radius -> tips at rib_d/2
    start = SOCKET_CHAMF + 0.2;        // ribs begin above the entry chamfer
    difference() {
        translate([0,0,-eps]) cylinder(d=SOCKET_D, h=SOCKET_DEPTH + eps);
        for (k=[0:RIB_N-1]) rotate(45 + k*360/RIB_N) translate([rib_c, 0, 0]) {
            translate([0,0,start]) cylinder(r=RIB_R, h=SOCKET_DEPTH, $fn=24);
            // 45° taper so the rib start is not an overhang
            translate([0,0,start - RIB_R]) cylinder(r1=0, r2=RIB_R, h=RIB_R+eps, $fn=24);
        }
    }
    translate([0,0,-eps]) cylinder(d1=SOCKET_D + 2*SOCKET_CHAMF, d2=SOCKET_D, h=SOCKET_CHAMF + eps);
}

// Horizontal teardrop bore along Y, centred at origin (apex up = +Z).
module teardrop_y(d, len) {
    rotate([-90,0,0]) translate([0,0,-len/2])
        linear_extrude(len)
            rotate(180) hull() {          // after rotate([-90..]) +Y of 2D maps to -Z
                circle(d=d);
                rotate(45) square(d/2);  // 45° roof
            }
}

module grip_bore_y(rib_d, len) {
    rib_c = rib_d/2 + RIB_R;
    difference() {
        teardrop_y(GRIP_BORE_D, len + 2*eps);
        // ribs left, right, bottom (none at the top apex)
        for (a=[0, 180, 270]) rotate([0, -a, 0]) translate([rib_c, 0, 0])
            rotate([90,0,0]) cylinder(r=RIB_R, h=len + 4, center=true, $fn=24);
    }
}

// Clip 2D profile, insertion axis = X, width = Y, centred.
module clip_2d() {
    w = CLIP_W/2; a = CLIP_ARM; L = CLIP_HALF; b = CLIP_BAND/2;
    module half() {
        // centre band
        translate([0, -w]) square([b + eps, 2*w]);
        // upper arm with barb (mirrored for lower arm)
        for (m=[0,1]) mirror([0, m]) polygon([
            [b,          w - a],
            [L,          w - a],
            [L,          w - BARB_LEAD],   // tip lead-in
            [L - 1.0,    w + BARB],        // ramp up to barb
            [L - 2.0,    w + BARB],        // barb flat
            [L - 2.4,    w],               // back down to body width
            [b,          w]
        ]);
    }
    // round the inner root corners (concave) to spread stress
    offset(r=-0.3) offset(delta=0.3) union() { half(); mirror([1,0]) half(); }
}

module clip() { linear_extrude(CLIP_T) clip_2d(); }

// Vertical slot cutter from top face (z=0 is the face, going down).
module slot_v(len) {
    translate([-len/2, -SLOT_T/2, -SLOT_DEPTH]) cube([len, SLOT_T, SLOT_DEPTH + eps]);
    // entry chamfer
    hull() {
        translate([-len/2, -SLOT_T/2, -eps]) cube([len, SLOT_T, eps]);
        translate([-len/2 - 0.4, -SLOT_T/2 - 0.4, 0]) cube([len + 0.8, SLOT_T + 0.8, eps]);
        translate([-len/2, -SLOT_T/2, -0.4]) cube([len, SLOT_T, eps]);
    }
}

// =====================================================================
//  parts
// =====================================================================

// 1x5 plate, sockets with 5 rib interferences, labels on top.
module socket_bar() {
    n = len(RIB_D_TEST);
    difference() {
        body(n, 1, PLATE);
        for (i=[0:n-1]) translate([cell(i), cell(0), 0]) socket(RIB_D_TEST[i]);
    }
    for (i=[0:n-1]) translate([cell(i), cell(0), PLATE]) label(RIB_LABELS[i], 2.6);
}

// 1x1 plate with one stud, solid underside.
module stud_plug() {
    body(1, 1, PLATE);
    translate([cell(0), cell(0), PLATE - eps]) stud();
}

// 2x2 plate: studs on top, crush-rib sockets underneath (default rib).
module plate2x2(rib_d = RIB_D_DEFAULT) {
    difference() {
        body(2, 2, PLATE);
        for (x=[0,1], y=[0,1]) translate([cell(x), cell(y), 0]) socket(rib_d);
    }
    for (x=[0,1], y=[0,1]) translate([cell(x), cell(y), PLATE - eps]) stud();
}

// 5x2 brick: three vertical slots (interference test) in the back row,
// labels in the front row, one side slot standing upright (A, front face)
// and one lying flat (B, end face). Print two blocks to join them end to
// end through slot B.
module slot_block() {
    n = 5; row = cell(1);
    Lnom = slot_len(0.10);
    difference() {
        body(n, 2, BRICK);
        for (i=[0:len(SLOT_INTERF_TEST)-1])
            translate([cell(i), row, BRICK]) slot_v(slot_len(SLOT_INTERF_TEST[i]));
        // side slot A: front face (−Y), long axis vertical (only a 2.3 mm bridge)
        translate([cell(3) - SLOT_T/2, GAP - eps, BRICK/2 - Lnom/2])
            cube([SLOT_T, SLOT_DEPTH + eps, Lnom]);
        // side slot B: end face (+X), long axis horizontal (5.4 mm bridge)
        translate([n*PITCH - GAP - SLOT_DEPTH, row - Lnom/2, BRICK/2 - SLOT_T/2])
            cube([SLOT_DEPTH + eps, Lnom, SLOT_T]);
    }
    for (i=[0:len(SLOT_INTERF_TEST)-1])
        translate([cell(i), cell(0), BRICK]) label(SLOT_LABELS[i], 2.6);
    translate([cell(3), cell(0), BRICK]) label("A", 3.0);
    translate([cell(4), row, BRICK])     label("B", 3.0);
}

module clip_sheet(n = 10) {
    for (i=[0:n-1]) translate([(i % 5)*9, floor(i/5)*8, 0]) clip();
}

// 1x4 brick with horizontal axle bores along Y.
module axle_block() {
    bores = [ ["S", BORE_SPIN[0]], ["S", BORE_SPIN[1]], ["G", BORE_GRIP[0]], ["G", BORE_GRIP[1]] ];
    difference() {
        body(4, 1, BRICK);
        for (i=[0:3])
            translate([cell(i), cell(0), BRICK/2 - 0.5])
                if (bores[i][0] == "S") teardrop_y(bores[i][1], PITCH + 1);
                else grip_bore_y(bores[i][1], PITCH + 1);
    }
    for (i=[0:3]) translate([cell(i), cell(0), BRICK])
        label(str(bores[i][0], round(bores[i][1]*10)), 2.2);
}

// Wheel stand-ins, printed flat → vertical bore.
module hub(kind) {
    difference() {
        cylinder(d=14, h=4);
        if (kind == "spin") translate([0,0,-eps]) cylinder(d=BORE_SPIN[0], h=4 + 2*eps);
        else {
            rib_c = BORE_GRIP[0]/2 + RIB_R;
            difference() {
                translate([0,0,-eps]) cylinder(d=GRIP_BORE_D, h=4 + 2*eps);
                for (k=[0:2]) rotate(k*120) translate([rib_c,0,-1]) cylinder(r=RIB_R, h=6, $fn=24);
            }
        }
    }
    translate([0, 4.6, 4]) label(kind == "spin" ? "S" : "G", 3.0);
}

// Ø3 printed axle lying flat (0.3 mm flat on the bed side).
module printed_axle(len = 40) {
    flat = 0.3;
    intersection() {
        translate([0, 0, AXLE_D/2 - flat]) rotate([0, 90, 0]) cylinder(d=AXLE_D, h=len);
        translate([-1, -AXLE_D, 0]) cube([len + 2, 2*AXLE_D, AXLE_D]);
    }
}

module all_parts() {
    socket_bar();
    translate([44, 0, 0])   stud_plug();
    translate([54, 0, 0])   stud_plug();
    translate([0, 12, 0])   plate2x2();
    translate([20, 12, 0])  plate2x2();
    translate([47, 20, 0])  hub("spin");
    translate([63, 20, 0])  hub("grip");
    translate([0, 32, 0])   slot_block();
    translate([44, 32, 0])  slot_block();
    translate([0, 52, 0])   axle_block();
    translate([40, 56, 0])  clip_sheet(10);
    translate([0, 72, 0])   printed_axle(40);
}

// ---------- dispatch ----------
if      (part == "socket_bar")   socket_bar();
else if (part == "stud_plug")    stud_plug();
else if (part == "plate2x2")     plate2x2();
else if (part == "slot_block")   slot_block();
else if (part == "clip")         clip();
else if (part == "clip_sheet")   clip_sheet(10);
else if (part == "axle_block")   axle_block();
else if (part == "hub_spin")     hub("spin");
else if (part == "hub_grip")     hub("grip");
else if (part == "printed_axle") printed_axle(40);
else                             all_parts();
