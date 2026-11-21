import { createStore, del, get, set, values } from "idb-keyval";
import { convertLDraw, convertLibraryPart } from "./ldraw";

/**
 * User-uploaded STL parts ("My parts"). Stored in this browser (IndexedDB), shared by all projects.
 * A part spec refers to one with presetId "custom:<id>".
 */
export interface CustomPartMeta {
  id: string; // "custom:xxxx"
  name: string;
  fileName: string;
  triangles: number;
  size: [number, number, number]; // mm
  createdAt: number;
  /** LDraw part number when converted from the LDraw library */
  ldraw?: string;
}

interface StoredCustomPart extends CustomPartMeta {
  stl: ArrayBuffer; // binary STL, moved so its bounding box starts at (0,0,0)
}

const store = createStore("brickprinting-custom", "parts");

export const isCustom = (presetId: string) => presetId.startsWith("custom:");

/** In-memory index of the metadata (kept in sync by the app store). */
export const customIndex = new Map<string, CustomPartMeta>();

export async function listCustomParts(): Promise<CustomPartMeta[]> {
  const all = await values<StoredCustomPart>(store);
  const metas = all.map(({ stl: _stl, ...m }) => m).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  customIndex.clear();
  for (const m of metas) customIndex.set(m.id, m);
  return metas;
}

export async function customStl(id: string): Promise<ArrayBuffer> {
  const p = await get<StoredCustomPart>(id, store);
  if (!p) throw new Error("This custom part is missing from this browser. Upload it again in the library under “My parts”.");
  return p.stl;
}

export async function renameCustomPart(id: string, name: string) {
  const p = await get<StoredCustomPart>(id, store);
  if (!p) return;
  await set(id, { ...p, name }, store);
  customIndex.set(id, { ...customIndex.get(id)!, name });
}

export async function deleteCustomPart(id: string) {
  await del(id, store);
  customIndex.delete(id);
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Parses an STL (binary or ASCII), moves it onto the origin and stores it. */
export async function addCustomPart(file: File, name?: string, id?: string, ldraw?: string): Promise<CustomPartMeta> {
  const buf = await file.arrayBuffer();
  const tris = parseStlTriangles(buf);
  if (!tris.length) throw new Error(`"${file.name}" contains no triangles. Is it an STL file?`);
  return storeTriangles(tris, { name: name ?? file.name.replace(/\.stl$/i, ""), fileName: file.name, id, ldraw });
}

/** Stores triangles (9 numbers each, mm) as a custom part, moved onto the origin. */
export async function storeTriangles(tris: Float32Array, o: { name: string; fileName: string; id?: string; ldraw?: string }): Promise<CustomPartMeta> {
  if (!tris.length) throw new Error(`"${o.fileName}" produced no geometry.`);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (tris[i + k] < min[k]) min[k] = tris[i + k];
      if (tris[i + k] > max[k]) max[k] = tris[i + k];
    }
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) tris[i + k] -= min[k];
  const meta: CustomPartMeta = {
    id: o.id ?? `custom:${uid()}`,
    name: o.name,
    fileName: o.fileName,
    ...(o.ldraw ? { ldraw: o.ldraw } : {}),
    triangles: tris.length / 9,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    createdAt: Date.now(),
  };
  await set(meta.id, { ...meta, stl: toBinaryStl(tris) } satisfies StoredCustomPart, store);
  customIndex.set(meta.id, meta);
  return meta;
}

/** Flat xyz list (9 numbers per triangle). */
function parseStlTriangles(buf: ArrayBuffer): Float32Array {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  // binary if the triangle count matches the file size
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const out = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const off = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(off + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  const nums: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(Number(m[1]), Number(m[2]), Number(m[3]));
  return Float32Array.from(nums.slice(0, nums.length - (nums.length % 9)));
}

function toBinaryStl(tris: Float32Array): ArrayBuffer {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode("BrickPrinting custom part").subarray(0, 80));
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const off = 84 + t * 50;
    // normal (computed by consumers; leave zero)
    for (let k = 0; k < 9; k++) dv.setFloat32(off + 12 + k * 4, tris[t * 9 + k], true);
  }
  return buf;
}

// ---- backup helpers ----
export async function exportCustomParts(ids: string[]) {
  const out: { id: string; name: string; fileName: string; stl: string; ldraw?: string }[] = [];
  for (const id of ids) {
    const p = await get<StoredCustomPart>(id, store);
    if (!p) continue;
    const bytes = new Uint8Array(p.stl);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ id, name: p.name, fileName: p.fileName, stl: btoa(bin), ldraw: p.ldraw });
  }
  return out;
}

export async function importCustomParts(parts: { id: string; name: string; fileName: string; stl: string; ldraw?: string }[]) {
  for (const p of parts) {
    if (await get(p.id, store)) continue; // already here
    const bin = atob(p.stl);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await addCustomPart(new File([bytes], p.fileName), p.name, p.id, p.ldraw);
  }
}

// ---- LDraw ----

/** Converts uploaded LDraw files (.dat/.ldr). Sub-files uploaded together are used before the library. */
export async function addLDrawFiles(files: File[]): Promise<{ added: CustomPartMeta[]; errors: string[] }> {
  const texts = new Map<string, string>();
  for (const f of files) texts.set(f.name.toLowerCase(), await f.text());
  const added: CustomPartMeta[] = [];
  const errors: string[] = [];
  // only convert files that aren't referenced by other uploaded files (those are sub-files)
  const referenced = new Set<string>();
  for (const t of texts.values()) for (const m of t.matchAll(/^\s*1\s+(?:\S+\s+){13}(.+?)\s*$/gm)) referenced.add(m[1].toLowerCase().replace(/\\/g, "/").split("/").pop()!);
  for (const f of files) {
    const key = f.name.toLowerCase();
    if (referenced.has(key) && files.length > 1) continue;
    try {
      const r = await convertLDraw(texts.get(key)!, texts);
      if (r.missing.length) {
        errors.push(`${f.name}: ${r.missing.length} referenced LDraw file${r.missing.length > 1 ? "s are" : " is"} missing (${r.missing.slice(0, 3).join(", ")}${r.missing.length > 3 ? ", …" : ""}). Import the LDraw library first.`);
        continue;
      }
      const ldraw = f.name.replace(/\.(dat|ldr)$/i, "");
      added.push(await storeTriangles(r.triangles, { name: r.title || ldraw, fileName: f.name, ldraw }));
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message ?? e}`);
    }
  }
  return { added, errors };
}

/** Converts a part from the imported LDraw library (reuses an earlier conversion). */
export async function addLDrawLibraryPart(partNum: string): Promise<CustomPartMeta> {
  const existing = [...customIndex.values()].find((c) => c.ldraw === partNum);
  if (existing) return existing;
  const r = await convertLibraryPart(partNum);
  if (r.missing.length) throw new Error(`LDraw part ${partNum} references missing files: ${r.missing.slice(0, 3).join(", ")}`);
  return storeTriangles(r.triangles, { name: `${r.title} (LDraw ${partNum})`, fileName: r.file, ldraw: partNum });
}
