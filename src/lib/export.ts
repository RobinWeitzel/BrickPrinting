import { strToU8, zipSync, type Zippable } from "fflate";
import { renderStl } from "./render";
import { parseBinaryStl, type Mesh } from "./stl";
import type { BomLine, BomResult } from "./model";
import type { Color, Settings } from "./types";

export type ExportMode = "stl-zip" | "3mf-per-color" | "3mf-ams";

const safe = (s: string) => s.replace(/[^\w\- .()]+/g, "_").replace(/\s+/g, " ").trim();
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface ExportProgress {
  done: number;
  total: number;
  label: string;
}

async function renderAll(lines: BomLine[], onProgress: (p: ExportProgress) => void) {
  const stls = new Map<BomLine, ArrayBuffer>();
  let done = 0;
  for (const l of lines) {
    onProgress({ done, total: lines.length, label: `Generating ${l.name}` });
    stls.set(l, await renderStl(l.spec));
    done++;
  }
  onProgress({ done, total: lines.length, label: "Packing files" });
  return stls;
}

function bomCsv(bom: BomResult) {
  const rows = [["Quantity", "Part", "Color", "Hex", "LEGO parts", "Steps", "MachineBlocks preset", "Overrides"]];
  for (const l of bom.lines) rows.push([String(l.qty), l.name, l.color.name, l.color.hex, l.legoParts.join(" "), l.steps.join(" "), l.spec.presetId, JSON.stringify(l.spec.overrides)]);
  for (const u of bom.unmatched) rows.push([String(u.qty), u.title, u.color.name, u.color.hex, "", u.steps.join(" "), "NOT MATCHED", ""]);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

// ---------------------------------------------------------------------------
// 3MF
// ---------------------------------------------------------------------------

interface Placed {
  objectId: number;
  x: number;
  y: number;
}

interface Obj {
  id: number;
  line: BomLine;
  mesh: Mesh;
  extruder: number;
}

/** Shelf-packs instances onto plates. Returns one array of placements per plate. */
function pack(objs: Obj[], plate: Settings["plate"]): Placed[][] {
  const items: { o: Obj; w: number; d: number }[] = [];
  for (const o of objs) {
    const w = o.mesh.max[0] - o.mesh.min[0];
    const d = o.mesh.max[1] - o.mesh.min[1];
    for (let i = 0; i < o.line.qty; i++) items.push({ o, w, d });
  }
  items.sort((a, b) => b.d - a.d || b.w - a.w);
  const plates: Placed[][] = [];
  let cur: Placed[] = [];
  let x = plate.spacing, y = plate.spacing, rowH = 0;
  for (const it of items) {
    if (x + it.w > plate.width - plate.spacing) {
      x = plate.spacing;
      y += rowH + plate.spacing;
      rowH = 0;
    }
    if (y + it.d > plate.depth - plate.spacing && cur.length) {
      plates.push(cur);
      cur = [];
      x = plate.spacing;
      y = plate.spacing;
      rowH = 0;
    }
    // position so that the mesh's min corner lands at (x, y), z on the bed
    cur.push({ objectId: it.o.id, x: x - it.o.mesh.min[0], y: y - it.o.mesh.min[1] });
    x += it.w + plate.spacing;
    rowH = Math.max(rowH, it.d);
  }
  if (cur.length) plates.push(cur);
  return plates;
}

function build3mf(objs: Obj[], placed: Placed[], colors: Color[]): Uint8Array {
  const used = new Set(placed.map((p) => p.objectId));
  const usedObjs = objs.filter((o) => used.has(o.id));

  let model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BrickPrinting</metadata>
 <resources>
  <basematerials id="1">
${colors.map((c) => `   <base name="${xml(c.name)}" displaycolor="${c.hex.toUpperCase()}FF"/>`).join("\n")}
  </basematerials>
`;
  for (const o of usedObjs) {
    const v = o.mesh.vertices;
    const t = o.mesh.triangles;
    const vs: string[] = [];
    const zMin = o.mesh.min[2];
    for (let i = 0; i < v.length; i += 3) vs.push(`<vertex x="${+v[i].toFixed(4)}" y="${+v[i + 1].toFixed(4)}" z="${+(v[i + 2] - zMin).toFixed(4)}"/>`);
    const ts: string[] = [];
    for (let i = 0; i < t.length; i += 3) ts.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
    model += `  <object id="${o.id + 1}" type="model" name="${xml(`${o.line.color.name} - ${o.line.name}`)}" pid="1" pindex="${o.extruder - 1}">
   <mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh>
  </object>
`;
  }
  model += ` </resources>
 <build>
${placed.map((p) => `  <item objectid="${p.objectId + 1}" transform="1 0 0 0 1 0 0 0 1 ${+p.x.toFixed(3)} ${+p.y.toFixed(3)} 0"/>`).join("\n")}
 </build>
</model>`;

  // Slicer hints: filament/extruder per object (Bambu Studio / Orca and PrusaSlicer formats).
  const bambu = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${usedObjs
  .map(
    (o) => `  <object id="${o.id + 1}">
    <metadata key="name" value="${xml(`${o.line.color.name} - ${o.line.name}`)}"/>
    <metadata key="extruder" value="${o.extruder}"/>
  </object>`,
  )
  .join("\n")}
</config>`;
  const prusa = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${usedObjs
  .map(
    (o) => `  <object id="${o.id + 1}" instances_count="${placed.filter((p) => p.objectId === o.id).length}">
    <metadata type="object" key="name" value="${xml(`${o.line.color.name} - ${o.line.name}`)}"/>
    <metadata type="object" key="extruder" value="${o.extruder}"/>
  </object>`,
  )
  .join("\n")}
</config>`;

  const files: Zippable = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="text/xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`),
    "3D/3dmodel.model": strToU8(model),
    "Metadata/model_settings.config": strToU8(bambu),
    "Metadata/Slic3r_PE_model.config": strToU8(prusa),
  };
  return zipSync(files, { level: 6 });
}

