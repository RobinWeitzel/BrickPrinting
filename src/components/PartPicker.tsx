import { useMemo, useState } from "react";
import { partsById, specName, suggestForLegoName, type CatalogPart, type Suggestion } from "../lib/catalog";
import { resolveItem, usageByInvKey } from "../lib/model";
import { useStore } from "../lib/store";
import type { InventoryPart, PartSpec } from "../lib/types";
import { LibraryBrowser, PartThumb } from "./Library";
import { PartEditor } from "./PartEditor";
import { Modal, Swatch } from "./ui";

/** Add parts to a step: pick from the set inventory, or from the MachineBlocks library. */
export function PartPicker({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const addItem = useStore((s) => s.addItem);
  const hasInventory = project.inventory.length > 0;
  const [tab, setTab] = useState<"set" | "library">(hasInventory ? "set" : "library");
  const [editing, setEditing] = useState<PartSpec | null>(null);
  const [matching, setMatching] = useState<InventoryPart | null>(null);
  const [flash, setFlash] = useState("");

  const step = project.steps.find((s) => s.id === stepId)!;

  const added = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash((f) => (f === msg ? "" : f)), 1500);
  };

  if (editing)
    return (
      <PartEditor
        title={`Add to step ${step.label}`}
        spec={editing}
        qty={1}
        saveLabel="Add to step"
        onClose={() => setEditing(null)}
        onChangeBase={() => setEditing(null)}
        onSave={(spec, color, qty) => {
          addItem(stepId, { spec, color, qty });
          setEditing(null);
          added(`Added ${qty}× ${specName(spec)}`);
        }}
      />
    );

  if (matching) return <MatchFlow inv={matching} onDone={() => setMatching(null)} />;

  return (
    <Modal title={`Add parts to step ${step.label}`} onClose={onClose} wide footer={<>{flash && <span className="flash">✓ {flash}</span>}<span className="spacer" /><button className="primary" onClick={onClose}>Done</button></>}>
      <StepSummary stepId={stepId} />
      <div className="tabs">
        <button className={tab === "set" ? "active" : ""} onClick={() => setTab("set")}>
          From set {project.set ? project.set.num : ""}
        </button>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
          MachineBlocks library
        </button>
      </div>
      {tab === "set" ? (
        hasInventory ? (
          <InventoryPickList
            onAdd={(inv) => {
              addItem(stepId, { invKey: inv.key, color: { lego: inv.colorId }, qty: 1 });
              added(`Added 1× ${inv.name}`);
            }}
            onMatch={setMatching}
          />
        ) : (
          <div className="empty">
            <p>No set parts list loaded yet.</p>
            <p className="muted">Open “Set parts” in the top bar to load the LEGO set inventory from Rebrickable (or a CSV). Then you can pick parts exactly as listed in the set.</p>
          </div>
        )
      ) : (
        <LibraryBrowser onPick={(p) => setEditing({ presetId: p.id, overrides: {} })} />
      )}
    </Modal>
  );
}

