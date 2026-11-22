#!/usr/bin/env node
/**
 * Builds the web app's part catalog from the OpenSCAD library in scad/.
 *
 * Usage:
 *   node scripts/build-library.mjs            catalog + library files only
 *   node scripts/build-library.mjs --thumbs   also render thumbnails (needs the OpenSCAD CLI and
 *                                             the Python venv, see scad/README.md)
 *
 * Inputs:
 *   scad/config.scad, connectors.scad, parts.scad   the library
 *   scad/families/*.scad                            one Customizer file per part family
 *   scad/library.json                               the base set: presets = family + parameters
 *
 * Outputs:
 *   public/library/fs.json             library + family sources (loaded into the OpenSCAD WASM FS)
 *   public/library/thumbs/<id>.png     preset thumbnails (with --thumbs)
 *   src/data/catalog.json              categories, family parameter schemas, presets
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCAD = path.join(ROOT, "scad");
const OUT_PUBLIC = path.join(ROOT, "public/library");
const OUT_CATALOG = path.join(ROOT, "src/data/catalog.json");

// ---- Customizer parsing ----
function parseValue(raw) {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return undefined; // expressions are not editable
  }
}

function parseAnnotation(ann, value) {
  const m = ann?.match(/^\[(.*)\]$/);
  if (!m) return {};
  const nums = m[1].split(":").map((s) => s.trim());
  // range: [min:step:max] or [min:max]
  if (nums.length >= 2 && nums.length <= 3 && nums.every((n) => n !== "" && !isNaN(Number(n)))) {
    const [min, a, b] = nums.map(Number);
    return nums.length === 3 ? { min, step: a, max: b } : { min, max: a };
  }
  // options: [a, b, c] or [value:Label, ...]
  const options = m[1].split(",").map((s) => {
    const t = s.trim();
    const idx = t.indexOf(":");
    const conv = (x) => (typeof value === "number" ? Number(x) : x);
    return idx > 0 ? { value: conv(t.slice(0, idx)), label: t.slice(idx + 1) } : { value: conv(t), label: t };
  });
  return { options };
}

/** Customizer parameters of a family file: name, section, label (from the comment above), default, range/options. */
function parseFamily(text) {
  const params = [];
  let section = null;
  let comment = null;
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^\/\*\s*\[(.+?)\]\s*\*\//);
    if (sec) {
      section = sec[1];
      comment = null;
      if (section === "Hidden") break;
      continue;
    }
    const c = line.match(/^\s*\/\/\s?(.*)$/);
    if (c) {
      comment = c[1].trim();
      continue;
    }
    const a = line.match(/^(\w+)\s*=\s*(.+?);\s*(?:\/\/\s*(.*))?$/);
    if (a && section) {
      const [, name, raw, ann] = a;
      const value = parseValue(raw);
      if (value !== undefined) params.push({ name, section, label: comment || name, value, ...parseAnnotation(ann?.trim(), value) });
      comment = null;
      continue;
    }
    if (line.trim() === "") comment = null;
  }
  return params;
}

// ---- library files for the OpenSCAD virtual filesystem ----
const files = {};
for (const f of ["config.scad", "connectors.scad", "parts.scad"]) files[f] = fs.readFileSync(path.join(SCAD, f), "utf8");
const families = {};
for (const f of fs.readdirSync(path.join(SCAD, "families")).filter((f) => f.endsWith(".scad")).sort()) {
  const text = fs.readFileSync(path.join(SCAD, "families", f), "utf8");
  files[`families/${f}`] = text;
  const params = parseFamily(text);
  families[f.replace(/\.scad$/, "")] = {
    description: text.split("\n")[0].replace(/^\/\/\s*/, ""),
    schema: params.map(({ value, ...rest }) => rest),
    defaults: Object.fromEntries(params.map((p) => [p.name, p.value])),
  };
}
const revision = crypto.createHash("sha1").update(JSON.stringify(files)).digest("hex").slice(0, 10);

// ---- presets ----
const lib = JSON.parse(fs.readFileSync(path.join(SCAD, "library.json"), "utf8"));
const parts = lib.presets.map((p) => {
  const fam = families[p.family];
  if (!fam) throw new Error(`${p.id}: unknown family ${p.family}`);
  for (const k of Object.keys(p.params)) if (!(k in fam.defaults)) throw new Error(`${p.id}: ${p.family} has no parameter ${k}`);
  return { id: p.id, category: p.category, name: p.name, family: p.family, defaults: { ...fam.defaults, ...p.params } };
});

fs.mkdirSync(OUT_PUBLIC, { recursive: true });
fs.writeFileSync(path.join(OUT_PUBLIC, "fs.json"), JSON.stringify(files));
fs.writeFileSync(OUT_CATALOG, JSON.stringify({ revision, categories: lib.categories, families, parts }, null, 1));
console.log(`Catalog: ${parts.length} presets, ${Object.keys(families).length} families, revision ${revision}.`);

if (process.argv.includes("--thumbs")) {
  const py = path.join(ROOT, ".venv/bin/python");
  execFileSync(py, [path.join(SCAD, "tools/build.py"), "--skip-coupon", "--thumbs", path.join(OUT_PUBLIC, "thumbs")], { stdio: "inherit" });
}
