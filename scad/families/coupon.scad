// Calibration coupon: one fit value in 5 steps (centre +- 2 steps).
// Copy the winning value into config.scad (or the app's fit settings).
include <../parts.scad>

/* [Coupon] */
// Fit value to test
param = "rib_d"; // [rib_d, slot_interf, slot_clear, bore_spin, bore_grip]
// Middle value (-1 = current setting)
center = -1; // [-1:0.01:10]
// Step between the 5 samples
step = 0.05; // [0.01:0.01:0.5]
// Labels: values (needs a font), 1-5 dots, or none
labels = "dots"; // [text, dots, none]

coupon(param, center, step, labels);
