// Axle brick: horizontal bores across the width for a Ø3 steel axle / M3 screw.
include <../parts.scad>

/* [Size] */
// Size in studs [length, width]
size = [2, 2]; // [1:1:16]
// Height in plates (3 needed for a bore above the sockets)
plates = 3; // [3:1:36]

/* [Axle] */
// Bore positions along the length, in studs (0.5 = middle of first cell, 1 = between cells)
axle_x = [1];
// grip = axle clamped (wheels spin on it), spin = axle turns in the brick
bore = "grip"; // [grip, spin]
// Hollow the cells away from the bores
hollow = false;

axle_brick(size = size, plates = plates, axle_x = axle_x, bore = bore, hollow = hollow);
