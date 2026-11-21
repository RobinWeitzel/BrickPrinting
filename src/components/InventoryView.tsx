import { useEffect, useState } from "react";
import { AUTO_MATCH_SCORE, partsById, specName, suggestForLegoName } from "../lib/catalog";
import { usageByInvKey } from "../lib/model";
import { DOWNLOADS_URL, RB_FILE_IDS, RB_FILES, importFiles, importedFiles, lookupSet, parseInventoryCsv, type RbFileId, type RbFileInfo, type SetLookupResult } from "../lib/rebrickable";
import { useStore } from "../lib/store";
import type { InventoryPart } from "../lib/types";
import { PartThumb } from "./Library";
import { MatchFlow } from "./PartPicker";
import { CustomColor, Modal, Swatch } from "./ui";

export function InventoryView({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const setInventory = useStore((s) => s.setInventory);
  const setMatch = useStore((s) => s.setMatch);
  const [setNum, setSetNum] = useState(project.set?.num ?? "");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [matching, setMatching] = useState<InventoryPart | null>(null);
  const [filter, setFilter] = useState<"all" | "unmatched">("all");
  const [notice, setNotice] = useState("");
  const [files, setFiles] = useState<Partial<Record<RbFileId, RbFileInfo>> | null>(null);

  useEffect(() => {
    importedFiles().then(setFiles);
  }, []);
  const missing = files ? RB_FILE_IDS.filter((id) => !files[id]) : [];

  const used = usageByInvKey(project);

  function apply(r: SetLookupResult) {
    if (project.inventory.length && !confirm(`Replace the current parts list (${project.inventory.length} lines) with ${r.set.num} ${r.set.name}? Parts already placed in steps keep their links where the part and color still exist.`)) return;
    setInventory(r.set, r.parts);
  }

  async function load() {
    setError("");
    try {
      apply(await lookupSet(setNum, setStatus));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setStatus("");
    }
  }

  async function loadCsv(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const parts = await parseInventoryCsv(await file.text());
      apply({ set: { num: setNum || file.name.replace(/\.csv$/i, ""), name: file.name }, parts });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  function autoMatch() {
    let n = 0;
    const done = new Set<string>();
    for (const inv of project.inventory) {
      if (project.matches[inv.partNum] || done.has(inv.partNum)) continue;
      const best = suggestForLegoName(inv.name)[0];
      if (best && best.score >= AUTO_MATCH_SCORE) {
        setMatch(inv.partNum, { kind: "mb", spec: best.spec });
        done.add(inv.partNum);
        n++;
      }
    }
    setNotice(n ? `Matched ${n} part types automatically. Please check them below.` : "No obvious matches found. Match the remaining parts by hand.");
  }

  const partNums = [...new Set(project.inventory.map((i) => i.partNum))];
  const unmatchedCount = partNums.filter((p) => !project.matches[p]).length;
  const rows = project.inventory.filter((i) => filter === "all" || !project.matches[i.partNum]);

  if (matching) return <MatchFlow inv={matching} onDone={() => setMatching(null)} />;

  return (
    <Modal title="Set parts list" onClose={onClose} wide>
      <RebrickableFiles files={files} onChange={() => importedFiles().then(setFiles)} />

      <section className="card">
        <h3>Load a set</h3>
        <div className="row gap wrap">
          <input value={setNum} onChange={(e) => setSetNum(e.target.value)} placeholder="Set number, e.g. 4488" className="set-input" onKeyDown={(e) => e.key === "Enter" && setNum.trim() && !missing.length && load()} />
          <button className="primary" onClick={load} disabled={!!status || !setNum.trim() || missing.length > 0}>
            {status || "Load parts list"}
          </button>
          <span className="muted small">or</span>
          <label className="button">
            Import a single set's CSV…
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => loadCsv(e.target.files?.[0])} />
          </label>
        </div>
        {missing.length > 0 && files && <p className="muted small">Import the Rebrickable data above to look up sets by number.</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {project.inventory.length > 0 && (
        <>
          <div className="row gap wrap inv-toolbar">
            {project.set?.imgUrl && <img src={project.set.imgUrl} alt="" className="set-img" />}
            <div>
              <strong>
                {project.set?.num} {project.set?.name}
              </strong>
              <div className="muted small">
                {project.inventory.reduce((a, i) => a + i.qty, 0)} parts · {partNums.length} part types · {unmatchedCount} not matched
              </div>
            </div>
            <span className="spacer" />
            <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "unmatched")}>
              <option value="all">Show all</option>
              <option value="unmatched">Only unmatched</option>
            </select>
            <button onClick={autoMatch} disabled={unmatchedCount === 0}>
              Auto-match obvious parts
            </button>
          </div>

          {notice && <div className="notice ok-notice">{notice}</div>}
          <ColorMapping />

          <table className="inv-table">
            <thead>
              <tr>
                <th />
                <th>LEGO part</th>
                <th>Color</th>
                <th className="num-cell">Qty</th>
                <th className="num-cell">Placed</th>
                <th>Printed as</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                const m = project.matches[inv.partNum];
                const mb = m?.kind === "mb" ? partsById.get(m.spec.presetId) : undefined;
                const u = used.get(inv.key) ?? 0;
                return (
                  <tr key={inv.key}>
                    <td>{inv.imgUrl && <img src={inv.imgUrl} alt="" className="inv-thumb" loading="lazy" />}</td>
                    <td>
                      {inv.name}
                      <div className="muted small">
                        #{inv.partNum}
                        {inv.isSpare && " · spare"}
                      </div>
                    </td>
                    <td>
                      <Swatch color={{ name: inv.colorName, hex: inv.colorHex }} /> <span className="small">{inv.colorName}</span>
                    </td>
                    <td className="num-cell">{inv.qty}</td>
                    <td className={`num-cell ${u >= inv.qty ? "ok" : ""}`}>{u}</td>
                    <td>
                      <button className={`match-btn ${m ? "" : "warn"}`} onClick={() => setMatching(inv)}>
                        {mb && <PartThumb part={mb} size={32} />}
                        <span>{m?.kind === "mb" ? specName(m.spec) : m?.kind === "none" ? "Not printable" : "Choose part…"}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/** Map LEGO colors to the user's filaments. */
function ColorMapping() {
  const project = useStore((s) => s.project)!;
  const filaments = useStore((s) => s.settings.filaments);
  const setColorMapping = useStore((s) => s.setColorMapping);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const colors = new Map<number, { name: string; hex: string }>();
  for (const i of project.inventory) colors.set(i.colorId, { name: i.colorName, hex: i.colorHex });

  return (
    <section className="card">
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Filament for each LEGO color ({Object.keys(project.colorMap).length} of {colors.size} mapped)
      </button>
      {open && (
        <div className="color-map">
          <p className="muted small">Parts that follow their LEGO color are printed in the filament chosen here. Add your filaments in Settings.</p>
          {[...colors].map(([id, c]) => {
            const mapped = project.colorMap[id];
            return (
              <div key={id} className="color-map-row">
                <Swatch color={c} /> <span className="color-map-name">{c.name}</span>
                <span className="muted">→</span>
                <select
                  value={mapped ? filaments.findIndex((f) => f.hex === mapped.hex && f.name === mapped.name) : -1}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    if (i === -2) setEditing(id);
                    else setColorMapping(id, i >= 0 ? filaments[i] : null);
                  }}
                >
                  <option value={-1}>Same as LEGO color</option>
                  {filaments.map((f, i) => (
                    <option key={i} value={i}>
                      {f.name}
                    </option>
                  ))}
                  {mapped && !filaments.some((f) => f.hex === mapped.hex && f.name === mapped.name) && <option value={-3}>{mapped.name}</option>}
                  <option value={-2}>Custom…</option>
                </select>
                {mapped && <Swatch color={mapped} />}
                {editing === id && (
                  <CustomColor
                    initial={mapped ?? c}
                    onPick={(col) => {
                      setColorMapping(id, col);
                      setEditing(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Status and import of the Rebrickable CSV downloads (stored only in this browser). */
function RebrickableFiles({ files, onChange }: { files: Partial<Record<RbFileId, RbFileInfo>> | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  if (!files) return null;
  const missing = RB_FILE_IDS.filter((id) => !files[id]);
  const oldest = Math.min(...RB_FILE_IDS.map((id) => files[id]?.importedAt ?? Infinity));
  const open = missing.length > 0 || busy || !!msg;

  async function handle(list: FileList | null | undefined) {
    if (!list?.length) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await importFiles([...list]);
      onChange();
      setMsg(
        [r.recognized.length ? `Imported ${r.recognized.map((x) => RB_FILES[x.as].file).join(", ")}.` : "", r.unknown.length ? `Ignored (not needed): ${r.unknown.join(", ")}.` : ""].filter(Boolean).join(" "),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`card rb-files ${drag ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files);
      }}
    >
      <div className="row gap wrap">
        <h3 className="grow">Rebrickable data</h3>
        {!missing.length && <span className="ok small">✓ imported {new Date(oldest).toLocaleDateString()}</span>}
        <label className="button">
          {busy ? "Importing…" : missing.length ? "Import files…" : "Update files…"}
          <input type="file" multiple accept=".gz,.csv,application/gzip,text/csv" hidden onChange={(e) => handle(e.target.files)} />
        </label>
      </div>
      {open && (
        <>
          <p className="small">
            LEGO manuals don't list part numbers, so parts lists come from{" "}
            <a href={DOWNLOADS_URL} target="_blank" rel="noreferrer">
              Rebrickable's free downloads
            </a>
            . Download these files once (no need to unzip) and drop them here. They stay in this browser.
          </p>
          <ul className="rb-list">
            {RB_FILE_IDS.map((id) => (
              <li key={id} className={files[id] ? "ok" : ""}>
                {files[id] ? "✓" : "○"} <code>{RB_FILES[id].file}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
