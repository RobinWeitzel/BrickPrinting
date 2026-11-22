// Clip sheet: n clips laid out for printing (flat).
include <../parts.scad>

/* [Clips] */
// Number of clips
n = 10; // [1:1:100]
// Clips per row
cols = 5; // [1:1:20]

clip_sheet(n, cols);
