import catalogJson from "../data/catalog.json";
import type { ParamValue, ParamValues, PartSpec } from "./types";

/**
 * The part catalog, generated from the OpenSCAD library in scad/ by scripts/build-library.mjs.
 * A part family is one parametric generator (scad/families/<family>.scad); a preset is a named
 * parameter set of a family (the base set, scad/library.json). A part spec is a preset plus overrides.
 */

export interface ParamSchema {
  name: string;
  section: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
}

export interface Family {
  description: string;
  schema: ParamSchema[];
  /** defaults of the family file itself (what OpenSCAD uses without -D) */
  defaults: ParamValues;
}

export interface CatalogPart {
  id: string;
  category: string;
  name: string;
  family: string;
  /** full parameter set of this preset */
  defaults: ParamValues;
}

interface CatalogData {
  revision: string;
  categories: { id: string; name: string }[];
  families: Record<string, Family>;
  parts: CatalogPart[];
}

export const catalog = catalogJson as unknown as CatalogData;
export const partsById = new Map(catalog.parts.map((p) => [p.id, p]));
export const categoryName = (id: string) => catalog.categories.find((c) => c.id === id)?.name ?? id;

export const base = import.meta.env.BASE_URL;
export const thumbUrl = (p: CatalogPart) => `${base}library/thumbs/${p.id}.png`;

export function familyOf(p: CatalogPart): Family {
  return catalog.families[p.family];
}

export function schemaOf(p: CatalogPart): ParamSchema[] {
  return familyOf(p)?.schema ?? [];
}

export function effectiveParams(spec: PartSpec): ParamValues {
  const p = partsById.get(spec.presetId);
  return { ...(p?.defaults ?? {}), ...spec.overrides };
}

/** Stable key for a part spec (used for caching and grouping). */
export function specKey(spec: PartSpec): string {
  const p = partsById.get(spec.presetId);
  const keys = Object.keys(spec.overrides).sort();
  const ov: ParamValues = {};
  for (const k of keys) {
    if (p && JSON.stringify(p.defaults[k]) === JSON.stringify(spec.overrides[k])) continue;
    ov[k] = spec.overrides[k];
  }
  const cuts = spec.cutouts?.length ? `|cut${JSON.stringify(spec.cutouts.map((c) => [c.x, c.y, c.w, c.d]))}` : "";
  return `${catalog.revision}|${spec.presetId}|${JSON.stringify(ov)}${cuts}`;
}

function fmtSize(v: ParamValues) {
  const s = v.size;
  if (!Array.isArray(s)) return "";
  const [x, y] = s as number[];
  const plates = Number(v.plates);
  const h = !plates || plates === 1 || plates === 3 ? "" : ` × ${plates} plates`;
  return `${Math.min(x, y)}x${Math.max(x, y)}${h}`;
}

