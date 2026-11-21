import { useMemo, useState } from "react";
import { categoryName, partsById, schemaOf, type ParamSchema } from "../lib/catalog";
import { resolveColor } from "../lib/model";
import { useStore } from "../lib/store";
import type { ColorRef, ParamValue, PartSpec } from "../lib/types";
import { Preview3D } from "./Preview3D";
import { ColorPicker, Modal, Qty, RecentSwatches } from "./ui";

interface Props {
  title: string;
  spec: PartSpec;
  color?: ColorRef;
  qty?: number;
  legoColorId?: number;
  saveLabel: string;
  onSave: (spec: PartSpec, color: ColorRef, qty: number) => void;
  onClose: () => void;
  onChangeBase?: () => void;
}

export function PartEditor({ title, spec: initial, color: initialColor, qty: initialQty, legoColorId, saveLabel, onSave, onClose, onChangeBase }: Props) {
  const project = useStore((s) => s.project)!;
  const filaments = useStore((s) => s.settings.filaments);
  const [spec, setSpec] = useState(initial);
  const pushRecentColor = useStore((s) => s.pushRecentColor);
  // new library parts start in the last color used
  const [color, setColor] = useState<ColorRef>(
    initialColor ?? (legoColorId !== undefined ? { lego: legoColorId } : (project.recentColors?.[0] ?? { custom: filaments[0] ?? { name: "Light Bluish Gray", hex: "#A0A5A9" } })),
  );
  const [qty, setQty] = useState(initialQty ?? 1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const part = partsById.get(spec.presetId)!;
  const schema = schemaOf(part);
  const values = { ...part.defaults, ...spec.overrides };

  const sections = useMemo(() => {
    const m = new Map<string, ParamSchema[]>();
    for (const p of schema) {
      if (p.name === "size") continue;
      m.set(p.section, [...(m.get(p.section) ?? []), p]);
    }
    return [...m];
  }, [schema]);

  const set = (name: string, v: ParamValue) => setSpec((s) => ({ ...s, overrides: { ...s.overrides, [name]: v } }));
  const changed = Object.keys(spec.overrides).filter((k) => JSON.stringify(spec.overrides[k]) !== JSON.stringify(part.defaults[k]));

  const size = values.size as number[] | undefined;

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {qty !== undefined && initialQty !== undefined && (
            <label className="row gap">
              Quantity <Qty value={qty} onChange={setQty} />
            </label>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave({ presetId: spec.presetId, overrides: Object.fromEntries(changed.map((k) => [k, spec.overrides[k]])) }, color, qty)}>
            {saveLabel}
          </button>
        </>
      }
    >
      <div className="editor">
        <div className="editor-preview">
          <Preview3D spec={spec} color={resolveColor(project, color).hex} height={320} />
          <div className="editor-base">
            <div>
              <div className="muted small">{categoryName(part.category)}</div>
              <strong>{part.name}</strong>
            </div>
            {onChangeBase && <button onClick={onChangeBase}>Change base part</button>}
          </div>
        </div>
        <div className="editor-form">
          <div className="field">
            <label>Color</label>
            <div className="row gap wrap">
              <ColorPicker value={color} onChange={setColor} legoColorId={legoColorId} />
              <RecentSwatches
                value={color}
                onPick={(c) => {
                  setColor(c);
                  pushRecentColor(c);
                }}
              />
            </div>
          </div>
          {size && (
            <div className="field">
              <label>Size (studs × studs × height in plates)</label>
              <div className="row gap">
                {size.map((v, i) => (
                  <input
                    key={i}
                    type="number"
                    step={i === 2 ? 1 : 1}
                    min={1}
                    max={64}
                    value={v}
                    onChange={(e) => {
                      const n = [...size];
                      n[i] = Number(e.target.value) || 1;
                      set("size", n);
                    }}
                    className="num"
                  />
                ))}
                <span className="muted small">{size[2] === 1 ? "plate" : size[2] === 3 ? "brick" : `${size[2] / 3} bricks`}</span>
              </div>
            </div>
          )}
          <button className="link" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? "▾" : "▸"} All parameters {changed.filter((c) => c !== "size").length > 0 && `(${changed.filter((c) => c !== "size").length} changed)`}
          </button>
          {showAdvanced &&
            sections.map(([section, params]) => (
              <fieldset key={section}>
                <legend>{section}</legend>
                {params.map((p) => (
                  <ParamField key={p.name} schema={p} value={values[p.name]} changed={changed.includes(p.name)} onChange={(v) => set(p.name, v)} />
                ))}
              </fieldset>
            ))}
          {changed.length > 0 && (
            <button className="link" onClick={() => setSpec({ presetId: spec.presetId, overrides: {} })}>
              Reset to preset
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ParamField({ schema, value, onChange, changed }: { schema: ParamSchema; value: ParamValue; onChange: (v: ParamValue) => void; changed: boolean }) {
  const label = (
    <span className={changed ? "changed" : ""} title={schema.name}>
      {schema.label}
    </span>
  );
  if (typeof value === "boolean")
    return (
      <label className="param check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
    );
  if (schema.options)
    return (
      <label className="param">
        {label}
        <select value={String(value)} onChange={(e) => onChange(typeof value === "number" ? Number(e.target.value) : e.target.value)}>
          {schema.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  if (Array.isArray(value))
    return (
      <label className="param">
        {label}
        <span className="row gap-s wrap">
          {value.map((v, i) =>
            Array.isArray(v) ? (
              <code key={i}>{JSON.stringify(v)}</code>
            ) : (
              <input
                key={i}
                className="num"
                type="number"
                step={schema.step ?? "any"}
                value={v as number}
                onChange={(e) => {
                  const n = [...value];
                  n[i] = Number(e.target.value);
                  onChange(n);
                }}
              />
            ),
          )}
        </span>
      </label>
    );
  if (typeof value === "number")
    return (
      <label className="param">
        {label}
        <input className="num" type="number" step={schema.step ?? "any"} min={schema.min} max={schema.max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </label>
    );
  return (
    <label className="param">
      {label}
      <input value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
