import { createStore, get as idbGet, set as idbSet } from "idb-keyval";
import type { RenderRequest, RenderResponse } from "../workers/openscad.worker";
import { base, effectiveParams, familyOf, partsById, specKey } from "./catalog";
import type { ParamValue, PartSpec } from "./types";

const stlStore = createStore("brickprinting-stl", "stl");

/** Serializes a JSON param value to an OpenSCAD literal. */
export function toScad(v: ParamValue): string {
  if (Array.isArray(v)) return `[${v.map(toScad).join(",")}]`;
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

// ---- fit values (global overrides of scad/config.scad, from Settings) ----

/** The tunable fit values of scad/config.scad with their validated defaults (SPEC.md). */
export const FIT_PARAMS = [
  { name: "RIB_D", label: "Stud socket: rib tip diameter", default: 4.75, step: 0.05, hint: "smaller = tighter studs" },
  { name: "SLOT_INTERF", label: "Clip slot: barb interference per side", default: 0.1, step: 0.05, hint: "larger = tighter clips" },
  { name: "SLOT_CLEAR", label: "Clip slot: clearance per side (thickness)", default: 0.15, step: 0.05, hint: "larger = looser clips" },
  { name: "BORE_SPIN_D", label: "Spinning bore diameter", default: 3.2, step: 0.05, hint: "larger = freer wheels" },
  { name: "BORE_GRIP_D", label: "Grip bore: rib tip diameter", default: 2.8, step: 0.05, hint: "smaller = tighter axle" },
] as const;

let fitDefines: string[] = [];
let fitKey = "";

/** Sets the fit overrides used for every render (only values that differ from the defaults). */
export function setFitOverrides(fit: Record<string, number> | undefined) {
  fitDefines = FIT_PARAMS.filter((p) => fit?.[p.name] !== undefined && fit[p.name] !== p.default).map((p) => `${p.name}=${fit![p.name]}`);
  fitKey = fitDefines.join(",");
}

/** Cache key of a rendered part: the spec plus the fit settings. */
export const renderKey = (spec: PartSpec) => `${fitKey}|${specKey(spec)}`;

/** -D defines: every parameter that differs from the family file's own defaults. */
function definesFor(spec: PartSpec): string[] {
  const p = partsById.get(spec.presetId)!;
  const famDefaults = familyOf(p).defaults;
  const out: string[] = [];
  for (const [k, v] of Object.entries(effectiveParams(spec))) {
    if (JSON.stringify(famDefaults[k]) === JSON.stringify(v)) continue;
    out.push(`${k}=${toScad(v)}`);
  }
  return [...out, ...fitDefines];
}

/** Cut-outs in mm (8 mm per stud). */
function cutoutsMm(spec: PartSpec): [number, number, number, number][] | undefined {
  if (!spec.cutouts?.length) return undefined;
  return spec.cutouts.filter((c) => c.w > 0 && c.d > 0).map((c) => [c.x * 8, c.y * 8, c.w * 8, c.d * 8]);
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
  const key = renderKey(spec);
  let p = memCache.get(key);
  if (p) return p;
  p = (async () => {
    const cached = await idbGet<ArrayBuffer>(key, stlStore).catch(() => undefined);
    if (cached) return cached;
    const part = partsById.get(spec.presetId);
    if (!part) throw new Error(`Unknown part ${spec.presetId}`);
    const id = nextId++;
    const req: RenderRequest = {
      id,
      family: part.family,
      libUrl: new URL(`${base}library/fs.json`, location.href).href,
      defines: definesFor(spec),
      cutouts: cutoutsMm(spec),
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
