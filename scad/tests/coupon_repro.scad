// =====================================================================
//  Rebuilds every part of reference/coupon.scad from config.scad +
//  connectors.scad. scripts/check.py renders both files part by part and
//  requires the meshes to match within 0.01 mm.
//
//    openscad -D 'part="socket_bar"' -o out.stl tests/coupon_repro.scad
// =====================================================================

include <../connectors.scad>

part = "all";

// The coupon's test series (the library itself only keeps the chosen values).
RIB_D_TEST       = [5.1, 5.0, 4.9, 4.8, 4.7];
RIB_LABELS       = ["5.1", "5.0", "4.9", "4.8", "4.7"];
SLOT_INTERF_TEST = [0.05, 0.10, 0.15];
SLOT_LABELS      = [".05", ".10", ".15"];
BORE_SPIN_TEST   = [3.2, 3.3];
BORE_GRIP_TEST   = [2.9, 2.8];

module body(nx, ny, h) { translate([GAP, GAP, 0]) cube([nx*PITCH - 2*GAP, ny*PITCH - 2*GAP, h]); }

module socket_bar() {
    n = len(RIB_D_TEST);
    difference() {
        body(n, 1, PLATE);
        for (i = [0:n-1]) translate([cell(i), cell(0), 0]) socket(RIB_D_TEST[i]);
    }
    for (i = [0:n-1]) translate([cell(i), cell(0), PLATE]) label(RIB_LABELS[i], 2.6);
}

module stud_plug() {
    body(1, 1, PLATE);
    translate([cell(0), cell(0), PLATE - eps]) stud();
}

module plate2x2() {
    difference() {
        body(2, 2, PLATE);
        for (x = [0, 1], y = [0, 1]) translate([cell(x), cell(y), 0]) socket(RIB_D);
    }
    for (x = [0, 1], y = [0, 1]) translate([cell(x), cell(y), PLATE - eps]) stud();
}

module slot_block() {
    n = 5; row = cell(1);
    difference() {
        body(n, 2, BRICK);
        for (i = [0:len(SLOT_INTERF_TEST)-1])
            translate([cell(i), row, BRICK]) slot_v(slot_len(SLOT_INTERF_TEST[i]));
        // A: front face (-Y), upright
        translate([cell(3), GAP, BRICK/2]) slot_side("upright");
        // B: end face (+X), flat; local +Y (into the part) turned to -X
        translate([n*PITCH - GAP, row, BRICK/2]) rotate(90) slot_side("flat");
    }
    for (i = [0:len(SLOT_INTERF_TEST)-1])
        translate([cell(i), cell(0), BRICK]) label(SLOT_LABELS[i], 2.6);
    translate([cell(3), cell(0), BRICK]) label("A", 3.0);
    translate([cell(4), row, BRICK])     label("B", 3.0);
}

module clip_sheet(n = 10) {
    for (i = [0:n-1]) translate([(i % 5)*9, floor(i/5)*8, 0]) clip();
}

module axle_block() {
    bores = [["S", BORE_SPIN_TEST[0]], ["S", BORE_SPIN_TEST[1]], ["G", BORE_GRIP_TEST[0]], ["G", BORE_GRIP_TEST[1]]];
    difference() {
        body(4, 1, BRICK);
        for (i = [0:3])
            translate([cell(i), cell(0), BRICK/2 - 0.5])
                if (bores[i][0] == "S") bore_spin(PITCH + 1, bores[i][1]);
                else bore_grip(PITCH + 1, bores[i][1]);
    }
    for (i = [0:3]) translate([cell(i), cell(0), BRICK])
        label(str(bores[i][0], round(bores[i][1]*10)), 2.2);
}

module hub(kind) {
    difference() {
        cylinder(d = 14, h = 4);
        if (kind == "spin") bore_spin_v(4, BORE_SPIN_TEST[0]);
        else bore_grip_v(4, BORE_GRIP_TEST[0]);
    }
    translate([0, 4.6, 4]) label(kind == "spin" ? "S" : "G", 3.0);
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
