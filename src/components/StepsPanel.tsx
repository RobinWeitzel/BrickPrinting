import { useEffect, useRef, useState } from "react";
import { partsById } from "../lib/catalog";
import { buildBom, resolveItem } from "../lib/model";
import type { PdfDoc } from "../lib/pdf";
import { useStore } from "../lib/store";
import type { Step, StepItem } from "../lib/types";
import { PartThumb } from "./Library";
import { MatchFlow, PartPicker } from "./PartPicker";
import { PartEditor } from "./PartEditor";
import { StepCrop } from "./PdfViewer";
import { ColorPicker, Qty, Swatch } from "./ui";

export function StepsPanel({ doc }: { doc: PdfDoc | null }) {
  const [tab, setTab] = useState<"steps" | "totals">("steps");
  const project = useStore((s) => s.project)!;
  const total = project.steps.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0);
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === "steps" ? "active" : ""} onClick={() => setTab("steps")}>
          Steps <span className="badge">{project.steps.length}</span>
        </button>
        <button className={tab === "totals" ? "active" : ""} onClick={() => setTab("totals")}>
          Parts so far <span className="badge">{total}</span>
        </button>
      </div>
      {tab === "steps" ? <StepList doc={doc} /> : <Totals />}
    </aside>
  );
}

function StepList({ doc }: { doc: PdfDoc | null }) {
  const steps = useStore((s) => s.project!.steps);
  const selectedStepId = useStore((s) => s.selectedStepId);
  const selectStep = useStore((s) => s.selectStep);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(".step.selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedStepId]);

  if (steps.length === 0)
    return (
      <div className="empty">
        <p>No steps yet.</p>
        <p className="muted">Drag a box around a step in the instructions, or click “+ New step on this page”.</p>
      </div>
    );

  return (
    <div className="step-list" ref={listRef}>
      {steps.map((s) => (
        <div key={s.id} className={`step ${s.id === selectedStepId ? "selected" : ""}`}>
          <button className="step-head" onClick={() => selectStep(s.id === selectedStepId ? null : s.id)}>
            {doc && <StepCrop doc={doc} page={s.page} rect={s.rect} width={72} />}
            <div className="step-meta">
              <strong>Step {s.label}</strong>
              <span className="muted small">
                page {s.page} · {s.items.reduce((a, i) => a + i.qty, 0)} parts
              </span>
            </div>
          </button>
          {s.id === selectedStepId && <StepDetail step={s} />}
        </div>
      ))}
    </div>
  );
}

function StepDetail({ step }: { step: Step }) {
  const updateStep = useStore((s) => s.updateStep);
  const deleteStep = useStore((s) => s.deleteStep);
  const [picking, setPicking] = useState(false);
  return (
    <div className="step-detail">
      <div className="row gap wrap">
        <label className="row gap-s small">
          Label <input className="label-input" value={step.label} onChange={(e) => updateStep(step.id, { label: e.target.value })} />
        </label>
        {step.rect && (
          <button className="link small" onClick={() => updateStep(step.id, { rect: undefined })}>
            Remove box
          </button>
        )}
        <span className="spacer" />
        <button
          className="link danger small"
          onClick={() => {
            if (step.items.length === 0 || confirm(`Delete step ${step.label} and its ${step.items.length} part entries?`)) deleteStep(step.id);
          }}
        >
          Delete step
        </button>
      </div>
      <div className="items">
        {step.items.map((i) => (
          <ItemRow key={i.id} step={step} item={i} />
        ))}
        {step.items.length === 0 && <p className="muted small">No parts in this step yet.</p>}
      </div>
      <button className="primary full" onClick={() => setPicking(true)}>
        + Add parts
      </button>
      {picking && <PartPicker stepId={step.id} onClose={() => setPicking(false)} />}
    </div>
  );
}

function ItemRow({ step, item }: { step: Step; item: StepItem }) {
  const project = useStore((s) => s.project)!;
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const [editing, setEditing] = useState(false);
  const r = resolveItem(project, item);
  const mb = r.spec ? partsById.get(r.spec.presetId) : undefined;

  return (
    <div className="item">
      <div className="item-img">{r.inv?.imgUrl ? <img src={r.inv.imgUrl} alt="" /> : mb ? <PartThumb part={mb} size={40} /> : null}</div>
      <div className="item-text">
        <button className="link item-title" onClick={() => setEditing(true)} title={r.inv ? "Change the MachineBlocks part for this LEGO part" : "Edit part"}>
          {r.title}
        </button>
        {r.subtitle && <div className={`small ${r.spec ? "muted" : "warn-text"}`}>{r.subtitle}</div>}
        <div className="row gap-s">
          <ColorPicker value={item.color} onChange={(color) => updateItem(step.id, item.id, { color })} legoColorId={r.inv?.colorId} />
        </div>
      </div>
      <div className="item-actions">
        <Qty value={item.qty} onChange={(qty) => updateItem(step.id, item.id, { qty })} />
        <button className="icon danger" onClick={() => removeItem(step.id, item.id)} aria-label="Remove">
          ✕
        </button>
      </div>
      {editing && r.inv && <MatchFlow inv={r.inv} onDone={() => setEditing(false)} />}
      {editing && !r.inv && r.spec && (
        <PartEditor
          title="Edit part"
          spec={r.spec}
          color={item.color}
          qty={item.qty}
          saveLabel="Save"
          onClose={() => setEditing(false)}
          onSave={(spec, color, qty) => {
            updateItem(step.id, item.id, { spec, color, qty });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function Totals() {
  const project = useStore((s) => s.project)!;
  const bom = buildBom(project, { includeUnplacedInventory: false, includeSpares: false });
  if (!bom.lines.length && !bom.unmatched.length) return <div className="empty muted">Parts you add to steps are totalled here.</div>;
  return (
    <div className="totals">
      {bom.unmatched.length > 0 && (
        <div className="notice warn">
          {bom.unmatched.reduce((a, u) => a + u.qty, 0)} placed parts have no MachineBlocks match yet and won't be exported.
        </div>
      )}
      <table>
        <tbody>
          {bom.lines.map((l) => {
            const p = partsById.get(l.spec.presetId);
            return (
              <tr key={l.key}>
                <td className="num-cell">{l.qty}×</td>
                <td>{p && <PartThumb part={p} size={32} />}</td>
                <td>
                  {l.name}
                  <div className="muted small">steps {l.steps.join(", ")}</div>
                </td>
                <td>
                  <Swatch color={l.color} /> <span className="small">{l.color.name}</span>
                </td>
              </tr>
            );
          })}
          {bom.unmatched.map((u) => (
            <tr key={u.title + u.color.hex} className="unmatched">
              <td className="num-cell">{u.qty}×</td>
              <td />
              <td>
                {u.title}
                <div className="warn-text small">not matched · steps {u.steps.join(", ")}</div>
              </td>
              <td>
                <Swatch color={u.color} /> <span className="small">{u.color.name}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
