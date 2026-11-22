// TPU tyre for a wheel with tread = "tire" (same d and w).
include <../parts.scad>

/* [Tyre] */
// Rim diameter of the wheel (mm)
d = 16; // [10:0.2:80]
// Wheel width (mm)
w = 6.4; // [3.2:0.2:30]
// Tread thickness (mm)
t = 1.6; // [0.8:0.2:6]

tire(d = d, w = w, t = t);
