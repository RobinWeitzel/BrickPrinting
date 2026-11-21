import { useState } from "react";
import { partsById } from "../lib/catalog";
import { download, exportBom, type ExportMode, type ExportProgress } from "../lib/export";
import { buildBom } from "../lib/model";
import { useStore } from "../lib/store";
import { PartThumb } from "./Library";
import { Modal, Swatch } from "./ui";

const MODES: { id: ExportMode; title: string; text: string }[] = [
  { id: "stl-zip", title: "STL files", text: "One STL per part type, sorted into a folder per color. Quantity is in the file name." },
  { id: "3mf-per-color", title: "3MF per color", text: "One ready-to-slice 3MF per color with every copy laid out on the plate. Print each color as its own job; no AMS waste." },
  { id: "3mf-ams", title: "3MF for AMS (all colors)", text: "Everything in one file, each part assigned to a filament slot. Fewer jobs, but more purge waste." },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [mode, setMode] = useState<ExportMode>("stl-zip");
  const [includeUnplaced, setIncludeUnplaced] = useState(false);
  const [includeSpares, setIncludeSpares] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const bom = buildBom(project, { includeUnplacedInventory: includeUnplaced, includeSpares });
  const totalParts = bom.lines.reduce((a, l) => a + l.qty, 0);
  const colorCount = new Set(bom.lines.map((l) => l.color.hex.toLowerCase())).size;

  async function run() {
    setError("");
    setResult("");
    try {
      const r = await exportBom(bom, { mode, plate: settings.plate, projectName: project.name }, setProgress);
      download(r.blob, r.filename);
      setResult(`Downloaded ${r.filename}: ${r.summary}.`);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <Modal
      title="Export for printing"
      onClose={onClose}
      wide
      footer={
        <>
          {progress && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              <span>
                {progress.label} ({progress.done}/{progress.total})
              </span>
            </div>
          )}
          {result && <span className="ok">{result}</span>}
          {error && <span className="error">{error}</span>}
          <span className="spacer" />
          <button className="primary" onClick={run} disabled={!!progress || bom.lines.length === 0}>
            {progress ? "Exporting…" : `Export ${totalParts} parts`}
          </button>
        </>
      }
    >
      <div className="mode-grid">
        {MODES.map((m) => (
          <label key={m.id} className={`mode ${mode === m.id ? "active" : ""}`}>
            <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
            <strong>{m.title}</strong>
            <span className="muted small">{m.text}</span>
          </label>
        ))}
      </div>
      <div className="row gap wrap options">
        <label className="row gap-s">
          <input type="checkbox" checked={includeUnplaced} onChange={(e) => setIncludeUnplaced(e.target.checked)} /> Also include set parts not placed in any step
        </label>
        {includeUnplaced && (
          <label className="row gap-s">
            <input type="checkbox" checked={includeSpares} onChange={(e) => setIncludeSpares(e.target.checked)} /> Include spare parts
          </label>
        )}
        {mode !== "stl-zip" && (
          <label className="row gap-s">
            Plate
            <input className="num" type="number" value={settings.plate.width} onChange={(e) => updateSettings({ plate: { ...settings.plate, width: Number(e.target.value) || 256 } })} />×
            <input className="num" type="number" value={settings.plate.depth} onChange={(e) => updateSettings({ plate: { ...settings.plate, depth: Number(e.target.value) || 256 } })} />
            mm, gap
            <input className="num" type="number" value={settings.plate.spacing} onChange={(e) => updateSettings({ plate: { ...settings.plate, spacing: Number(e.target.value) || 4 } })} />
            mm
          </label>
        )}
      </div>

      {bom.unmatched.length > 0 && (
        <div className="notice warn">
          <strong>{bom.unmatched.reduce((a, u) => a + u.qty, 0)} parts are skipped</strong> because they have no MachineBlocks match: {bom.unmatched.map((u) => `${u.qty}× ${u.title} (${u.color.name})`).join(", ")}
        </div>
      )}

      <p className="muted">
        {totalParts} parts, {bom.lines.length} unique part/color combinations, {colorCount} colors. Each unique part is generated once in your browser.
      </p>
      <table className="bom">
        <tbody>
          {bom.lines.map((l) => {
            const p = partsById.get(l.spec.presetId);
            return (
              <tr key={l.key}>
                <td className="num-cell">{l.qty}×</td>
                <td>{p && <PartThumb part={p} size={32} />}</td>
                <td>
                  {l.name}
                  {l.legoParts.length > 0 && <div className="muted small">LEGO #{l.legoParts.join(", #")}</div>}
                </td>
                <td>
                  <Swatch color={l.color} /> {l.color.name}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
