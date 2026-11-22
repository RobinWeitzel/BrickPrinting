import { useEffect, useMemo, useState } from "react";
import { catalog, partsById, searchParts, specName, thumbUrl, type CatalogPart, type Suggestion } from "../lib/catalog";
import { partThumbnail } from "../lib/thumbs";
import type { PartSpec } from "../lib/types";

export function PartThumb({ part, size = 64 }: { part: CatalogPart; size?: number }) {
  return (
    <div className="part-thumb" style={{ width: size, height: size }}>
      <img src={thumbUrl(part)} alt="" loading="lazy" />
    </div>
  );
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

/** Thumbnail for a part spec: the catalog picture for unchanged presets, otherwise the rendered model. */
export function SpecIcon({ spec, size = 32 }: { spec: PartSpec; size?: number }) {
  const p = partsById.get(spec.presetId);
  if (p && !spec.cutouts?.length && Object.keys(spec.overrides).length === 0) return <PartThumb part={p} size={size} />;
  return <ColoredPart spec={spec} hex="#9aa3ad" size={size} />;
}

/** Browsable part library: the base set, grouped by category. Every part can be resized and customized after picking. */
export function LibraryBrowser({ onPick, suggestions, initialQuery = "" }: { onPick: (presetId: string, s?: Suggestion) => void; suggestions?: Suggestion[]; initialQuery?: string }) {
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
                <button key={s.part.id + JSON.stringify(s.spec.overrides)} className="part-card suggested" onClick={() => onPick(s.part.id, s)}>
                  <SpecIcon spec={s.spec} size={88} />
                  <span>{specName(s.spec)}</span>
                  {Object.keys(s.spec.overrides).length > 0 ? <span className="muted small">from {s.part.name}</span> : null}
                </button>
              ))}
            </div>
            <h3 className="section-title">All parts</h3>
          </>
        )}
        <div className="part-grid">
          {results.map((p) => (
            <button key={p.id} className="part-card" onClick={() => onPick(p.id)}>
              <PartThumb part={p} size={88} />
              <span>{p.name}</span>
            </button>
          ))}
          {results.length === 0 && <p className="muted">No parts found. Try a different search, or pick a similar part and change its size and parameters.</p>}
        </div>
      </div>
    </div>
  );
}
