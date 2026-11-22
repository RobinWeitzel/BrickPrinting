// =====================================================================
//  Brick system: global configuration
//
//  Every grid and fit value from SPEC.md lives here. Values marked
//  [fit] are the ones to re-tune per printer/filament with the
//  calibration coupon (parts.scad -> coupon()). Override any of them
//  from the command line without editing this file:
//
//    openscad -D 'RIB_D=4.8' -o plate.stl examples/plates.scad
//
//  All lengths in mm. Designed for a 0.4 mm nozzle and 0.2 mm layers.
// =====================================================================

$fn = 64;
eps = 0.01;               // overlap for clean booleans (not a real dimension)
FONT = "DejaVu Sans:style=Bold";

// ---------- print process ----------
LINE   = 0.45;            // extrusion width; walls are multiples (see WALL_*)
LAYER  = 0.2;             // layer height; heights are multiples of this
WALL_1 = 0.9;             // 2 lines, the minimum anywhere
WALL_2 = 1.3;             // 3 lines
WALL_3 = 1.8;             // 4 lines
BRIDGE_MAX = 6.0;         // longest flat bridge allowed

// ---------- grid ----------
PITCH = 8.0;              // horizontal grid
PLATE = 3.2;              // plate height
BRICK = 9.6;              // 3 plates
GAP   = 0.1;              // per side; outer size = n*8 - 0.2

// ---------- connector 1: stud + crush-rib socket ----------
STUD_D        = 5.0;
STUD_H        = 1.6;
STUD_CHAMFER  = 0.4;      // lead-in on top of stud
STUD_FILLET   = 0.4;      // root fillet against layer-line breakage
SOCKET_D      = 5.4;      // bore: 0.2 mm clearance per side before ribs
SOCKET_DEPTH  = 1.8;      // leaves a 1.4 mm roof in a 3.2 mm plate
SOCKET_CHAMF  = 0.4;      // entry chamfer (also hides elephant's foot)
RIB_R         = 0.5;      // rib = vertical half-cylinder
RIB_N         = 4;
RIB_D         = 4.75;     // [fit] diameter across rib tips (4.8 / 4.7 tested good)
ROOF          = PLATE - SOCKET_DEPTH;   // 1.4 mm of material above a socket in a plate

// ---------- connector 2: slot + flat clip ----------
CLIP_T      = 2.0;        // thickness (Z when printed flat)
CLIP_W      = 5.0;        // body width
CLIP_HALF   = 3.4;        // engagement depth per side (clip length 6.8)
CLIP_ARM    = 0.9;        // spring arm width (2 lines)
CLIP_BAND   = 0.8;        // solid centre band
BARB        = 0.3;        // barb height above body width, per side
BARB_LEAD   = 0.15;       // chamfer at arm tip
CLIP_ROOT_R = 0.3;        // fillet radius at the arm roots
SLOT_CLEAR  = 0.15;       // [fit] clearance per side in the thickness direction
SLOT_INTERF = 0.10;       // [fit] barb interference per side
SLOT_T      = CLIP_T + 2*SLOT_CLEAR;   // 2.3
SLOT_DEPTH  = CLIP_HALF + 0.2;         // 3.6
SLOT_CHAMF  = 0.4;        // entry chamfer of top-face slots
SIDE_SLOT_MIN_H = 2*PLATE;             // parts lower than 6.4 get no side slots
function slot_len(interf = SLOT_INTERF) = CLIP_W + 2*(BARB - interf);   // 5.4

// ---------- axles ----------
AXLE_D       = 3.0;       // steel rod / M3 screw
BORE_SPIN_D  = 3.2;       // [fit] free-running teardrop bore (3.3 too wobbly)
BORE_GRIP_D  = 2.8;       // [fit] diameter across rib tips of a grip bore
GRIP_BORE_D  = 3.4;       // base bore under the grip ribs
AXLE_FLAT    = 0.3;       // flat on the bed side of a printed axle

// ---------- part design values (not connector fits) ----------
HINGE_CLEAR    = 0.3;     // gap between interleaved hinge knuckles, radial and axial
WHEEL_CHANNEL  = 1.2;     // depth of the tyre channel in a wheel rim
TIRE_STRETCH   = 0.2;     // tyre inner radius is this much smaller than the channel (TPU)

// ---------- helpers ----------
function cell(i) = PITCH*i + PITCH/2;          // centre of grid cell i
function snap_layer(h) = round(h / LAYER) * LAYER;