function InventoryPickList({ onAdd, onMatch }: { onAdd: (inv: InventoryPart) => void; onMatch: (inv: InventoryPart) => void }) {
  const project = useStore((s) => s.project)!;
  const [query, setQuery] = useState("");
  const [hideDone, setHideDone] = useState(true);
  const used = usageByInvKey(project);
  const q = query.toLowerCase();
  const list = project.inventory.filter((i) => {
    if (hideDone && (used.get(i.key) ?? 0) >= i.qty) return false;
    return !q || `${i.partNum} ${i.name} ${i.colorName}`.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="row gap">
        <input autoFocus className="search grow" placeholder="Filter by name, number or color" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="row gap-s">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide fully placed
        </label>
      </div>
      <p className="muted small">Click a part to add one to this step. The set's parts list says which LEGO parts exist; each LEGO part is printed as its matched MachineBlocks part.</p>
      <div className="inv-grid">
        {list.map((inv) => {
          const u = used.get(inv.key) ?? 0;
          const m = project.matches[inv.partNum];
          const mbPart = m?.kind === "mb" ? partsById.get(m.spec.presetId) : undefined;
          return (
            <div key={inv.key} className={`inv-card ${u >= inv.qty ? "done" : ""}`}>
              <button className="inv-main" onClick={() => onAdd(inv)} title="Add one to this step">
                <div className="inv-img">{inv.imgUrl ? <img src={inv.imgUrl} alt="" loading="lazy" /> : null}</div>
                <div className="inv-text">
                  <div className="inv-name">{inv.name}</div>
                  <div className="muted small">
                    <Swatch color={{ name: inv.colorName, hex: inv.colorHex }} size={10} /> {inv.colorName} · #{inv.partNum}
                    {inv.isSpare && " · spare"}
                  </div>
                  <div className={`small ${u >= inv.qty ? "ok" : ""}`}>
                    {inv.qty - u} of {inv.qty} left
                  </div>
                </div>
              </button>
              <button className={`inv-match ${m ? "" : "warn"}`} onClick={() => onMatch(inv)} title="Choose the MachineBlocks part used to print this LEGO part">
                {mbPart ? <PartThumb part={mbPart} size={28} /> : null}
                <span className="small">{m?.kind === "mb" ? specName(m.spec) : m?.kind === "none" ? "Not printable" : "Match…"}</span>
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">Nothing left to place{q ? " for this filter" : ""}.</p>}
      </div>
    </div>
  );
}

/** Choose the MachineBlocks part for a LEGO part (library → editor). */
export function MatchFlow({ inv, onDone }: { inv: InventoryPart; onDone: () => void }) {
  const project = useStore((s) => s.project)!;
  const setMatch = useStore((s) => s.setMatch);
  const existing = project.matches[inv.partNum];
  const [spec, setSpec] = useState<PartSpec | null>(existing?.kind === "mb" ? existing.spec : null);
  const suggestions = useMemo(() => suggestForLegoName(inv.name), [inv.name]);

  if (spec)
    return (
      <PartEditor
        title={`Print “${inv.name}” as…`}
        spec={spec}
        legoColorId={inv.colorId}
        saveLabel="Use this part"
        onClose={onDone}
        onChangeBase={() => setSpec(null)}
        onSave={(s) => {
          setMatch(inv.partNum, { kind: "mb", spec: s });
          onDone();
        }}
      />
    );

  return (
    <Modal
      title={
        <span className="row gap">
          {inv.imgUrl && <img src={inv.imgUrl} alt="" className="title-img" />} Match “{inv.name}” (#{inv.partNum})
        </span>
      }
      onClose={onDone}
      wide
      footer={
        <>
          {existing && (
            <button
              onClick={() => {
                setMatch(inv.partNum, null);
                onDone();
              }}
            >
              Clear match
            </button>
          )}
          <span className="spacer" />
          <button
            onClick={() => {
              setMatch(inv.partNum, { kind: "none" });
              onDone();
            }}
          >
            Mark as not printable
          </button>
        </>
      }
    >
      <LibraryBrowser suggestions={suggestions} onPick={(p: CatalogPart, s?: Suggestion) => setSpec(s?.spec ?? { presetId: p.id, overrides: {} })} />
    </Modal>
  );
}

/** Compact list of what's already in the step, shown above the picker. */
function StepSummary({ stepId }: { stepId: string }) {
  const project = useStore((s) => s.project)!;
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const step = project.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const count = step.items.reduce((a, i) => a + i.qty, 0);
  return (
    <div className="step-summary">
      <div className="step-summary-title">
        In this step <span className="badge">{count}</span>
      </div>
      {step.items.length === 0 ? (
        <div className="muted small">Nothing yet. Pick parts below.</div>
      ) : (
        <div className="chips">
          {step.items.map((i) => {
            const r = resolveItem(project, i);
            return (
              <span key={i.id} className={`chip ${r.spec ? "" : "warn"}`} title={r.subtitle ?? r.title}>
                <Swatch color={r.color} size={12} />
                <button className="chip-qty" onClick={() => updateItem(stepId, i.id, { qty: i.qty + 1 })} title="Add one more">
                  {i.qty}×
                </button>
                <span className="chip-name">{r.title}</span>
                <button className="chip-x" onClick={() => (i.qty > 1 ? updateItem(stepId, i.id, { qty: i.qty - 1 }) : removeItem(stepId, i.id))} title={i.qty > 1 ? "Remove one" : "Remove"}>
                  −
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
