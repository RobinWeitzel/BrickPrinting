/**
 * LDraw parts (https://library.ldraw.org) converted to STL in the browser.
 *
 * The user downloads the official library (complete.zip) once and imports it. The zip is stored
 * as-is in IndexedDB together with an index of its entries; single files are inflated on demand.
 * Nothing from LDraw is bundled with this app (LDraw parts are licensed CC BY 4.0).
 */
import { createStore, del, get, set } from "idb-keyval";

export const LDRAW_DOWNLOAD_URL = "https://library.ldraw.org/library/updates/complete.zip";
export const LDRAW_SITE = "https://library.ldraw.org";

const store = createStore("brickprinting-ldraw", "lib");

interface Entry {
  o: number; // local header offset
  c: number; // compressed size
  m: number; // method: 0 stored, 8 deflate
}
interface LibIndex {
  name: string;
  size: number;
  importedAt: number;
  entries: Record<string, Entry>; // lowercase path without the "ldraw/" prefix, e.g. "parts/3001.dat", "p/stud.dat"
}

export interface LDrawLibInfo {
  name: string;
  size: number;
  importedAt: number;
  parts: number;
}

let indexCache: Promise<LibIndex | undefined> | null = null;
let blobCache: Promise<Blob | undefined> | null = null;
const getIndex = () => (indexCache ??= get<LibIndex>("index", store));
const getBlob = () => (blobCache ??= get<Blob>("zip", store));

export async function ldrawLibInfo(): Promise<LDrawLibInfo | null> {
  const idx = await getIndex();
  if (!idx) return null;
  return { name: idx.name, size: idx.size, importedAt: idx.importedAt, parts: Object.keys(idx.entries).filter((k) => /^parts\/[^/]+\.dat$/.test(k)).length };
}

export async function removeLDrawLib() {
  await Promise.all([del("index", store), del("zip", store)]);
  indexCache = blobCache = null;
  fileCache.clear();
}

// ---------------------------------------------------------------------------
// Zip reading (central directory + on-demand inflate)
// ---------------------------------------------------------------------------

