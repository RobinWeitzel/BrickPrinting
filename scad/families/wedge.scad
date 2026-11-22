// Wedge plate/brick: angled outline. Studs and sockets only where they fit.
include <../parts.scad>

/* [Size] */
// Size in studs [length, width]
size = [3, 2]; // [1:1:16]
// Height in plates
plates = 1; // [1:1:36]

/* [Wedge] */
// Which side is angled
side = "right"; // [right, left]
// Width left at the far end (studs); 0 = pointed
tip = 0; // [0:1:15]
// Smooth top without studs
tile = false;
// Hollow the cells above their sockets
hollow = false;

wedge(size = size, plates = plates, side = side, tip = tip, tile = tile, hollow = hollow);
