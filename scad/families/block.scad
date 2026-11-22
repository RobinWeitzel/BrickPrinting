// Block: plates, bricks, tiles, round and corner parts.
// Every parameter is a Customizer parameter; override with -D on the CLI.
include <../parts.scad>

/* [Size] */
// Size in studs [length, width]
size = [2, 4]; // [1:1:32]
// Height in plates (1 = plate, 3 = brick)
plates = 3; // [1:1:36]

/* [Shape] */
// Outline
shape = "rect"; // [rect, round]
// Cell mask for corner/T/cross parts, rows separated by "/" ("XX/X." = L corner). Empty = full rectangle.
mask = "";
// Rounding of the outer corners (mm)
corner_r = 0; // [0:0.1:3.6]

/* [Top and inside] */
// Smooth top without studs
tile = false;
// Hollow the cells above their sockets (bricks only)
hollow = false;

/* [Side slots] */
// Cells with a slot in the left end face
slots_x0 = [];
// Cells with a slot in the right end face
slots_x1 = [];
// Cells with a slot in the front face
slots_y0 = [];
// Cells with a slot in the back face
slots_y1 = [];
// Slot orientation (upright needs a full brick)
slot_orient = "flat"; // [flat, upright]

block(size = size, plates = plates, shape = shape, mask = mask, corner_r = corner_r,
      tile = tile, hollow = hollow,
      slots_x0 = slots_x0, slots_x1 = slots_x1, slots_y0 = slots_y0, slots_y1 = slots_y1,
      slot_orient = slot_orient);