async function readCentralDirectory(blob: Blob): Promise<Record<string, Entry>> {
  const tailSize = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tailSize - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("This is not a zip file.");
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // zip64 end of central directory locator
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(tail.getBigUint64(loc + 8, true));
      const r = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
      count = Number(r.getBigUint64(32, true));
      cdSize = Number(r.getBigUint64(40, true));
      cdOffset = Number(r.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries: Record<string, Entry> = {};
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let csize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (csize === 0xffffffff || offset === 0xffffffff) {
      // zip64 extra field
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.getUint16(e, true), len = cd.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (cd.getUint32(p + 24, true) === 0xffffffff) q += 8; // uncompressed size
          if (csize === 0xffffffff) (csize = Number(cd.getBigUint64(q, true))), (q += 8);
          if (offset === 0xffffffff) offset = Number(cd.getBigUint64(q, true));
        }
        e += 4 + len;
      }
    }
    const key = name.toLowerCase().replace(/\\/g, "/").replace(/^ldraw\//, "");
    if (key.endsWith(".dat") && (method === 0 || method === 8)) entries[key] = { o: offset, c: csize, m: method };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(blob: Blob, e: Entry): Promise<string> {
  const h = new DataView(await blob.slice(e.o, e.o + 30).arrayBuffer());
  const start = e.o + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const data = blob.slice(start, start + e.c);
  if (e.m === 0) return data.text();
  const stream = data.stream().pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Response(stream).text();
}

/** Imports the LDraw library zip (complete.zip). */
export async function importLDrawLib(file: File): Promise<LDrawLibInfo> {
  const entries = await readCentralDirectory(file);
  if (!entries["p/stud.dat"] || !Object.keys(entries).some((k) => k.startsWith("parts/"))) {
    throw new Error("This zip doesn't look like the LDraw parts library (complete.zip from library.ldraw.org).");
  }
  const idx: LibIndex = { name: file.name, size: file.size, importedAt: Date.now(), entries };
  await set("zip", file, store);
  await set("index", idx, store);
  indexCache = Promise.resolve(idx);
  blobCache = Promise.resolve(file);
  fileCache.clear();
  return (await ldrawLibInfo())!;
}

// ---------------------------------------------------------------------------
// File resolution
// ---------------------------------------------------------------------------

const fileCache = new Map<string, Promise<string | null>>();

/** Extra files supplied by the user (e.g. an uploaded .dat), looked up before the library. */
type Overrides = Map<string, string>;

async function loadFile(ref: string, extra?: Overrides): Promise<string | null> {
  const name = ref.toLowerCase().replace(/\\/g, "/").trim();
  if (extra?.has(name)) return extra.get(name)!;
  const base = name.split("/").pop()!;
  if (extra?.has(base)) return extra.get(base)!;
  let p = fileCache.get(name);
  if (!p) {
    p = (async () => {
      const [idx, blob] = await Promise.all([getIndex(), getBlob()]);
      if (!idx || !blob) return null;
      for (const dir of ["parts/", "p/", "models/", "parts/s/", "p/48/", "p/8/"]) {
        const e = idx.entries[dir + name];
        if (e) return readEntry(blob, e);
      }
      return null;
    })();
    fileCache.set(name, p);
  }
  return p;
}

/** Library part number for a Rebrickable part, e.g. "3961pr0002" -> "3961" if the printed variant is missing. */
export async function findLDrawPart(partNum: string): Promise<string | null> {
  const idx = await getIndex();
  if (!idx) return null;
  const pn = partNum.toLowerCase();
  const candidates = [pn, pn.replace(/pr\d+[a-z]?$/, ""), pn.replace(/(pat|pb)\d+[a-z]?$/, ""), pn.replace(/[a-z]$/, "")];
  for (const c of candidates) if (c && idx.entries[`parts/${c}.dat`]) return c;
  return null;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

type M = number[]; // 3x4 row-major [a b c x; d e f y; g h i z]
const mul = (A: M, B: M): M => {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
    r[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3];
  }
  return r;
};
const det3 = (m: M) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

export interface LDrawResult {
  title: string;
  triangles: Float32Array; // 9 per triangle, mm, z up, consistent outward winding
  missing: string[];
}

/**
 * Converts an LDraw part to triangles: resolves sub-files, applies BFC winding rules,
 * scales 1 LDU = 0.4 mm and turns it studs-up (LDraw's y axis points down).
 */
export async function convertLDraw(main: string, extra?: Overrides): Promise<LDrawResult> {
  const out: number[] = [];
  const missing = new Set<string>();
  const title = main.split(/\r?\n/)[0].replace(/^0\s*/, "").trim();

  async function walk(text: string, m: M, invert: boolean, depth: number) {
    if (depth > 40) return;
    let ccw = true;
    let invertNext = false;
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim().split(/\s+/);
      if (!t[0]) continue;
      if (t[0] === "0") {
        if (t[1] === "BFC") {
          if (t.includes("CW")) ccw = false;
          if (t.includes("CCW")) ccw = true;
          if (t[2] === "INVERTNEXT") invertNext = true;
        }
        continue;
      }
      if (t[0] === "1" && t.length >= 15) {
        const n = t.slice(2, 14).map(Number);
        const local: M = [n[3], n[4], n[5], n[0], n[6], n[7], n[8], n[1], n[9], n[10], n[11], n[2]];
        const ref = t.slice(14).join(" ");
        const sub = await loadFile(ref, extra);
        if (sub == null) missing.add(ref);
        else await walk(sub, mul(m, local), invert !== invertNext !== det3(local) < 0, depth + 1);
        invertNext = false;
        continue;
      }
      if (t[0] === "3" || t[0] === "4") {
        const nv = t[0] === "3" ? 3 : 4;
        const v: number[][] = [];
        for (let i = 0; i < nv; i++) {
          const x = +t[2 + i * 3], y = +t[3 + i * 3], z = +t[4 + i * 3];
          v.push([m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]]);
        }
        const flip = !ccw !== invert;
        const tri = (a: number[], b: number[], c: number[]) => (flip ? out.push(...a, ...c, ...b) : out.push(...a, ...b, ...c));
        tri(v[0], v[1], v[2]);
        if (nv === 4) tri(v[0], v[2], v[3]);
      }
    }
  }

  // (x, y, z) LDU -> (x, z, -y) * 0.4 mm : a proper rotation, so winding is preserved
  await walk(main, [0.4, 0, 0, 0, 0, 0, 0.4, 0, 0, -0.4, 0, 0], false, 0);
  return { title, triangles: repairTJunctions(new Float32Array(out)), missing: [...missing] };
}

