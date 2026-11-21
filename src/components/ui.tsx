import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ldrawOf } from "../lib/custom";
import { legoColor, resolveColor, savedColors } from "../lib/model";
import { useStore } from "../lib/store";
import type { Color, ColorRef } from "../lib/types";

/** Marks parts converted from LDraw: exact LEGO dimensions, not tuned for printing. */
export function LDrawBadge({ presetId }: { presetId?: string }) {
  useStore((s) => s.customParts); // re-render when parts load
  const num = ldrawOf(presetId);
  if (!num) return null;
  return (
    <span className="ldraw-badge" title={`Converted from the LDraw model #${num}. LDraw uses exact LEGO dimensions without print tolerances, so it may fit tighter or looser than MachineBlocks parts. Print a test piece first.`}>
      LDraw
    </span>
  );
}

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

  const pick = (c: ColorRef) => {
    onChange(c);
    setOpen(false);
  };
  const recent = savedColors(project);

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
              <div className="popover-title">Used in this build</div>
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
  const recent = savedColors(project);
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

const parseNum = (s: string) => {
  const t = s.trim().replace(",", ".");
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
};
const fmtNum = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Number field that can be cleared and typed into freely ("", "-", "0." …).
 * Only valid numbers within min/max are applied; on blur the field shows the applied value again.
 * Accepts "," as decimal separator. Arrow up/down step the value.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer,
  className = "num",
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(fmtNum(value));
  const [focused, setFocused] = useState(false);
  // follow outside changes while not editing
  useEffect(() => {
    if (!focused) setText(fmtNum(value));
  }, [value, focused]);
  const valid = (n: number) => Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max) && (!integer || Number.isInteger(n));
  const commit = (n: number) => {
    if (valid(n) && n !== value) onChange(n);
  };
  return (
    <input
      className={className}
      type="text"
      inputMode={integer && (min ?? 0) >= 0 ? "numeric" : "decimal"}
      aria-label={ariaLabel}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        commit(parseNum(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        setText(fmtNum(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const cur = parseNum(text);
        let n = (Number.isFinite(cur) ? cur : value) + (e.key === "ArrowUp" ? step : -step);
        n = Math.round(n * 1e6) / 1e6;
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        setText(fmtNum(n));
        commit(n);
      }}
    />
  );
}

export function Qty({ value, onChange, min = 1 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <span className="qty">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">
        −
      </button>
      <NumberInput className="" value={value} onChange={onChange} min={min} integer ariaLabel="Quantity" />
      <button onClick={() => onChange(value + 1)} aria-label="Increase">
        +
      </button>
    </span>
  );
}
