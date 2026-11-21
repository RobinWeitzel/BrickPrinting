import { useEffect, useMemo, useState } from "react";
import { BAMBU_COLORS_SOURCE, bambuFilamentName, loadBambuColors, materialsOf, type BambuColor } from "../lib/bambu";
import { useStore } from "../lib/store";
import type { Color } from "../lib/types";
import { CustomColor, Modal, Swatch } from "./ui";

const same = (a: Color, b: Color) => a.name === b.name && a.hex.toLowerCase() === b.hex.toLowerCase();

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const project = useStore((s) => s.project);

  const setColors = new Map<string, { name: string; hex: string }>();
  for (const i of project?.inventory ?? []) setColors.set(i.colorHex.toLowerCase(), { name: i.colorName, hex: i.colorHex });
  const missing = [...setColors.values()].filter((c) => !settings.filaments.some((f) => f.hex.toLowerCase() === c.hex.toLowerCase()));

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <section className="card">
        <h3>My filaments</h3>
        <p className="muted small">Your filament colors show up first in every color picker and can be mapped to LEGO colors.</p>
        <div className="filaments">
          {settings.filaments.map((f, i) => (
            <div key={i} className="filament">
              <Swatch color={f} size={20} />
              <input value={f.name} onChange={(e) => updateSettings({ filaments: settings.filaments.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input type="color" value={f.hex} onChange={(e) => updateSettings({ filaments: settings.filaments.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} />
              <button className="icon danger" onClick={() => updateSettings({ filaments: settings.filaments.filter((_, j) => j !== i) })} aria-label="Remove">
                ✕
              </button>
            </div>
          ))}
          {settings.filaments.length === 0 && <p className="muted small">No filaments yet. Pick your Bambu Lab spools below, or add a custom color.</p>}
        </div>
        <CustomColor initial={{ name: "", hex: "#a0a5a9" }} button="Add filament" onPick={(c) => updateSettings({ filaments: [...settings.filaments, c] })} />
        {missing.length > 0 && (
          <button className="link small" onClick={() => updateSettings({ filaments: [...settings.filaments, ...missing] })}>
            Add the {missing.length} colors of the current set
          </button>
        )}
      </section>
      <BambuPicker />
    </Modal>
  );
}

/** Toggle Bambu Lab spools you own into the filament list. */
function BambuPicker() {
  const filaments = useStore((s) => s.settings.filaments);
  const updateSettings = useStore((s) => s.updateSettings);
  const [colors, setColors] = useState<BambuColor[] | null>(null);
  const [error, setError] = useState("");
  const [material, setMaterial] = useState("PLA Basic");
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadBambuColors().then(setColors, (e) => setError(String(e.message ?? e)));
  }, []);

  const materials = useMemo(() => (colors ? materialsOf(colors) : []), [colors]);
  const q = query.trim().toLowerCase();
  const shown = (colors ?? []).filter((c) => (q ? `${c.material} ${c.name} ${c.code}`.toLowerCase().includes(q) : c.material === material));

  const toColor = (c: BambuColor): Color => ({ name: bambuFilamentName(c), hex: c.hex });
  const owned = (c: BambuColor) => filaments.some((f) => same(f, toColor(c)));
  const toggle = (c: BambuColor) => {
    const col = toColor(c);
    updateSettings({ filaments: owned(c) ? filaments.filter((f) => !same(f, col)) : [...filaments, col] });
  };
  const ownedCount = (m: string) => (colors ?? []).filter((c) => c.material === m && owned(c)).length;

  return (
    <section className="card">
      <h3>Bambu Lab filaments</h3>
      <p className="muted small">
        Click the spools you have to add them to your filaments, and click again to remove. Colors come from{" "}
        <a href={BAMBU_COLORS_SOURCE} target="_blank" rel="noreferrer">
          Bambu Studio's color list
        </a>
        . Hex values are approximate; real filament can look different.
      </p>
      {error && <p className="error">{error}</p>}
      {!colors && !error && <p className="muted">Loading colors…</p>}
      {colors && (
        <>
          <div className="row gap wrap">
            <select value={material} onChange={(e) => (setMaterial(e.target.value), setQuery(""))}>
              {materials.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {ownedCount(m) ? ` (${ownedCount(m)} owned)` : ""}
                </option>
              ))}
            </select>
            <input className="grow" placeholder="Search all materials, e.g. black or 10101" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="bambu-grid">
            {shown.map((c) => {
              const on = owned(c);
              return (
                <button key={c.code + c.material} className={`bambu-spool ${on ? "owned" : ""}`} onClick={() => toggle(c)} title={`${c.material} ${c.name} (${c.code})`}>
                  <span className="bambu-swatch" style={{ background: c.hexes.length > 1 ? `linear-gradient(135deg, ${c.hexes.join(", ")})` : c.hex }}>
                    {on && <span className="bambu-check">✓</span>}
                  </span>
                  <span className="bambu-name">
                    {q && <span className="muted">{c.material} </span>}
                    {c.name}
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && <p className="muted small">No colors found.</p>}
          </div>
        </>
      )}
    </section>
  );
}
