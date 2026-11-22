// Arch: opening between the two end cells, 45° flanks and a flat top <= 6 mm.
include <../parts.scad>

/* [Size] */
// Size in studs [length, width]
size = [4, 1]; // [3:1:16]
// Height in plates (wide arches need more)
plates = 3; // [2:1:36]
// Hollow the end cells
hollow = false;

arch(size = size, plates = plates, hollow = hollow);
