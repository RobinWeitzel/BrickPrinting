import { useStore } from "../lib/store";
import { CustomColor, Modal, Swatch } from "./ui";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const project = useStore((s) => s.project);

  const setColors = new Map<string, { name: string; hex: string }>();
  for (const i of project?.inventory ?? []) setColors.set(i.colorHex.toLowerCase(), { name: i.colorName, hex: i.colorHex });
  const missing = [...setColors.values()].filter((c) => !settings.filaments.some((f) => f.hex.toLowerCase() === c.hex.toLowerCase()));

  return (
    <Modal title="Settings" onClose={onClose}>
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
        </div>
        <CustomColor initial={{ name: "", hex: "#a0a5a9" }} button="Add filament" onPick={(c) => updateSettings({ filaments: [...settings.filaments, c] })} />
        {missing.length > 0 && (
          <button className="link small" onClick={() => updateSettings({ filaments: [...settings.filaments, ...missing] })}>
            Add the {missing.length} colors of the current set
          </button>
        )}
      </section>
    </Modal>
  );
}
