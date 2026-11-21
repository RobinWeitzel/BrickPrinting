/// <reference lib="webworker" />
import { createOpenSCAD } from "openscad-wasm";

export interface RenderRequest {
  id: number;
  presetId: string; // e.g. "plates/plate-2x2"
  scadUrl: string;
  fsUrl: string;
  defines: string[]; // ["size=[2,2,1]", ...]
}

export type RenderResponse =
  | { id: number; ok: true; stl: ArrayBuffer; ms: number }
  | { id: number; ok: false; error: string; log: string[] };

let libFiles: Promise<Record<string, string>> | null = null;
const scadCache = new Map<string, Promise<string>>();

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
  libFiles ??= fetch(req.fsUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to load MachineBlocks library (${r.status})`);
    return r.json();
  });
  if (!scadCache.has(req.scadUrl)) {
    scadCache.set(
      req.scadUrl,
      fetch(req.scadUrl).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${req.scadUrl} (${r.status})`);
        return r.text();
      }),
    );
  }
  const [files, scad] = await Promise.all([libFiles, scadCache.get(req.scadUrl)!]);

  const log: string[] = [];
  // A fresh instance per render: OpenSCAD's main() can only run once per instance.
  const inst = await createOpenSCAD({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
  const os = inst.getInstance();
  const FS = os.FS;
  for (const [rel, content] of Object.entries(files)) {
    const p = "/mb/" + rel;
    mkdirp(FS, p.slice(0, p.lastIndexOf("/")));
    FS.writeFile(p, content);
  }
  const partPath = `/mb/examples/${req.presetId}.scad`;
  mkdirp(FS, partPath.slice(0, partPath.lastIndexOf("/")));
  FS.writeFile(partPath, scad);

  const args = [partPath, "-o", "/out.stl", "--backend=manifold", "--export-format=binstl"];
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
