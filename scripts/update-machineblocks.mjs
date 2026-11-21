#!/usr/bin/env node
/**
 * Imports the MachineBlocks library (https://github.com/pks5/machineblocks) into this app.
 *
 * Usage:
 *   node scripts/update-machineblocks.mjs [path-to-machineblocks-checkout]
 *
 * Without a path, the repository is cloned (shallow) into .cache/machineblocks.
 *
 * Outputs:
 *   public/machineblocks/fs.json                   lib/, config/ and pattern/ sources (loaded into the OpenSCAD FS)
 *   public/machineblocks/examples/<cat>/<id>.scad  one preset file per part (fetched on demand)
 *   public/machineblocks/examples/<cat>/<id>.webp  thumbnail per part
 *   public/machineblocks/LICENSE.txt
 *   src/data/catalog.json                          part list + editable parameter schemas
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let src = process.argv[2];
if (!src) {
  src = path.join(ROOT, ".cache/machineblocks");
  if (fs.existsSync(src)) execSync("git pull --ff-only", { cwd: src, stdio: "inherit" });
  else execSync(`git clone --depth 1 https://github.com/pks5/machineblocks "${src}"`, { stdio: "inherit" });
}
src = path.resolve(src);

const OUT_PUBLIC = path.join(ROOT, "public/machineblocks");
const OUT_CATALOG = path.join(ROOT, "src/data/catalog.json");

// Categories that need fonts or are not useful as LEGO replacements are skipped.
const SKIP_CATEGORIES = new Set(["text", "base-plates", "containers"]);
// Customizer sections that are exposed in the part editor.
const HIDDEN_SECTIONS = new Set(["Text", "Style", "Override Config", "Hidden"]);
// Preferred category order in the library.
const CATEGORY_ORDER = ["bricks", "plates", "tiles", "slopes", "wedges", "round", "arches", "brackets", "corner", "panels", "channels", "technic-bricks", "technic-plates", "technic-liftarms"];

// Friendlier category labels than the example collection titles.
const CATEGORY_NAMES = { plates: "Plates", slopes: "Slopes", corner: "Corner, Cross & T Parts", wedges: "Wedge Plates" };

fs.rmSync(OUT_PUBLIC, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_PUBLIC, "examples"), { recursive: true });
fs.mkdirSync(path.dirname(OUT_CATALOG), { recursive: true });

// ---- Library files for the OpenSCAD virtual filesystem ----
const fsFiles = {};
function collect(dir) {
  for (const f of fs.readdirSync(path.join(src, dir))) {
    const rel = path.join(dir, f);
    const abs = path.join(src, rel);
    if (fs.statSync(abs).isDirectory()) collect(rel);
    else if (/\.(scad|svg)$/.test(f)) fsFiles[rel] = fs.readFileSync(abs, "utf8");
  }
}
["lib", "config", "pattern"].forEach(collect);
fs.writeFileSync(path.join(OUT_PUBLIC, "fs.json"), JSON.stringify(fsFiles));
fs.copyFileSync(path.join(src, "LICENSE.txt"), path.join(OUT_PUBLIC, "LICENSE.txt"));

// ---- Customizer parsing ----
function parseValue(raw) {
  raw = raw.trim();
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // expressions etc. are not editable
  }
}

function parseAnnotation(ann, value) {
  if (!ann) return {};
  const m = ann.match(/^\[(.*)\]$/);
  if (!m) return {};
  const body = m[1];
  // Range: [min:step:max] or [min:max] (numbers only)
  const nums = body.split(":").map((s) => s.trim());
  if (nums.length >= 2 && nums.length <= 3 && nums.every((n) => n !== "" && !isNaN(Number(n)))) {
    const [min, a, b] = nums.map(Number);
    return nums.length === 3 ? { min, step: a, max: b } : { min, max: a };
  }
  // Options: [a, b, c] or [value:Label, ...]
  const options = body.split(",").map((s) => {
    const t = s.trim();
    const idx = t.indexOf(":");
    if (idx > 0 && typeof value !== "number") return { value: t.slice(0, idx), label: t.slice(idx + 1) };
    if (idx > 0 && typeof value === "number") return { value: Number(t.slice(0, idx)), label: t.slice(idx + 1) };
    return { value: typeof value === "number" ? Number(t) : t, label: t };
  });
  return { options };
}

function parseScad(text) {
  const lines = text.split(/\r?\n/);
  const params = [];
  let section = null;
  let comment = null;
  for (const line of lines) {
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
      const [, name, rawValue, ann] = a;
      const value = parseValue(rawValue);
      if (value !== undefined && !HIDDEN_SECTIONS.has(section)) {
        params.push({ name, section, label: comment || name, value, ...parseAnnotation(ann?.trim(), value) });
      }
      comment = null;
      continue;
    }
    if (line.trim() === "") comment = null;
  }
  return params;
}

// ---- Catalog ----
const categories = [];
const parts = [];
const schemas = {};

const exDir = path.join(src, "examples");
const catDirs = fs
  .readdirSync(exDir)
  .filter((d) => fs.statSync(path.join(exDir, d)).isDirectory() && !SKIP_CATEGORIES.has(d))
  .sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

for (const cat of catDirs) {
  const dir = path.join(exDir, cat);
  const jsonFile = fs.readdirSync(dir).find((f) => f.endsWith(".json"));
  const meta = jsonFile ? JSON.parse(fs.readFileSync(path.join(dir, jsonFile), "utf8")) : { name: cat };
  // Map display names from the json (keyed by slug) for nicer titles.
  const presetByName = new Map();
  for (const ex of meta.examples || []) for (const b of ex.bricks || []) presetByName.set(b.name.toLowerCase(), b);

  categories.push({ id: cat, name: CATEGORY_NAMES[cat] || meta.name || cat });
  fs.mkdirSync(path.join(OUT_PUBLIC, "examples", cat), { recursive: true });

  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".scad")).sort()) {
    const id = f.replace(/\.scad$/, "");
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    // Header comment line 5: " * <Name>"
    const header = text.split("\n").slice(0, 8).map((l) => l.replace(/^\s*\*\s?/, "").trim());
    const name = header.find((l, i) => i > 1 && l && !l.startsWith("http") && !l.startsWith("MachineBlocks") && !l.startsWith("/")) || id;
    const params = parseScad(text);
    const schema = params.map(({ value, ...rest }) => rest);
    const hash = crypto.createHash("sha1").update(JSON.stringify(schema)).digest("hex").slice(0, 8);
    schemas[hash] = schema;
    const defaults = Object.fromEntries(params.map((p) => [p.name, p.value]));
    const size = Array.isArray(defaults.size) ? defaults.size : undefined;

    fs.writeFileSync(path.join(OUT_PUBLIC, "examples", cat, f), text);
    const webp = path.join(dir, id + ".webp");
    const hasThumb = fs.existsSync(webp);
    if (hasThumb) fs.copyFileSync(webp, path.join(OUT_PUBLIC, "examples", cat, id + ".webp"));

    parts.push({
      id: `${cat}/${id}`,
      category: cat,
      name,
      size,
      thumb: hasThumb,
      schema: hash,
      defaults,
      preset: presetByName.get(name.toLowerCase())?.parameters,
    });
  }
}

let rev = "unknown";
try {
  rev = execSync("git rev-parse --short HEAD", { cwd: src }).toString().trim();
} catch {}

fs.writeFileSync(OUT_CATALOG, JSON.stringify({ source: "https://github.com/pks5/machineblocks", revision: rev, categories, schemas, parts }));
console.log(`Catalog: ${parts.length} parts in ${categories.length} categories, ${Object.keys(schemas).length} schemas, ${Object.keys(fsFiles).length} library files (rev ${rev}).`);
