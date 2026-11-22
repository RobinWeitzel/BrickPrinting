// Wheel hub, printed flat. Spins on a Ø3 axle; keep it on with a grip collar.
include <../parts.scad>

/* [Wheel] */
// Rim diameter (mm)
d = 16; // [10:0.2:80]
// Width (mm)
w = 6.4; // [3.2:0.2:30]
// Tread: none, printed grooves, or a channel for the TPU tyre
tread = "grooves"; // [none, grooves, tire]
// Lightening holes (when there is room)
holes = true;
// Spacer ring height on the inner face (mm)
boss = 0.6; // [0:0.2:2]

wheel(d = d, w = w, tread = tread, holes = holes, boss = boss);
