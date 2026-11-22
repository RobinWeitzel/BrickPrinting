/// <reference lib="webworker" />
import { createOpenSCAD } from "openscad-wasm";

export interface RenderRequest {
  id: number;
  /** part family = scad/families/<family>.scad */
  family: string;
  /** JSON map of library files (public/library/fs.json) */
  libUrl: string;
  defines: string[]; // ["size=[2,2]", "RIB_D=4.8", ...]
  /** rectangles in mm [x, y, w, d] removed through the full height */
  cutouts?: [number, number, number, number][];
}

export type RenderResponse =
  | { id: number; ok: true; stl: ArrayBuffer; ms: number }
  | { id: number; ok: false; error: string; log: string[] };

let libFiles: Promise<Record<string, string>> | null = null;

function mkdirp(FS: { mkdir(p: string): void }, dir: string) {
  let cur = "";
  for (const seg of dir.split("/").filter(Boolean)) {
    cur += "/" + seg;
    try {
      FS.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

async function render(req: RenderRequest): Promise<RenderResponse> {
  const t0 = performance.now();
  libFiles ??= fetch(req.libUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to load the part library (${r.status})`);
    return r.json();
  });
  const files = await libFiles;

  const log: string[] = [];
  // A fresh instance per render: OpenSCAD's main() can only run once per instance.
  const inst = await createOpenSCAD({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const os = inst.getInstance();
  const FS = os.FS;
  for (const [rel, content] of Object.entries(files)) {
    const p = "/lib/" + rel;
    mkdirp(FS, p.slice(0, p.lastIndexOf("/")));
    FS.writeFile(p, content);
  }
  const args = [`/lib/families/${req.family}.scad`, "-o", "/out.stl", "--backend=manifold", "--export-format=binstl"];
  for (const d of req.defines) args.push("-D", d);
  let rc: number;
  try {
    rc = os.callMain(args);
  } catch (e) {
    return { id: req.id, ok: false, error: String(e), log };
  }
  if (rc !== 0) return { id: req.id, ok: false, error: `OpenSCAD exited with code ${rc}`, log };
  let out: Uint8Array;
  try {
    out = FS.readFile("/out.stl", { encoding: "binary" });
  } catch {
    return { id: req.id, ok: false, error: "OpenSCAD produced no output", log };
  }
  return cutPass(req, out, log, t0);
}

async function cutPass(req: RenderRequest, out: Uint8Array, log: string[], t0: number): Promise<RenderResponse> {
  if (req.cutouts?.length) {
    // second pass: subtract the cut-outs from the finished part (works for every preset structure)
    const inst2 = await createOpenSCAD({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    const os2 = inst2.getInstance();
    os2.FS.writeFile("/part.stl", out);
    const cubes = req.cutouts.map(([x, y, w, d]) => `translate([${x}, ${y}, -50]) cube([${w}, ${d}, 200]);`).join("\n  ");
    os2.FS.writeFile("/cut.scad", `difference() {\n  import("/part.stl");\n  ${cubes}\n}\n`);
    let rc2: number;
    try {
      rc2 = os2.callMain(["/cut.scad", "-o", "/out.stl", "--backend=manifold", "--export-format=binstl"]);
    } catch (e) {
      return { id: req.id, ok: false, error: `Cut-out failed: ${e}`, log };
    }
    if (rc2 !== 0) return { id: req.id, ok: false, error: `Cut-out failed (code ${rc2})`, log };
    out = os2.FS.readFile("/out.stl", { encoding: "binary" });
  }
  const stl = out.slice().buffer as ArrayBuffer;
  return { id: req.id, ok: true, stl, ms: Math.round(performance.now() - t0) };
}

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  let res: RenderResponse;
  try {
    res = await render(e.data);
  } catch (err) {
    res = { id: e.data.id, ok: false, error: String(err), log: [] };
  }
  if (res.ok) (self as DedicatedWorkerGlobalScope).postMessage(res, [res.stl]);
  else (self as DedicatedWorkerGlobalScope).postMessage(res);
};
