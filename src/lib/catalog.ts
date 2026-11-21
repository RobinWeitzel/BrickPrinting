import catalogJson from "../data/catalog.json";
import { customIndex, isCustom } from "./custom";
import type { ParamValue, ParamValues, PartSpec } from "./types";

export interface ParamSchema {
  name: string;
  section: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
}

export interface CatalogPart {
  id: string;
  category: string;
  name: string;
  size?: number[];
  thumb: boolean;
  schema: string;
  defaults: ParamValues;
  preset?: ParamValues;
}

interface CatalogData {
  source: string;
  revision: string;
  categories: { id: string; name: string }[];
  schemas: Record<string, ParamSchema[]>;
  parts: CatalogPart[];
}

export const catalog = catalogJson as unknown as CatalogData;
// natural order within each category: "Brick 1x1, Brick 2x1, … Brick 12x1" instead of "Brick 12x1, Brick 1x1"
{
  const catIdx = new Map(catalog.categories.map((c, i) => [c.id, i]));
  catalog.parts.sort((a, b) => catIdx.get(a.category)! - catIdx.get(b.category)! || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
export const partsById = new Map(catalog.parts.map((p) => [p.id, p]));
export const categoryName = (id: string) => catalog.categories.find((c) => c.id === id)?.name ?? id;

export const base = import.meta.env.BASE_URL;
export const thumbUrl = (p: CatalogPart) => (p.thumb ? `${base}machineblocks/examples/${p.id}.webp` : undefined);
export const scadUrl = (presetId: string) => `${base}machineblocks/examples/${presetId}.scad`;

export function schemaOf(p: CatalogPart): ParamSchema[] {
  return catalog.schemas[p.schema] ?? [];
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

function fmtSize(size: ParamValue | undefined) {
  if (!Array.isArray(size)) return "";
  const [x, y, z] = size as number[];
  const h = z === 1 ? "" : z === 3 ? "" : ` h${z}`;
  return `${x}x${y}${h}`;
}

/** Human readable name of a spec, including size changes. */
export function specName(spec: PartSpec): string {
  if (isCustom(spec.presetId)) {
    const name = customIndex.get(spec.presetId)?.name ?? "Missing custom part";
    return spec.cutouts?.length ? `${name} (custom)` : name;
  }
  const p = partsById.get(spec.presetId);
  if (!p) return spec.presetId;
  const changed = Object.keys(spec.overrides).filter((k) => JSON.stringify(spec.overrides[k]) !== JSON.stringify(p.defaults[k]));
  if (spec.cutouts?.length) return `${p.name} (custom)`;
  if (changed.length === 0) return p.name;
  if (changed.length === 1 && changed[0] === "size") return `${p.name} → ${fmtSize(spec.overrides.size)}`;
  return `${p.name} (custom)`;
}

// ---------------------------------------------------------------------------
// Search & LEGO name matching
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function searchParts(query: string, category?: string): CatalogPart[] {
  const q = norm(query.replace(/(\d+)\s*x\s*(\d+)/gi, "$1x$2"));
  const words = q.split(" ").filter(Boolean);
  return catalog.parts.filter((p) => {
    if (category && p.category !== category) return false;
    if (!words.length) return true;
    const hay = norm(`${p.name} ${categoryName(p.category)}`);
    return words.every((w) => {
      const dims = w.match(/^(\d+)x(\d+)$/);
      if (dims && p.size) {
        const [a, b] = [Number(dims[1]), Number(dims[2])];
        return (p.size[0] === a && p.size[1] === b) || (p.size[0] === b && p.size[1] === a);
      }
      return hay.includes(w);
    });
  });
}

export interface Suggestion {
  part: CatalogPart;
  score: number;
  /** size override needed when the preset is the right type but different dimension order */
  spec: PartSpec;
}

/** Suggest MachineBlocks parts for a Rebrickable/LEGO part name like "Plate 2 x 6" or "Slope 45° 2 x 1". */
export function suggestForLegoName(legoName: string): Suggestion[] {
  const name = legoName.toLowerCase();
  const dimM = name.match(/(\d+)\s*x\s*(\d+)(?:\s*x\s*(\d+(?:\s*\d\/\d)?))?/);
  const dims = dimM ? [Number(dimM[1]), Number(dimM[2])] : undefined;
  const heightBricks = dimM?.[3] ? parseFloat(dimM[3]) : undefined;

  let cats: string[] = [];
  let kind = "";
  if (/corner|\bcross\b/.test(name) && /(plate|brick|tile)/.test(name) && !/round|wedge|cut/.test(name)) (cats = ["corner"]), (kind = /tile/.test(name) ? "tile" : /plate/.test(name) ? "plate" : "brick");
  else if (/wedge/.test(name) && /plate/.test(name)) (cats = ["wedges"]), (kind = "wedge plate");
  else if (/wedge/.test(name)) (cats = ["wedges", "slopes"]), (kind = "wedge");
  else if (/slope/.test(name)) (cats = ["slopes"]), (kind = "slope");
  else if (/technic/.test(name) && /brick/.test(name)) (cats = ["technic-bricks"]), (kind = "technic brick");
  else if (/technic/.test(name) && /plate/.test(name)) (cats = ["technic-plates"]), (kind = "technic plate");
  else if (/technic/.test(name) && /(beam|liftarm)/.test(name)) (cats = ["technic-liftarms"]), (kind = "liftarm");
  else if (/round|dish|cylinder/.test(name)) (cats = ["round"]), (kind = "round");
  else if (/arch/.test(name)) (cats = ["arches"]), (kind = "arch");
  else if (/bracket/.test(name)) (cats = ["brackets"]), (kind = "bracket");
  else if (/panel/.test(name)) (cats = ["panels"]), (kind = "panel");
  else if (/tile/.test(name)) (cats = ["tiles"]), (kind = "tile");
  else if (/plate/.test(name)) (cats = ["plates"]), (kind = "plate");
  else if (/brick/.test(name)) (cats = ["bricks"]), (kind = "brick");

  const slopeAngle = name.match(/(\d+)\s*°/)?.[1];
  const side = /\bleft\b/.test(name) ? "left" : /\bright\b/.test(name) ? "right" : undefined;
  const isSpecial = /(with|special|modified|hinge|clip|bar|pin|hole|groove|stud|inverted|curved|corner|cross)/.test(name);
  // a concrete feature word the matching preset should also mention
  const specialWord = name.match(/(hinge|clip|bar|pin|hole|inverted|curved|corner|cross|dome)/)?.[1];

  const out: Suggestion[] = [];
  for (const p of catalog.parts) {
    if (cats.length && !cats.includes(p.category)) continue;
    if (!cats.length) continue;
    const pn = p.name.toLowerCase();
    let score = 10 - cats.indexOf(p.category) * 3;
    if (kind && pn.includes(kind.split(" ").pop()!)) score += 3;
    if (p.category === "corner" && /corner/.test(name) !== /corner/.test(pn)) score -= 4;
    if (kind === "plate" && pn.startsWith("centered")) score -= 4;
    if (kind === "round" && /plate/.test(name) !== /plate/.test(pn)) score -= 3;
    if (kind === "round" && /tile/.test(name) !== /tile/.test(pn)) score -= 2;
    if (slopeAngle) score += pn.includes(` ${slopeAngle} `) || pn.includes(` ${slopeAngle}°`) ? 4 : -2;
    if (/inverted/.test(name) === /inverted/.test(pn)) score += 1;
    else score -= 3;
    if (side) score += pn.includes(side) ? 3 : -5;
    if (!isSpecial && /with|open|corner|rounded/.test(pn)) score -= 2;
    // a special LEGO part ("... with Door Rail") is never an obvious match for a plain preset
    if (specialWord && !pn.includes(specialWord)) score -= 3;
    else if (!specialWord && /special|modified/.test(name)) score -= 3;
    if (/round corner/.test(name) && /qtr|quarter/.test(pn)) score += 6;
    // penalize features of the MachineBlocks part the LEGO part doesn't mention
    for (const w of ["jumper", "axle", "hole", "pin", "open", "double", "rounded", "grille", "studs"]) if (pn.includes(w) && !name.includes(w)) score -= 2;

    let spec: PartSpec = { presetId: p.id, overrides: {} };
    if (dims && p.size) {
      const [a, b] = dims;
      const [x, y, z] = p.size;
      const exact = (x === a && y === b) || (x === b && y === a);
      if (exact) score += 8;
      else if (["bricks", "plates", "tiles"].includes(p.category) && !isSpecial) {
        // same family but other size: offer resized preset
        score += 1;
        spec = { presetId: p.id, overrides: { size: [Math.max(a, b), Math.min(a, b), z] } };
      } else score -= 6;
      if (heightBricks && p.category === "bricks") {
        const wantZ = Math.round(heightBricks * 3);
        if (z === wantZ) score += 3;
        else if (exact) {
          spec = { presetId: p.id, overrides: { size: [x, y, wantZ] } };
        }
      } else if (!heightBricks && p.category === "bricks" && z !== 3) score -= 3;
    }
    out.push({ part: p, score, spec });
  }
  out.sort((a, b) => b.score - a.score);
  // de-duplicate resized suggestions of the same family
  const seen = new Set<string>();
  return out
    .filter((s) => {
      const k = specKey(s.spec);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

/** Confidence threshold for automatic matching. */
export const AUTO_MATCH_SCORE = 20;
