import { createStore, get, set } from "idb-keyval";

/**
 * Bambu Lab filament colors, loaded at runtime from the Bambu Studio repository
 * (not bundled with this app) and cached in the browser for offline use.
 */
export const BAMBU_COLORS_URL = "https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/filament/filaments_color_codes.json";
export const BAMBU_COLORS_SOURCE = "https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/filaments_color_codes.json";

export interface BambuColor {
  code: string; // e.g. "10101"
  material: string; // e.g. "PLA Basic"
  name: string; // e.g. "Black"
  hex: string; // "#RRGGBB" (first color for gradients / multi-color spools)
  hexes: string[];
}

const store = createStore("brickprinting-bambu", "data");
/** Display color for fully transparent filaments. */
export const CLEAR_HEX = "#E6ECEF";
const CACHE_KEY = "colors-v2"; // v2: transparent colors mapped to CLEAR_HEX
const MAX_AGE = 7 * 24 * 3600 * 1000;

interface Raw {
  data: { fila_color_code: string; fila_type: string; fila_color_name: Record<string, string>; fila_color: string[] }[];
}

function parse(raw: Raw): BambuColor[] {
  return raw.data
    .filter((d) => d.fila_color?.length)
    .map((d) => {
      // "#RRGGBBAA": fully transparent spools ("Clear", "Transparent") are listed as #00000000 -> show a clear tint
      const hexes = d.fila_color.map((c) => (/^#[0-9a-f]{6}00$/i.test(c) ? CLEAR_HEX : c.slice(0, 7).toUpperCase()));
      return { code: d.fila_color_code, material: d.fila_type, name: d.fila_color_name.en ?? Object.values(d.fila_color_name)[0] ?? d.fila_color_code, hex: hexes[0], hexes };
    });
}

let pending: Promise<BambuColor[]> | null = null;

export function loadBambuColors(): Promise<BambuColor[]> {
  pending ??= (async () => {
    const cached = await get<{ at: number; colors: BambuColor[] }>(CACHE_KEY, store).catch(() => undefined);
    if (cached && Date.now() - cached.at < MAX_AGE) return cached.colors;
    try {
      const r = await fetch(BAMBU_COLORS_URL);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const colors = parse(await r.json());
      set(CACHE_KEY, { at: Date.now(), colors }, store).catch(() => {});
      return colors;
    } catch (e) {
      if (cached) return cached.colors; // stale is better than nothing
      throw new Error(`Could not load Bambu Lab colors (${(e as Error).message}).`);
    }
  })();
  pending.catch(() => (pending = null));
  return pending;
}

/** Display name stored in the filament list. */
export const bambuFilamentName = (c: BambuColor) => `${c.material} ${c.name}`;

/** Materials in a sensible order: common ones first, then by number of colors. */
export function materialsOf(colors: BambuColor[]): string[] {
  const preferred = ["PLA Basic", "PLA Matte", "PETG HF", "PLA Basic Gradient", "PLA Silk", "PLA Silk+", "PETG Basic", "ABS", "ASA", "PLA Tough", "PLA Tough+", "PLA Lite"];
  const count = new Map<string, number>();
  for (const c of colors) count.set(c.material, (count.get(c.material) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => {
    const ia = preferred.indexOf(a), ib = preferred.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || count.get(b)! - count.get(a)! || a.localeCompare(b);
  });
}
