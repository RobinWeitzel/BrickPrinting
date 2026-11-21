/**
 * Set inventories from the Rebrickable CSV downloads (https://rebrickable.com/downloads/).
 *
 * The user downloads the files once and imports them into the browser. They are stored as-is
 * (gzip or plain CSV) in IndexedDB and scanned when a set is looked up. Nothing from Rebrickable
 * is bundled with this app.
 */
import { createStore, get, set } from "idb-keyval";
import type { InventoryPart } from "./types";

export const DOWNLOADS_URL = "https://rebrickable.com/downloads/";

const store = createStore("brickprinting-rebrickable", "files");

/** Files we need, identified by their header row (file names don't matter). */
export const RB_FILES = {
  sets: { file: "sets.csv.gz", header: "set_num,name,year,theme_id,num_parts,img_url" },
  inventories: { file: "inventories.csv.gz", header: "id,version,set_num" },
  inventory_parts: { file: "inventory_parts.csv.gz", header: "inventory_id,part_num,color_id,quantity,is_spare" },
  parts: { file: "parts.csv.gz", header: "part_num,name,part_cat_id" },
  colors: { file: "colors.csv.gz", header: "id,name,rgb,is_trans" },
} as const;
export type RbFileId = keyof typeof RB_FILES;
export const RB_FILE_IDS = Object.keys(RB_FILES) as RbFileId[];

export interface RbFileInfo {
  name: string;
  size: number;
  importedAt: number;
}

interface StoredFile extends RbFileInfo {
  blob: Blob;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function isGzip(blob: Blob) {
  const b = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return b[0] === 0x1f && b[1] === 0x8b;
}

/** Streams the lines of a (possibly gzipped) CSV blob. */
async function* lines(blob: Blob): AsyncGenerator<string> {
  let stream = blob.stream() as ReadableStream<BufferSource>;
  if (await isGzip(blob)) stream = stream.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<BufferSource, BufferSource>);
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, BufferSource>).getReader();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = rest + value;
    const parts = chunk.split("\n");
    rest = parts.pop()!;
    for (const l of parts) yield l.endsWith("\r") ? l.slice(0, -1) : l;
  }
  if (rest) yield rest;
}

async function firstLine(blob: Blob) {
  for await (const l of lines(blob)) return l.replace(/^﻿/, "");
  return "";
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";" || c === "\t") out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// Import / status
// ---------------------------------------------------------------------------

export async function importedFiles(): Promise<Partial<Record<RbFileId, RbFileInfo>>> {
  const out: Partial<Record<RbFileId, RbFileInfo>> = {};
  await Promise.all(
    RB_FILE_IDS.map(async (id) => {
      const f = await get<StoredFile>(id, store);
      if (f) out[id] = { name: f.name, size: f.size, importedAt: f.importedAt };
    }),
  );
  return out;
}

/** Imports Rebrickable download files. Returns which file each upload was recognized as. */
export async function importFiles(files: File[]): Promise<{ recognized: { file: string; as: RbFileId }[]; unknown: string[] }> {
  const recognized: { file: string; as: RbFileId }[] = [];
  const unknown: string[] = [];
  for (const file of files) {
    let header = "";
    try {
      header = await firstLine(file);
    } catch {
      /* not a readable csv/gz */
    }
    const id = RB_FILE_IDS.find((k) => header.startsWith(RB_FILES[k].header));
    if (!id) {
      unknown.push(file.name);
      continue;
    }
    await set(id, { blob: file, name: file.name, size: file.size, importedAt: Date.now() } satisfies StoredFile, store);
    recognized.push({ file: file.name, as: id });
  }
  colorCache = null;
  return { recognized, unknown };
}

