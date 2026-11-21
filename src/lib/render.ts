import { createStore, get as idbGet, set as idbSet } from "idb-keyval";
import type { RenderRequest, RenderResponse } from "../workers/openscad.worker";
import { base, effectiveParams, partsById, scadUrl, specKey } from "./catalog";
import type { ParamValue, PartSpec } from "./types";

const stlStore = createStore("brickprinting-stl", "stl");

/** Serializes a JSON param value to an OpenSCAD literal. */
export function toScad(v: ParamValue): string {
  if (Array.isArray(v)) return `[${v.map(toScad).join(",")}]`;
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

function definesFor(spec: PartSpec): string[] {
  const p = partsById.get(spec.presetId);
  const out: string[] = [];
  for (const [k, v] of Object.entries(spec.overrides)) {
    if (p && JSON.stringify(p.defaults[k]) === JSON.stringify(v)) continue;
    out.push(`${k}=${toScad(v)}`);
  }
  return out;
}

// ---- worker queue (single worker, serial) ----
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("../workers/openscad.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      const res = e.data;
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      if (res.ok) p.resolve(res.stl);
      else {
        console.warn("OpenSCAD log:\n" + res.log.join("\n"));
        p.reject(new Error(res.error));
      }
    };
  }
  return worker;
}

const memCache = new Map<string, Promise<ArrayBuffer>>();

/** Renders a part to binary STL (cached in memory and IndexedDB). */
export function renderStl(spec: PartSpec): Promise<ArrayBuffer> {
  const key = specKey(spec);
  let p = memCache.get(key);
  if (p) return p;
  p = (async () => {
    const cached = await idbGet<ArrayBuffer>(key, stlStore).catch(() => undefined);
    if (cached) return cached;
    if (!partsById.has(spec.presetId)) throw new Error(`Unknown part ${spec.presetId}`);
    const id = nextId++;
    const req: RenderRequest = {
      id,
      presetId: spec.presetId,
      scadUrl: new URL(scadUrl(spec.presetId), location.href).href,
      fsUrl: new URL(`${base}machineblocks/fs.json`, location.href).href,
      defines: definesFor(spec),
    };
    const stl = await new Promise<ArrayBuffer>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      getWorker().postMessage(req);
    });
    idbSet(key, stl, stlStore).catch(() => {});
    return stl;
  })();
  memCache.set(key, p);
  p.catch(() => memCache.delete(key));
  return p;
}

export { effectiveParams };
