import { useEffect, useMemo, useState } from "react";
import { catalog, partsById, searchParts, thumbUrl, type CatalogPart, type Suggestion } from "../lib/catalog";
import { useStore } from "../lib/store";
import { LDRAW_DOWNLOAD_URL, LDRAW_SITE, importLDrawLib, ldrawLibInfo, removeLDrawLib, type LDrawLibInfo } from "../lib/ldraw";
import { partThumbnail } from "../lib/thumbs";
import type { PartSpec } from "../lib/types";

export function PartThumb({ part, size = 64 }: { part: CatalogPart; size?: number }) {
  const url = thumbUrl(part);
  return <div className="part-thumb" style={{ width: size, height: size }}>{url ? <img src={url} alt="" loading="lazy" /> : <span>?</span>}</div>;
}

/** A part rendered from its 3D model in the given color (falls back to the catalog thumbnail while loading). */
export function ColoredPart({ spec, hex, size = 40, badge }: { spec: PartSpec; hex: string; size?: number; badge?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const key = JSON.stringify(spec) + hex;
  useEffect(() => {
    let alive = true; // keep the previous image until the new one is ready (no flicker)
    partThumbnail(spec, hex)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const fallback = partsById.get(spec.presetId);
  return (
    <div className="colored-part" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : fallback ? <PartThumb part={fallback} size={size} /> : null}
      {badge && <img className="colored-part-badge" src={badge} alt="" title="LEGO part" />}
    </div>
  );
}

/** Thumbnail for a part spec: the catalog picture for presets, a rendered model for uploaded parts. */
export function SpecIcon({ spec, size = 32 }: { spec: PartSpec; size?: number }) {
  const p = partsById.get(spec.presetId);
  if (p && !spec.cutouts?.length) return <PartThumb part={p} size={size} />;
  return <ColoredPart spec={spec} hex="#9aa3ad" size={size} />;
}

/** Browsable MachineBlocks catalog plus the user's uploaded parts. */
export function LibraryBrowser({ onPick, suggestions, initialQuery = "" }: { onPick: (presetId: string, s?: Suggestion) => void; suggestions?: Suggestion[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [cat, setCat] = useState<string | undefined>(undefined);
  const results = useMemo(() => (cat === MINE ? [] : searchParts(query, cat)), [query, cat]);
  const customParts = useStore((s) => s.customParts);
  const q = query.trim().toLowerCase();
  const mine = customParts.filter((c) => !q || `${c.name} ${c.fileName}`.toLowerCase().includes(q));
  const showMine = cat === MINE || (!cat && q && mine.length > 0);

  return (
    <div className="library">
      <div className="library-side">
        <input autoFocus placeholder="Search, e.g. plate 2x4" value={query} onChange={(e) => setQuery(e.target.value)} className="search" />
        <button className={`cat mine ${cat === MINE ? "active" : ""}`} onClick={() => setCat(MINE)}>
          My parts <span className="muted">{customParts.length}</span>
        </button>
        <button className={`cat ${!cat ? "active" : ""}`} onClick={() => setCat(undefined)}>
          All parts <span className="muted">{catalog.parts.length}</span>
        </button>
        {catalog.categories.map((c) => (
          <button key={c.id} className={`cat ${cat === c.id ? "active" : ""}`} onClick={() => setCat(c.id)}>
            {c.name} <span className="muted">{catalog.parts.filter((p) => p.category === c.id).length}</span>
          </button>
        ))}
      </div>
      <div className="library-main">
        {cat === MINE && (
          <>
            <LDrawLibraryCard />
            <CustomUpload />
          </>
        )}
        {showMine && (
          <>
            {cat !== MINE && <h3 className="section-title">My parts</h3>}
            <div className="part-grid">
              {mine.map((c) => (
                <CustomCard key={c.id} id={c.id} onPick={() => onPick(c.id)} />
              ))}
              {cat === MINE && mine.length === 0 && <p className="muted">{q ? "No uploaded parts match." : "No uploaded parts yet."}</p>}
            </div>
            {cat !== MINE && <h3 className="section-title">MachineBlocks</h3>}
          </>
        )}
        {suggestions && suggestions.length > 0 && !query && !cat && (
          <>
            <h3 className="section-title">Suggested</h3>
            <div className="part-grid">
              {suggestions.map((s) => (
                <button key={s.part.id + JSON.stringify(s.spec.overrides)} className="part-card suggested" onClick={() => onPick(s.part.id, s)}>
                  <PartThumb part={s.part} size={88} />
                  <span>{s.part.name}</span>
                  {s.spec.overrides.size ? <span className="muted small">resized to {(s.spec.overrides.size as number[]).join("×")}</span> : null}
                </button>
              ))}
            </div>
            <h3 className="section-title">All parts</h3>
          </>
        )}
        {cat !== MINE && (
          <div className="part-grid">
            {results.map((p) => (
              <button key={p.id} className="part-card" onClick={() => onPick(p.id)}>
                <PartThumb part={p} size={88} />
                <span>{p.name}</span>
              </button>
            ))}
            {results.length === 0 && <p className="muted">No parts found. Try a different search, pick a similar part and change its size, or upload an STL under “My parts”.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const MINE = "__mine";

function CustomCard({ id, onPick }: { id: string; onPick: () => void }) {
  const meta = useStore((s) => s.customParts.find((c) => c.id === id))!;
  const rename = useStore((s) => s.renameCustomPart);
  const remove = useStore((s) => s.removeCustomPart);
  return (
    <div className="part-card custom-card">
      <button className="custom-pick" onClick={onPick} title={`${meta.fileName} · ${meta.size.map((v) => v.toFixed(1)).join(" × ")} mm`}>
        <ColoredPart spec={{ presetId: id, overrides: {} }} hex="#9aa3ad" size={88} />
        <span>{meta.name}</span>
        <span className="muted small">{meta.size.map((v) => v.toFixed(1)).join(" × ")} mm</span>
      </button>
      <div className="custom-actions">
        <button
          className="link small"
          onClick={() => {
            const n = prompt("Name of this part", meta.name);
            if (n?.trim()) rename(id, n.trim());
          }}
        >
          Rename
        </button>
        <button
          className="link small danger"
          onClick={() => {
            if (confirm(`Delete "${meta.name}" from this browser? Steps that use it will show it as missing.`)) remove(id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CustomUpload() {
  const upload = useStore((s) => s.uploadCustomParts);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function handle(list: FileList | null | undefined) {
    if (!list?.length) return;
    setBusy(true);
    setMsg("");
    const r = await upload([...list]);
    setBusy(false);
    setMsg([r.added.length ? `Added ${r.added.map((a) => a.name).join(", ")}.` : "", ...r.errors].filter(Boolean).join(" "));
  }
  return (
    <label
      className={`dropzone small-drop ${drag ? "drag" : ""}`}
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
      <input type="file" accept=".stl,.dat,.ldr,model/stl,application/sla" multiple hidden onChange={(e) => handle(e.target.files)} />
      <div className="dropzone-inner">
        <strong>{busy ? "Reading…" : "Drop STL or LDraw (.dat) files here, or click to upload"}</strong>
        <span className="muted small">
          For parts MachineBlocks can't make. STL: e.g. from Printables or Thingiverse, in millimeters; the file's orientation is kept, so upload it the way it should print. LDraw .dat files are converted using the
          imported LDraw library (studs up). Stored in this browser only.
        </span>
        {msg && <span className="small">{msg}</span>}
      </div>
    </label>
  );
}

/** Status / import of the LDraw parts library (complete.zip), stored in this browser. */
export function useLDrawLib() {
  const [info, setInfo] = useState<LDrawLibInfo | null | undefined>(undefined);
  const refresh = () => ldrawLibInfo().then(setInfo, () => setInfo(null));
  useEffect(() => {
    refresh();
  }, []);
  return { info, refresh };
}

function LDrawLibraryCard() {
  const { info, refresh } = useLDrawLib();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  async function handle(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      await importLDrawLib(f);
      await refresh();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }
  if (info === undefined) return null;
  return (
    <div
      className={`card ldraw-card ${drag ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files[0]);
      }}
    >
      <div className="row gap wrap">
        <strong className="grow">LDraw parts library</strong>
        {info ? (
          <span className="ok small">
            ✓ {info.parts.toLocaleString()} parts, imported {new Date(info.importedAt).toLocaleDateString()}
          </span>
        ) : (
          <span className="muted small">not imported</span>
        )}
        <label className="button">
          {busy ? "Importing…" : info ? "Update…" : "Import complete.zip…"}
          <input type="file" accept=".zip,application/zip" hidden onChange={(e) => handle(e.target.files?.[0])} />
        </label>
        {info && (
          <button
            className="link small danger"
            onClick={async () => {
              if (confirm("Remove the LDraw library from this browser? Parts you already converted stay.")) {
                await removeLDrawLib();
                refresh();
              }
            }}
          >
            Remove
          </button>
        )}
      </div>
      {!info && (
        <p className="small">
          With the official{" "}
          <a href={LDRAW_SITE} target="_blank" rel="noreferrer">
            LDraw
          </a>{" "}
          library, almost every LEGO part can be converted to a printable model, either automatically by its part number when you match a part, or from .dat files you download. Download{" "}
          <a href={LDRAW_DOWNLOAD_URL}>complete.zip</a> (about 150 MB) once and drop it here. It stays in this browser.
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
