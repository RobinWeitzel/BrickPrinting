// Hinge: two knuckle leaves on a Ø3 pin (steel rod or printed axle, length = width x 8 - 0.2).
include <../parts.scad>

/* [Size] */
// Size of each leaf in studs [length, width]; the hinge axis runs along the width
size = [2, 2]; // [2:1:16]
// Height in plates
plates = 2; // [2:1:6]

/* [Hinge] */
// Which leaf to make
leaf = "pair"; // [pair, a, b, assembled]
// Cells with a side slot in the far end face (attach with clips)
slots_x0 = [];

if (leaf == "pair") hinge_pair(size, plates, slots_x0 = slots_x0);
else if (leaf == "assembled") hinge_pair(size, plates, assembled = true, slots_x0 = slots_x0);
else hinge_leaf(size, plates, leaf, slots_x0 = slots_x0);
