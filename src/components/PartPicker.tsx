import { useMemo, useRef, useState } from "react";
import { specKey, specName, suggestForLegoName, type Suggestion } from "../lib/catalog";
import { resolveItem, usageByInvKey } from "../lib/model";
import { useStore } from "../lib/store";
import type { ColorRef, InventoryPart, PartSpec, Project } from "../lib/types";
import { ColoredPart, LibraryBrowser, SpecIcon } from "./Library";
import { PartEditor } from "./PartEditor";
import { Modal, Swatch } from "./ui";

type PickerTab = "used" | "set" | "library";

interface UsedPart {
  key: string;
  invKey?: string;
  spec?: PartSpec;
  color: ColorRef;
  title: string;
  subtitle?: string;
  hex: string;
  colorName: string;
  imgUrl?: string;
  /** spec used to render the thumbnail (explicit or via the LEGO part's match) */
  renderSpec?: PartSpec;
  qty: number;
  steps: string[];
  remaining?: number;
  lastIndex: number;
}

/** Every distinct part + color already placed in the build, most recently used first. */
function collectUsedParts(project: Project): UsedPart[] {
  const used = usageByInvKey(project);
  const m = new Map<string, UsedPart>();
  project.steps.forEach((s, idx) => {
    for (const i of s.items) {
      const r = resolveItem(project, i);
      const key = `${i.invKey ?? ""}|${i.spec ? specKey(i.spec) : ""}|${JSON.stringify(i.color)}`;
      const e = m.get(key);
      if (e) {
        e.qty += i.qty;
        if (!e.steps.includes(s.label)) e.steps.push(s.label);
        e.lastIndex = idx;
        continue;
      }
      m.set(key, {
        key,
        invKey: i.invKey,
        spec: i.spec,
        color: i.color,
        title: r.title,
        subtitle: r.subtitle,
        hex: r.color.hex,
        colorName: r.color.name,
        imgUrl: r.inv?.imgUrl,
        renderSpec: r.spec,
        qty: i.qty,
        steps: [s.label],
        remaining: r.inv ? r.inv.qty - (used.get(r.inv.key) ?? 0) : undefined,
        lastIndex: idx,
      });
    }
  });
  return [...m.values()].sort((a, b) => b.lastIndex - a.lastIndex);
}