async function requireFile(id: RbFileId): Promise<Blob> {
  const f = await get<StoredFile>(id, store);
  if (!f) throw new Error(`Missing ${RB_FILES[id].file}. Import it from the Rebrickable downloads page first.`);
  return f.blob;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

let colorCache: Promise<Map<number, { name: string; hex: string }>> | null = null;

export function legoColors(): Promise<Map<number, { name: string; hex: string }>> {
  colorCache ??= (async () => {
    const m = new Map<number, { name: string; hex: string }>();
    const f = await get<StoredFile>("colors", store);
    if (!f) return m;
    let first = true;
    for await (const l of lines(f.blob)) {
      if (first) {
        first = false;
        continue;
      }
      if (!l) continue;
      const c = parseCsvLine(l);
      m.set(Number(c[0]), { name: c[1], hex: "#" + c[2] });
    }
    return m;
  })();
  return colorCache;
}

// ---------------------------------------------------------------------------
// Set lookup
// ---------------------------------------------------------------------------

export function normalizeSetNum(s: string) {
  s = s.trim();
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

const partImg = (partNum: string, colorId: number) => `https://cdn.rebrickable.com/media/parts/ldraw/${colorId}/${partNum}.png`;

export interface SetLookupResult {
  set: { num: string; name: string; imgUrl?: string };
  parts: InventoryPart[];
}

/** Looks up a set's parts list in the imported Rebrickable files. */
export async function lookupSet(setNumRaw: string, onStatus?: (s: string) => void): Promise<SetLookupResult> {
  const setNum = normalizeSetNum(setNumRaw);
  const [setsBlob, invBlob, invPartsBlob, partsBlob] = await Promise.all([requireFile("sets"), requireFile("inventories"), requireFile("inventory_parts"), requireFile("parts")]);

  onStatus?.("Finding set…");
  let setInfo: SetLookupResult["set"] | undefined;
  for await (const l of lines(setsBlob)) {
    if (l.startsWith(setNum + ",")) {
      const c = parseCsvLine(l);
      setInfo = { num: c[0], name: c[1], imgUrl: c[5] || undefined };
      break;
    }
  }
  if (!setInfo) throw new Error(`Set ${setNum} not found in sets.csv.`);

  // newest inventory version of the set
  let invId = "";
  let best = -1;
  for await (const l of lines(invBlob)) {
    if (!l.endsWith("," + setNum)) continue;
    const [id, version] = l.split(",");
    if (Number(version) > best) (best = Number(version)), (invId = id);
  }
  if (!invId) throw new Error(`No inventory for ${setNum} in inventories.csv.`);

  onStatus?.("Reading parts list…");
  const rows: { partNum: string; colorId: number; qty: number; isSpare: boolean; img?: string }[] = [];
  const prefix = invId + ",";
  let seen = false;
  for await (const l of lines(invPartsBlob)) {
    if (l.startsWith(prefix)) {
      seen = true;
      const c = parseCsvLine(l);
      rows.push({ partNum: c[1], colorId: Number(c[2]), qty: Number(c[3]), isSpare: c[4] === "True", img: c[5] || undefined });
    } else if (seen) break; // the file is sorted by inventory id
  }
  if (!rows.length) throw new Error(`The inventory of ${setNum} has no parts (it may consist only of minifigs or sub-sets).`);

  onStatus?.("Looking up part names…");
  const wanted = new Set(rows.map((r) => r.partNum));
  const names = new Map<string, string>();
  for await (const l of lines(partsBlob)) {
    const pn = l.slice(0, l.indexOf(","));
    if (wanted.has(pn)) {
      names.set(pn, parseCsvLine(l)[1]);
      if (names.size === wanted.size) break;
    }
  }

  const colors = await legoColors();
  const parts = rows.map<InventoryPart>((r) => {
    const color = colors.get(r.colorId) ?? { name: `Color ${r.colorId}`, hex: "#999999" };
    return {
      key: `${r.partNum}:${r.colorId}${r.isSpare ? ":spare" : ""}`,
      partNum: r.partNum,
      name: names.get(r.partNum) ?? `Part ${r.partNum}`,
      imgUrl: r.img ?? partImg(r.partNum, r.colorId),
      colorId: r.colorId,
      colorName: color.name,
      colorHex: color.hex,
      qty: r.qty,
      isSpare: r.isSpare,
    };
  });
  return { set: setInfo, parts: mergeDuplicates(parts) };
}

function mergeDuplicates(parts: InventoryPart[]) {
  const m = new Map<string, InventoryPart>();
  for (const p of parts) {
    const e = m.get(p.key);
    if (e) e.qty += p.qty;
    else m.set(p.key, { ...p });
  }
  return [...m.values()];
}

// ---------------------------------------------------------------------------
// Single-set CSV (e.g. a parts list exported from a set page)
// ---------------------------------------------------------------------------

/**
 * Parses a parts list CSV.
 * Recognized columns (case-insensitive): part / part_num, color / color_id, quantity / qty, is_spare / spare, name / description.
 */
export async function parseInventoryCsv(text: string): Promise<InventoryPart[]> {
  const rows = text.replace(/^﻿/, "").trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("CSV has no rows.");
  const head = parseCsvLine(rows[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iPart = col("part", "partnum", "partno", "itemno", "designid", "partid");
  const iColor = col("color", "colorid", "colour", "colourid");
  const iQty = col("quantity", "qty", "count");
  const iSpare = col("isspare", "spare");
  const iName = col("name", "description", "partname");
  if (iPart < 0 || iQty < 0) throw new Error(`CSV needs at least "Part" and "Quantity" columns (found: ${head.join(", ")}).`);

  const colors = await legoColors();
  const byName = new Map([...colors].map(([id, c]) => [c.name.toLowerCase(), id]));
  const parts: InventoryPart[] = [];
  for (const line of rows.slice(1)) {
    const c = parseCsvLine(line);
    const partNum = c[iPart];
    if (!partNum) continue;
    const rawColor = iColor >= 0 ? c[iColor] : "";
    const colorId = /^-?\d+$/.test(rawColor) ? Number(rawColor) : (byName.get(rawColor.toLowerCase()) ?? -1);
    const color = colors.get(colorId) ?? { name: rawColor ? (/^\d+$/.test(rawColor) ? `Color ${rawColor}` : rawColor) : "Unknown", hex: "#999999" };
    const isSpare = iSpare >= 0 && /^(true|1|yes|y)$/i.test(c[iSpare]);
    parts.push({
      key: `${partNum}:${colorId}${isSpare ? ":spare" : ""}`,
      partNum,
      name: (iName >= 0 && c[iName]) || `Part ${partNum}`,
      imgUrl: partImg(partNum, colorId),
      colorId,
      colorName: color.name,
      colorHex: color.hex,
      qty: Number(c[iQty]) || 1,
      isSpare,
    });
  }
  return mergeDuplicates(parts);
}
