import { specKey, specName } from "./catalog";
import type { Color, ColorRef, InventoryPart, PartSpec, Project, StepItem } from "./types";

export function legoColor(project: Project, colorId: number): Color {
  const inv = project.inventory.find((i) => i.colorId === colorId);
  return inv ? { name: inv.colorName, hex: inv.colorHex } : { name: `Color ${colorId}`, hex: "#999999" };
}

/** Effective print color of a color reference (custom color, or LEGO color via the project color map). */
export function resolveColor(project: Project, ref: ColorRef): Color {
  if ("custom" in ref) return ref.custom;
  return project.colorMap[ref.lego] ?? legoColor(project, ref.lego);
}

export interface ResolvedItem {
  item: StepItem;
  inv?: InventoryPart;
  spec?: PartSpec;
  color: Color;
  title: string;
  subtitle?: string;
}

export function resolveItem(project: Project, item: StepItem): ResolvedItem {
  const inv = item.invKey ? project.inventory.find((i) => i.key === item.invKey) : undefined;
  let spec = item.spec;
  if (!spec && inv) {
    const m = project.matches[inv.partNum];
    if (m?.kind === "mb") spec = m.spec;
  }
  // linked to a part that is no longer in the parts list (e.g. after re-importing): fall back to the part number
  const lostPartNum = item.invKey && !inv ? item.invKey.split(":")[0] : undefined;
  if (!spec && lostPartNum) {
    const m = project.matches[lostPartNum];
    if (m?.kind === "mb") spec = m.spec;
  }
  const color = resolveColor(project, item.color);
  const title = inv ? inv.name : lostPartNum ? `LEGO #${lostPartNum}` : spec ? specName(spec) : "Unknown part";
  const subtitle = inv ? (spec ? `→ ${specName(spec)}` : "→ not matched") : lostPartNum ? "not in the current parts list" : undefined;
  return { item, inv, spec, color, title, subtitle };
}

/** How many of each inventory line were placed in steps. */
export function usageByInvKey(project: Project): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of project.steps) for (const i of s.items) if (i.invKey) m.set(i.invKey, (m.get(i.invKey) ?? 0) + i.qty);
  return m;
}

export interface BomLine {
  key: string;
  spec: PartSpec;
  color: Color;
  qty: number;
  name: string;
  legoParts: string[];
  steps: string[];
}

export interface BomResult {
  lines: BomLine[];
  /** placed items/inventory lines without a printable part */
  unmatched: { title: string; qty: number; color: Color; steps: string[] }[];
}

export interface BomOptions {
  includeUnplacedInventory: boolean;
  includeSpares: boolean;
}

export function buildBom(project: Project, opts: BomOptions): BomResult {
  const lines = new Map<string, BomLine>();
  const unmatched = new Map<string, BomResult["unmatched"][number]>();

  const add = (spec: PartSpec | undefined, color: Color, qty: number, title: string, step: string, lego?: string) => {
    if (qty <= 0) return;
    if (!spec) {
      const k = `${title}|${color.hex}`;
      const u = unmatched.get(k) ?? { title, qty: 0, color, steps: [] };
      u.qty += qty;
      if (!u.steps.includes(step)) u.steps.push(step);
      unmatched.set(k, u);
      return;
    }
    const k = `${specKey(spec)}|${color.hex.toLowerCase()}`;
    const l = lines.get(k) ?? { key: k, spec, color, qty: 0, name: specName(spec), legoParts: [], steps: [] };
    l.qty += qty;
    if (lego && !l.legoParts.includes(lego)) l.legoParts.push(lego);
    if (!l.steps.includes(step)) l.steps.push(step);
    lines.set(k, l);
  };

  for (const s of project.steps) {
    for (const item of s.items) {
      const r = resolveItem(project, item);
      add(r.spec, r.color, item.qty, r.title, s.label, r.inv?.partNum);
    }
  }
  if (opts.includeUnplacedInventory) {
    const used = usageByInvKey(project);
    for (const inv of project.inventory) {
      if (inv.isSpare && !opts.includeSpares) continue;
      const rest = inv.qty - (used.get(inv.key) ?? 0);
      const m = project.matches[inv.partNum];
      add(m?.kind === "mb" ? m.spec : undefined, resolveColor(project, { lego: inv.colorId }), rest, inv.name, inv.isSpare ? "spare" : "unplaced", inv.partNum);
    }
  }
  const sorted = [...lines.values()].sort((a, b) => a.color.name.localeCompare(b.color.name) || a.name.localeCompare(b.name));
  return { lines: sorted, unmatched: [...unmatched.values()] };
}

/**
 * Colors actually saved on parts in this build, most recently saved first.
 * (Colors only tried out in a picker don't count.)
 */
export function savedColors(project: Project, max = 10): ColorRef[] {
  const inUse = new Map<string, ColorRef>();
  for (let i = project.steps.length - 1; i >= 0; i--) for (const it of [...project.steps[i].items].reverse()) inUse.set(JSON.stringify(it.color), it.color);
  const out: ColorRef[] = [];
  const seen = new Set<string>();
  for (const c of [...(project.recentColors ?? []), ...inUse.values()]) {
    const k = JSON.stringify(c);
    if (seen.has(k) || !inUse.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, max);
}