function UsedPartsList({ parts, onAdd }: { parts: UsedPart[]; onAdd: (u: UsedPart) => void }) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const list = parts.filter((u) => !q || `${u.title} ${u.subtitle ?? ""} ${u.colorName}`.toLowerCase().includes(q));
  if (!parts.length)
    return (
      <div className="empty">
        <p>Nothing used yet.</p>
        <p className="muted">Parts you add to any step show up here, so you can reuse the same part and color with one click.</p>
      </div>
    );
  return (
    <div>
      <input autoFocus className="search" placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="muted small">Same part and color as in earlier steps. Click to add one to this step. Most recently used first (as of opening this panel).</p>
      <div className="inv-grid">
        {list.map((u) => (
          <button key={u.key} className="inv-card used-card" onClick={() => onAdd(u)} title="Add one to this step">
            <div className="inv-main">
              <div className="inv-img">{u.renderSpec ? <ColoredPart spec={u.renderSpec} hex={u.hex} size={52} badge={u.imgUrl} /> : u.imgUrl ? <img src={u.imgUrl} alt="" /> : null}</div>
              <div className="inv-text">
                <div className="inv-name">
                  {u.title}
                </div>
                <div className="muted small">
                  <Swatch color={{ name: u.colorName, hex: u.hex }} size={10} /> {u.colorName}
                </div>
                <div className="small muted">
                  {u.qty}× in step{u.steps.length > 1 ? "s" : ""} {u.steps.join(", ")}
                </div>
                {u.remaining !== undefined && <div className={`small ${u.remaining <= 0 ? "warn-text" : ""}`}>{u.remaining > 0 ? `${u.remaining} left in set` : "none left in set"}</div>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Add parts to a step: reuse parts from earlier steps, pick from the set inventory, or from the Part library. */
export function PartPicker({ stepId, onClose }: { stepId: string; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const addItem = useStore((s) => s.addItem);
  const hasInventory = project.inventory.length > 0;
  const usedPartsLive = useMemo(() => collectUsedParts(project), [project]);
  // Keep the order fixed while the picker is open, so cards don't jump when clicked.
  // The first time, parts are ranked most-recently-used first; parts that appear later go on top.
  const order = useRef<Map<string, number> | null>(null);
  const usedParts = useMemo(() => {
    if (!order.current) order.current = new Map(usedPartsLive.map((u, i) => [u.key, i]));
    const ranks = order.current;
    let top = Math.min(0, ...ranks.values());
    for (const u of usedPartsLive) if (!ranks.has(u.key)) ranks.set(u.key, --top);
    return [...usedPartsLive].sort((a, b) => ranks.get(a.key)! - ranks.get(b.key)!);
  }, [usedPartsLive]);
  const [tab, setTabState] = useState<PickerTab>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("bp.pickerTab");
    } catch {
      /* ignore */
    }
    if (saved === "used" && usedParts.length) return "used";
    if (saved === "library") return "library";
    if (saved === "set" && hasInventory) return "set";
    return usedParts.length ? "used" : hasInventory ? "set" : "library";
  });
  const setTab = (t: PickerTab) => {
    setTabState(t);
    try {
      localStorage.setItem("bp.pickerTab", t);
    } catch {
      /* ignore */
    }
  };
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
        <button className={tab === "used" ? "active" : ""} onClick={() => setTab("used")} title="Parts you already used in earlier steps">
          Used in this build <span className="badge">{usedParts.length}</span>
        </button>
        <button className={tab === "set" ? "active" : ""} onClick={() => setTab("set")}>
          From set {project.set ? project.set.num : ""}
        </button>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>
          Part library
        </button>
      </div>
      {tab === "used" ? (
        <UsedPartsList
          parts={usedParts}
          onAdd={(u) => {
            addItem(stepId, { invKey: u.invKey, spec: u.spec, color: u.color, qty: 1 });
            added(`Added 1× ${u.title}`);
          }}
        />
      ) : tab === "set" ? (
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
        <LibraryBrowser onPick={(id) => setEditing({ presetId: id, overrides: {} })} />
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
      <p className="muted small">Click a part to add one to this step. The set's parts list says which LEGO parts exist; each LEGO part is printed as its matched part from the library.</p>
      <div className="inv-grid">
        {list.map((inv) => {
          const u = used.get(inv.key) ?? 0;
          const m = project.matches[inv.partNum];
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
              <button className={`inv-match ${m ? "" : "warn"}`} onClick={() => onMatch(inv)} title="Choose the part used to print this LEGO part">
                {m?.kind === "part" ? <SpecIcon spec={m.spec} size={28} /> : null}
                <span className="small">{m?.kind === "part" ? specName(m.spec) : m?.kind === "none" ? "Not printable" : "Match…"}</span>
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">Nothing left to place{q ? " for this filter" : ""}.</p>}
      </div>
    </div>
  );
}

/** Choose the printable part for a LEGO part (library → editor). */
export function MatchFlow({ inv, onDone }: { inv: InventoryPart; onDone: () => void }) {
  const project = useStore((s) => s.project)!;
  const setMatch = useStore((s) => s.setMatch);
  const existing = project.matches[inv.partNum];
  const [spec, setSpec] = useState<PartSpec | null>(existing?.kind === "part" ? existing.spec : null);
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
          setMatch(inv.partNum, { kind: "part", spec: s });
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
      <LibraryBrowser suggestions={suggestions} onPick={(id: string, s?: Suggestion) => setSpec(s?.spec ?? { presetId: id, overrides: {} })} />
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
