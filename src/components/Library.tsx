import { useMemo, useState } from "react";
import { catalog, searchParts, thumbUrl, type CatalogPart, type Suggestion } from "../lib/catalog";

export function PartThumb({ part, size = 64 }: { part: CatalogPart; size?: number }) {
  const url = thumbUrl(part);
  return <div className="part-thumb" style={{ width: size, height: size }}>{url ? <img src={url} alt="" loading="lazy" /> : <span>?</span>}</div>;
}

/** Browsable MachineBlocks catalog. */
export function LibraryBrowser({ onPick, suggestions, initialQuery = "" }: { onPick: (p: CatalogPart, s?: Suggestion) => void; suggestions?: Suggestion[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [cat, setCat] = useState<string | undefined>(undefined);
  const results = useMemo(() => searchParts(query, cat), [query, cat]);

  return (
    <div className="library">
      <div className="library-side">
        <input autoFocus placeholder="Search, e.g. plate 2x4" value={query} onChange={(e) => setQuery(e.target.value)} className="search" />
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
        {suggestions && suggestions.length > 0 && !query && !cat && (
          <>
            <h3 className="section-title">Suggested</h3>
            <div className="part-grid">
              {suggestions.map((s) => (
                <button key={s.part.id + JSON.stringify(s.spec.overrides)} className="part-card suggested" onClick={() => onPick(s.part, s)}>
                  <PartThumb part={s.part} size={88} />
                  <span>{s.part.name}</span>
                  {s.spec.overrides.size ? <span className="muted small">resized to {(s.spec.overrides.size as number[]).join("×")}</span> : null}
                </button>
              ))}
            </div>
            <h3 className="section-title">All parts</h3>
          </>
        )}
        <div className="part-grid">
          {results.map((p) => (
            <button key={p.id} className="part-card" onClick={() => onPick(p)}>
              <PartThumb part={p} size={88} />
              <span>{p.name}</span>
            </button>
          ))}
          {results.length === 0 && <p className="muted">No parts found. Try a different search or pick a similar part and change its size.</p>}
        </div>
      </div>
    </div>
  );
}
