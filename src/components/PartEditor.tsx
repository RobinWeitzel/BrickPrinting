import { useMemo, useState } from "react";
import { categoryName, familyOf, partsById, schemaOf, type ParamSchema } from "../lib/catalog";
import { resolveColor, savedColors } from "../lib/model";
import { useStore } from "../lib/store";
import type { ColorRef, Cutout, ParamValue, PartSpec } from "../lib/types";
import { Preview3D } from "./Preview3D";
import { ColorPicker, Modal, NumberInput, Qty, RecentSwatches } from "./ui";

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
  // new library parts start in the last color used
  const [color, setColor] = useState<ColorRef>(
    initialColor ?? (legoColorId !== undefined ? { lego: legoColorId } : (savedColors(project)[0] ?? { custom: filaments[0] ?? { name: "Light Bluish Gray", hex: "#A0A5A9" } })),
  );
  const [qty, setQty] = useState(initialQty ?? 1);
  const part = partsById.get(spec.presetId); // undefined for parts no longer in the library
  const defaults = part?.defaults ?? {};
  const schema = useMemo(() => (part ? schemaOf(part) : []), [part]);
  const values = { ...defaults, ...spec.overrides };

  const sections = useMemo(() => {
    const m = new Map<string, ParamSchema[]>();
    for (const p of schema) {
      if (p.name === "size" || p.name === "plates") continue; // shown on top
      m.set(p.section, [...(m.get(p.section) ?? []), p]);
    }
    return [...m];
  }, [schema]);

  const set = (name: string, v: ParamValue) => setSpec((s) => ({ ...s, overrides: { ...s.overrides, [name]: v } }));
  const changed = Object.keys(spec.overrides).filter((k) => JSON.stringify(spec.overrides[k]) !== JSON.stringify(defaults[k]));

  const size = values.size as number[] | undefined;
  const plates = typeof values.plates === "number" ? values.plates : undefined;

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
          <button className="primary" onClick={() => onSave({ presetId: spec.presetId, overrides: Object.fromEntries(changed.map((k) => [k, spec.overrides[k]])), ...(spec.cutouts?.length ? { cutouts: spec.cutouts } : {}) }, color, qty)}>
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
              <div className="muted small">{part ? categoryName(part.category) : "Missing part"}</div>
              <strong>{part?.name ?? `Not in the library: ${spec.presetId}`}</strong>
              {part && <div className="muted small">{familyOf(part).description}</div>}
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
                onPick={setColor}
              />
            </div>
          </div>
          {size && (
            <div className="field">
              <label>Size in studs{plates !== undefined ? " and height in plates" : ""}</label>
              <div className="row gap">
                {size.map((v, i) => (
                  <NumberInput
                    key={i}
                    min={1}
                    max={64}
                    step={1}
                    value={v}
                    ariaLabel={["Studs along X", "Studs along Y"][i]}
                    onChange={(val) => {
                      const n = [...size];
                      n[i] = val;
                      set("size", n);
                    }}
                  />
                ))}
                {plates !== undefined && (
                  <>
                    <span className="muted">×</span>
                    <NumberInput min={1} max={36} step={1} value={plates} ariaLabel="Height in plates" onChange={(v) => set("plates", v)} />
                    <span className="muted small">{plates === 1 ? "plate" : plates === 3 ? "brick" : plates % 3 === 0 ? `${plates / 3} bricks` : `${plates} plates`}</span>
                  </>
                )}
              </div>
            </div>
          )}
          {sections.map(([section, params]) => (
            <fieldset key={section}>
              <legend>{section}</legend>
              {params.map((p) => (
                <ParamField key={p.name} schema={p} value={values[p.name]} changed={changed.includes(p.name)} onChange={(v) => set(p.name, v)} />
              ))}
            </fieldset>
          ))}
          <CutoutEditor cutouts={spec.cutouts ?? []} size={size} onChange={(cutouts) => setSpec((s) => ({ ...s, cutouts }))} />
          {(changed.length > 0 || !!spec.cutouts?.length) && (
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
  // flat number lists of any length (e.g. slot cells): edited as "0, 2"
  if (Array.isArray(value) && value.every((v) => typeof v === "number") && schema.min === undefined)
    return <ListField label={label} value={value as number[]} onChange={onChange} />;
  if (Array.isArray(value))
    return (
      <label className="param">
        {label}
        <span className="row gap-s wrap">
          {value.map((v, i) =>
            Array.isArray(v) ? (
              <code key={i}>{JSON.stringify(v)}</code>
            ) : (
              <NumberInput
                key={i}
                step={schema.step ?? 1}
                value={v as number}
                onChange={(val) => {
                  const n = [...value];
                  n[i] = val;
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
        <NumberInput step={schema.step ?? 1} min={schema.min} max={schema.max} value={value} onChange={onChange} />
      </label>
    );
  return (
    <label className="param">
      {label}
      <input value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ListField({ label, value, onChange }: { label: React.ReactNode; value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <label className="param">
      {label}
      <input
        value={text}
        placeholder="none, e.g. 0, 1"
        onChange={(e) => {
          setText(e.target.value);
          const nums = e.target.value.split(/[\s,;]+/).filter(Boolean).map(Number);
          if (nums.every((n) => Number.isFinite(n))) onChange(nums);
        }}
      />
    </label>
  );
}

/** Rectangles removed through the full height of the part (e.g. the notch of a wing plate). */
function CutoutEditor({ cutouts, size, onChange }: { cutouts: Cutout[]; size?: number[]; onChange: (c: Cutout[]) => void }) {
  const [open, setOpen] = useState(cutouts.length > 0);
  const upd = (i: number, patch: Partial<Cutout>) => onChange(cutouts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <>
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Cut-outs {cutouts.length > 0 && `(${cutouts.length})`}
      </button>
      {open && (
        <fieldset>
          <legend>Cut-outs</legend>
          <p className="muted small">
            Remove a rectangle through the whole part, in studs from the part's corner. <span className="axis-x">X</span> runs along the first size value,{" "}
            <span className="axis-y">Y</span> along the second (see the arrows in the preview).
          </p>
          {cutouts.map((c, i) => (
            <div key={i}>
            <div className="cutout-row">
              <label>
                X <NumberInput value={c.x} step={0.5} min={-64} max={64} onChange={(x) => upd(i, { x })} />
              </label>
              <label>
                Y <NumberInput value={c.y} step={0.5} min={-64} max={64} onChange={(y) => upd(i, { y })} />
              </label>
              <label>
                Length <NumberInput value={c.w} step={0.5} min={0} max={64} onChange={(w) => upd(i, { w })} />
              </label>
              <label>
                Width <NumberInput value={c.d} step={0.5} min={0} max={64} onChange={(d) => upd(i, { d })} />
              </label>
              <button className="icon danger" onClick={() => onChange(cutouts.filter((_, j) => j !== i))} aria-label="Remove cut-out">
                ✕
              </button>
            </div>
            {size && (c.x >= size[0] || c.y >= size[1] || c.x + c.w <= 0 || c.y + c.d <= 0) && (
              <div className="warn-text small">
                This cut-out is outside the part ({size[0]} × {size[1]} studs), so it removes nothing. X can be 0 to {size[0] - 1}, Y 0 to {size[1] - 1}.
              </div>
            )}
            </div>
          ))}
          {cutouts.length > 0 && <p className="muted small">The red box in the preview shows where each cut-out is.</p>}
          <button onClick={() => onChange([...cutouts, { x: 0, y: Math.max(0, (size?.[1] ?? 2) - 1), w: 1, d: 1 }])}>+ Add cut-out</button>
        </fieldset>
      )}
    </>
  );
}