/** Loads a library part by number (e.g. "2444") and converts it. */
export async function convertLibraryPart(partNum: string): Promise<LDrawResult & { file: string }> {
  const text = await loadFile(`${partNum}.dat`);
  if (text == null) throw new Error(`Part ${partNum} is not in the imported LDraw library.`);
  return { ...(await convertLDraw(text)), file: `${partNum}.dat` };
}

/**
 * Welds vertices and splits triangles where a vertex lies on another triangle's edge
 * (LDraw "T-junctions"), which closes many of the seams between primitives.
 */
function repairTJunctions(tris: Float32Array): Float32Array {
  const eps = 1e-3;
  const verts: number[][] = [];
  const ids = new Map<string, number>();
  const id = (x: number, y: number, z: number) => {
    const k = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
    let i = ids.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push([x, y, z]);
      ids.set(k, i);
    }
    return i;
  };
  let faces: number[][] = [];
  for (let i = 0; i < tris.length; i += 9) {
    const f = [id(tris[i], tris[i + 1], tris[i + 2]), id(tris[i + 3], tris[i + 4], tris[i + 5]), id(tris[i + 6], tris[i + 7], tris[i + 8])];
    if (f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) faces.push(f);
  }
  for (let pass = 0; pass < 12; pass++) {
    const edgeFaces = new Map<string, number[]>();
    faces.forEach((f, fi) => {
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        const e = a < b ? `${a},${b}` : `${b},${a}`;
        const d = edgeFaces.get(e);
        if (d) d.push(fi);
        else edgeFaces.set(e, [fi]);
      }
    });
    const open = [...edgeFaces].filter(([, d]) => d.length === 1).map(([e, d]) => [...e.split(",").map(Number), d[0]]);
    if (!open.length) break;
    const cand = [...new Set(open.flatMap(([a, b]) => [a, b]))];
    const splits = new Map<number, [number, number, number[]][]>();
    for (const [a, b, fi] of open) {
      const A = verts[a], B = verts[b];
      const AB = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const L2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2;
      const on: [number, number][] = [];
      for (const c of cand) {
        if (c === a || c === b) continue;
        const P = verts[c];
        const t = ((P[0] - A[0]) * AB[0] + (P[1] - A[1]) * AB[1] + (P[2] - A[2]) * AB[2]) / L2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const d2 = (A[0] + t * AB[0] - P[0]) ** 2 + (A[1] + t * AB[1] - P[1]) ** 2 + (A[2] + t * AB[2] - P[2]) ** 2;
        if (d2 < 1e-6) on.push([t, c]);
      }
      if (on.length) {
        on.sort((x, y) => x[0] - y[0]);
        const s = splits.get(fi) ?? [];
        s.push([a, b, on.map((x) => x[1])]);
        splits.set(fi, s);
      }
    }
    if (!splits.size) break;
    const next: number[][] = [];
    faces.forEach((f, fi) => {
      const s = splits.get(fi);
      if (!s) return void next.push(f);
      // split along one edge per pass, fanning from the opposite corner (keeps the orientation)
      const [ea, eb, pts] = s[0];
      let k = f.findIndex((v, i) => v === ea && f[(i + 1) % 3] === eb);
      let seq = pts;
      if (k < 0) {
        k = f.findIndex((v, i) => v === eb && f[(i + 1) % 3] === ea);
        seq = [...pts].reverse();
      }
      const chain = [f[k], ...seq, f[(k + 1) % 3]];
      const c = f[(k + 2) % 3];
      for (let i = 0; i < chain.length - 1; i++) next.push([chain[i], chain[i + 1], c]);
    });
    faces = next;
  }
  const res = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => f.forEach((v, k) => res.set(verts[v], i * 9 + k * 3)));
  return res;
}