/** Human readable name of a spec, including size changes. */
export function specName(spec: PartSpec): string {
  const p = partsById.get(spec.presetId);
  if (!p) return `Missing part (${spec.presetId})`;
  const changed = Object.keys(spec.overrides).filter((k) => JSON.stringify(spec.overrides[k]) !== JSON.stringify(p.defaults[k]));
  if (spec.cutouts?.length) return `${p.name} (custom)`;
  if (changed.length === 0) return p.name;
  if (changed.every((k) => k === "size" || k === "plates")) {
    // "Brick 1x2" resized to 1x6 -> "Brick 1x6"
    const renamed = p.name.replace(/\d+x\d+(x\d+)?/, fmtSize({ ...p.defaults, ...spec.overrides }));
    if (renamed !== p.name) return renamed;
  }
  return `${p.name} (custom)`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function searchParts(query: string, category?: string): CatalogPart[] {
  const q = norm(query.replace(/(\d+)\s*x\s*(\d+)/gi, "$1x$2"));
  const words = q.split(" ").filter(Boolean);
  return catalog.parts.filter((p) => {
    if (category && p.category !== category) return false;
    if (!words.length) return true;
    const hay = norm(`${p.name} ${categoryName(p.category)} ${p.family}`);
    return words.every((w) => {
      const dims = w.match(/^(\d+)x(\d+)$/);
      const size = p.defaults.size as number[] | undefined;
      if (dims && Array.isArray(size)) {
        const [a, b] = [Number(dims[1]), Number(dims[2])];
        return (size[0] === a && size[1] === b) || (size[0] === b && size[1] === a);
      }
      return hay.includes(w);
    });
  });
}

// ---------------------------------------------------------------------------
// LEGO name -> part
// ---------------------------------------------------------------------------

export interface Suggestion {
  part: CatalogPart;
  score: number;
  /** the preset, possibly with overrides (e.g. resized) */
  spec: PartSpec;
}

/** Families whose size and height can be changed freely to match any LEGO size. */
const RESIZABLE = new Set(["block", "slope", "wedge", "arch", "axle_brick", "hinge"]);

/** Height of a LEGO part in plates from its name: "1 x 2 x 2" -> 6, "x 2/3" -> 2, "x 1 1/3" -> 4. */
function legoHeightPlates(h: string | undefined): number | undefined {
  if (!h) return undefined;
  const m = h.trim().match(/^(\d+)?(?:\s*(\d)\/(\d))?$/);
  if (!m) return undefined;
  const bricks = Number(m[1] ?? 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  return bricks ? Math.round(bricks * 3) : undefined;
}

/**
 * Suggest parts for a Rebrickable/LEGO part name like "Plate 2 x 6", "Slope 45° 2 x 1" or
 * "Brick 1 x 2 x 2". The best suggestion is a preset, resized when the family allows it.
 */
export function suggestForLegoName(legoName: string): Suggestion[] {
  const name = legoName.toLowerCase();
  const dimM = name.match(/(\d+)\s*x\s*(\d+)(?:\s*x\s*(\d\/\d|\d+(?:\s+\d\/\d)?))?/);
  // wheels and tyres: "Wheel 11mm D. x 6mm", "Tire 14mm D. x 4mm"
  const mmM = name.match(/(\d+(?:\.\d+)?)\s*mm\s*d\.?(?:\s*x\s*(\d+(?:\.\d+)?)\s*mm)?/);
  const dims = dimM ? [Number(dimM[1]), Number(dimM[2])] : undefined;
  const heightPlates = legoHeightPlates(dimM?.[3]);

  // which categories fit this LEGO part
  let cats: string[] = [];
  if (/\btire\b|\btyre\b/.test(name)) cats = ["wheels"];
  else if (/\bwheel\b|\bhub\b/.test(name)) cats = ["wheels"];
  else if (/\baxle\b/.test(name) && !/brick|plate/.test(name)) cats = ["wheels"];
  else if (/hinge/.test(name)) cats = ["hinges"];
  else if (/slope|roof/.test(name)) cats = ["slopes"];
  else if (/wedge/.test(name)) cats = ["wedges", "slopes"];
  else if (/round|cylinder|dish/.test(name)) cats = ["round"];
  else if (/arch/.test(name)) cats = ["arches"];
  else if (/corner|\bcross\b|\bt\b/.test(name) && /(plate|brick|tile)/.test(name)) cats = ["corner"];
  else if (/technic/.test(name) && /(brick|plate)/.test(name) && /hole|axle/.test(name)) cats = ["wheels"];
  else if (/(with|w\/).*(clip|bar|handle|stud on side|studs on side|side)/.test(name)) cats = ["slotted"];
  else if (/tile/.test(name)) cats = ["tiles"];
  else if (/plate/.test(name)) cats = ["plates"];
  else if (/brick/.test(name)) cats = ["bricks"];
  if (!cats.length) return [];

  const angle = name.match(/(\d+)\s*°/)?.[1];
  const side = /\bleft\b/.test(name) ? "left" : /\bright\b/.test(name) ? "right" : undefined;
  const inverted = /inverted/.test(name);
  const special = /(with|modified|special)/.test(name);

  const out: Suggestion[] = [];
  for (const p of catalog.parts) {
    if (!cats.includes(p.category)) continue;
    const pn = p.name.toLowerCase();
    const d = p.defaults;
    let score = 12 - cats.indexOf(p.category) * 3;
    if (special) score -= 6; // "Plate 1 x 2 with Clip": only an approximation, never auto-matched
    if (/tile/.test(name) !== /tile/.test(pn) && p.category !== "tiles") score -= 2;
    if (/plate/.test(name) && /brick/.test(pn)) score -= 2;
    if (/brick/.test(name) && /\bplate\b/.test(pn) && p.category !== "plates") score -= 2;
    if (angle) score += pn.includes(`${angle}°`) ? 4 : -5;
    if (inverted !== /inverted/.test(pn)) score -= 4;
    if (side) score += pn.includes(side) ? 3 : -5;
    if (p.category === "wheels") {
      const want = /tire|tyre/.test(name) ? "tyre" : /wheel|hub/.test(name) ? "wheel" : /brick|plate/.test(name) ? "axle brick" : /axle/.test(name) ? "printed axle" : "axle brick";
      score += pn.startsWith(want) ? 4 : -4;
    }

    let spec: PartSpec = { presetId: p.id, overrides: {} };
    const size = d.size as number[] | undefined;
    if (dims && Array.isArray(size)) {
      const [a, b] = dims;
      const exact = (size[0] === a && size[1] === b) || (size[0] === b && size[1] === a);
      const wantPlates = p.category === "slotted" ? undefined : heightPlates ?? (p.family === "block" ? (/plate|tile/.test(name) ? 1 : /brick/.test(name) ? 3 : undefined) : undefined);
      const platesOk = wantPlates === undefined || d.plates === undefined || d.plates === wantPlates;
      // LEGO slopes/wedges name the length along the slope first: "Slope 45° 2 x 1"
      const ordered = p.family === "slope" || p.family === "wedge";
      if (exact) score += platesOk ? 11 : 9;
      if (RESIZABLE.has(p.family) && (!exact || !platesOk)) {
        const ov: ParamValues = {};
        if (!exact) ov.size = ordered ? [a, b] : [Math.max(a, b), Math.min(a, b)];
        if (!platesOk && wantPlates !== undefined) ov.plates = wantPlates;
        spec = { presetId: p.id, overrides: ov };
        // plain bricks/plates/tiles of any size are exact once resized
        if (!exact) score += ["bricks", "plates", "tiles"].includes(p.category) && !special ? 10 : 4;
      } else if (!exact) score -= 6;
    }
    if (mmM && (p.family === "wheel" || p.family === "tire")) {
      const dia = Number(mmM[1]);
      const w = mmM[2] ? Math.max(3.2, Math.round(Number(mmM[2]) / 0.2) * 0.2) : undefined;
      // a LEGO tyre is named by its outer diameter; ours wraps a rim of d = outer - 2 x tread
      const rim = p.family === "tire" ? dia - 2 * Number(d.t ?? 1.6) : dia;
      spec = { presetId: p.id, overrides: { d: Math.round(rim / 0.2) * 0.2, ...(w ? { w: Math.round(w * 10) / 10 } : {}) } };
    }
    out.push({ part: p, score, spec });
  }
  out.sort((a, b) => b.score - a.score);
  // de-duplicate suggestions that end up as the same part
  const seen = new Set<string>();
  return out
    .filter((s) => {
      const k = JSON.stringify({ ...s.part.defaults, ...s.spec.overrides, f: s.part.family });
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

/** Confidence threshold for automatic matching. */
export const AUTO_MATCH_SCORE = 20;

export type { ParamValue };