// ---------------------------------------------------------------------------

export interface ExportOptions {
  mode: ExportMode;
  plate: Settings["plate"];
  projectName: string;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  summary: string;
}

export async function exportBom(bom: BomResult, opts: ExportOptions, onProgress: (p: ExportProgress) => void): Promise<ExportResult> {
  const stls = await renderAll(bom.lines, onProgress);
  const base = safe(opts.projectName) || "bricks";
  const out: Zippable = {};
  out["parts.csv"] = strToU8(bomCsv(bom));

  const colors: Color[] = [];
  for (const l of bom.lines) if (!colors.some((c) => c.hex.toLowerCase() === l.color.hex.toLowerCase())) colors.push(l.color);
  const colorIdx = (c: Color) => colors.findIndex((x) => x.hex.toLowerCase() === c.hex.toLowerCase());

  let summary = "";
  if (opts.mode === "stl-zip") {
    for (const l of bom.lines) {
      const path = `${safe(l.color.name)}/${safe(l.name)} x${l.qty}.stl`;
      out[path] = new Uint8Array(stls.get(l)!);
    }
    summary = `${bom.lines.length} STL files in ${colors.length} color folders`;
  } else {
    const objs: Obj[] = bom.lines.map((l, i) => ({ id: i, line: l, mesh: parseBinaryStl(stls.get(l)!), extruder: colorIdx(l.color) + 1 }));
    let fileCount = 0;
    const groups: { name: string; objs: Obj[] }[] =
      opts.mode === "3mf-ams" ? [{ name: "all colors", objs }] : colors.map((c) => ({ name: c.name, objs: objs.filter((o) => colorIdx(o.line.color) === colorIdx(c)) }));
    for (const g of groups) {
      const plates = pack(g.objs, opts.plate);
      plates.forEach((placed, i) => {
        const suffix = plates.length > 1 ? ` - plate ${i + 1} of ${plates.length}` : "";
        const groupColors = opts.mode === "3mf-ams" ? colors : [g.objs[0].line.color];
        const groupObjs = opts.mode === "3mf-ams" ? g.objs : g.objs.map((o) => ({ ...o, extruder: 1 }));
        out[`${safe(g.name)}${suffix}.3mf`] = build3mf(groupObjs, placed, groupColors);
        fileCount++;
      });
    }
    if (opts.mode === "3mf-ams") {
      out["filament-slots.txt"] = strToU8(colors.map((c, i) => `Filament ${i + 1}: ${c.name} (${c.hex})`).join("\n") + "\n");
    }
    summary = `${fileCount} 3MF file${fileCount === 1 ? "" : "s"}, ${colors.length} color${colors.length === 1 ? "" : "s"}`;
  }

  const zip = zipSync(out, { level: 0 });
  onProgress({ done: bom.lines.length, total: bom.lines.length, label: "Done" });
  return { blob: new Blob([zip as BlobPart], { type: "application/zip" }), filename: `${base} - ${opts.mode}.zip`, summary };
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
