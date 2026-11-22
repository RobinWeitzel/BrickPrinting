// Slope: falls towards the right end (+X). Inverted = slope on the underside.
include <../parts.scad>

/* [Size] */
// Size in studs [length, width]
size = [2, 1]; // [1:1:16]
// Height in plates
plates = 3; // [1:1:36]

/* [Slope] */
// Number of cells the slope covers (the rest is flat with studs)
run = 1; // [1:1:16]
// Height of the low edge in mm (-1 = as low as the sockets allow)
lip = -1; // [-1:0.2:20]
// Slope on the underside (overhang stays at 45°)
inverted = false;
// Hollow the flat cells
hollow = false;

slope(size = size, plates = plates, run = run, lip = lip, inverted = inverted, hollow = hollow);
