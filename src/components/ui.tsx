import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { legoColor, resolveColor } from "../lib/model";
import { useStore } from "../lib/store";
import type { Color, ColorRef } from "../lib/types";

/** When true, <Modal> renders as a docked side panel instead of an overlay. */
export const InlineContext = createContext(false);

export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const inline = useContext(InlineContext);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (inline)
    return (
      <div className="panel">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    );
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Swatch({ color, size = 16, title }: { color: Color; size?: number; title?: string }) {
  return <span className="swatch" style={{ background: color.hex, width: size, height: size }} title={title ?? `${color.name} ${color.hex}`} />;
}

/** Popover color picker for an item color (follow LEGO color, filament palette, set colors, or custom). */
export function ColorPicker({ value, onChange, legoColorId }: { value: ColorRef; onChange: (c: ColorRef) => void; legoColorId?: number }) {
  const project = useStore((s) => s.project)!;
  const filaments = useStore((s) => s.settings.filaments);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = resolveColor(project, value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const setColors = new Map<number, Color>();
  for (const i of project.inventory) if (!setColors.has(i.colorId)) setColors.set(i.colorId, { name: i.colorName, hex: i.colorHex });

  const pushRecentColor = useStore((s) => s.pushRecentColor);
  const pick = (c: ColorRef) => {
    onChange(c);
    pushRecentColor(c);
    setOpen(false);
  };
  const recent = project.recentColors ?? [];

  return (
    <div className="color-picker" ref={ref}>
      <button className="color-button" onClick={() => setOpen(!open)} title={current.name}>
        <Swatch color={current} />
        <span className="color-name">{current.name}</span>
      </button>
      {open && (
        <div className="popover">
          {recent.length > 0 && (
            <>
              <div className="popover-title">Recently used</div>
              <RecentSwatches value={value} onPick={pick} size={22} />
            </>
          )}
          {legoColorId !== undefined && (
            <>
              <div className="popover-title">LEGO color</div>
              <button className={`popover-row ${"lego" in value ? "active" : ""}`} onClick={() => pick({ lego: legoColorId })}>
                <Swatch color={resolveColor(project, { lego: legoColorId })} /> {legoColor(project, legoColorId).name}
                {project.colorMap[legoColorId] && <span className="muted"> → {project.colorMap[legoColorId].name}</span>}
              </button>
            </>
          )}
          {filaments.length > 0 && <div className="popover-title">My filaments</div>}
          <div className="swatch-grid">
            {filaments.map((f) => (
              <button key={f.hex + f.name} className="swatch-btn" onClick={() => pick({ custom: f })} title={f.name}>
                <Swatch color={f} size={22} />
              </button>
            ))}
          </div>
          {setColors.size > 0 && <div className="popover-title">Colors in this set</div>}
          <div className="swatch-grid">
            {[...setColors].map(([id, c]) => (
              <button key={id} className="swatch-btn" onClick={() => pick({ lego: id })} title={c.name}>
                <Swatch color={c} size={22} />
              </button>
            ))}
          </div>
          <div className="popover-title">Custom</div>
          <CustomColor initial={current} onPick={(c) => pick({ custom: c })} />
        </div>
      )}
    </div>
  );
}

/** One-click swatches of the project's recently picked colors. */
export function RecentSwatches({ value, onPick, size = 18 }: { value?: ColorRef; onPick: (c: ColorRef) => void; size?: number }) {
  const project = useStore((s) => s.project)!;
  const recent = project.recentColors ?? [];
  const cur = value && JSON.stringify(value);
  return (
    <div className="swatch-grid">
      {recent.map((r) => {
        const c = resolveColor(project, r);
        return (
          <button key={JSON.stringify(r)} className={`swatch-btn ${JSON.stringify(r) === cur ? "active" : ""}`} onClick={() => onPick(r)} title={c.name}>
            <Swatch color={c} size={size} />
          </button>
        );
      })}
    </div>
  );
}

export function CustomColor({ initial, onPick, button = "Use" }: { initial: Color; onPick: (c: Color) => void; button?: string }) {
  const [hex, setHex] = useState(initial.hex);
  const [name, setName] = useState(initial.name);
  return (
    <div className="custom-color">
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          setHex(e.target.value);
          // don't keep a name that belongs to the previous color
          if (name === initial.name && e.target.value.toLowerCase() !== initial.hex.toLowerCase()) setName("");
        }}
      />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" />
      <button onClick={() => onPick({ name: name || hex, hex })}>{button}</button>
    </div>
  );
}

export function Qty({ value, onChange, min = 1 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <span className="qty">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">
        −
      </button>
      <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} />
      <button onClick={() => onChange(value + 1)} aria-label="Increase">
        +
      </button>
    </span>
  );
}
