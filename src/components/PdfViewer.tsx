import { useEffect, useRef, useState } from "react";
import { loadPdf, renderPage, type PdfDoc } from "../lib/pdf";
import { useStore } from "../lib/store";
import type { Rect } from "../lib/types";
import { NumberInput } from "./ui";

export function usePdfDoc() {
  const blob = useStore((s) => s.pdfBlob);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  useEffect(() => {
    if (!blob) return setDoc(null);
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    loadPdf(blob).then((d) => {
      loaded = d;
      if (!cancelled) setDoc(d);
    });
    return () => {
      cancelled = true;
      loaded?.loadingTask.destroy();
    };
  }, [blob]);
  return doc;
}

export function PdfDropZone() {
  const project = useStore((s) => s.project)!;
  const setPdf = useStore((s) => s.setPdf);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const doc = await loadPdf(file);
      const info = { name: file.name, size: file.size, fingerprint: doc.fingerprints[0] ?? "", pages: doc.numPages };
      if (project.pdf && project.pdf.fingerprint && project.pdf.fingerprint !== info.fingerprint) {
        if (!confirm(`This project was created with "${project.pdf.name}". The selected PDF looks different. Use it anyway?`)) return;
      }
      await doc.loadingTask.destroy();
      await setPdf(file, info);
    } catch (e) {
      setError(`Could not open PDF: ${e}`);
    }
  }

  return (
    <label
      className={`dropzone ${drag ? "drag" : ""}`}
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
      <input type="file" accept="application/pdf" hidden onChange={(e) => handle(e.target.files?.[0])} />
      <div className="dropzone-inner">
        <div className="dropzone-icon">📄</div>
        <strong>{project.pdf ? `Re-attach "${project.pdf.name}"` : "Drop the building instructions PDF here"}</strong>
        <span className="muted">or click to choose a file. The PDF stays in this browser.</span>
        {error && <span className="error">{error}</span>}
      </div>
    </label>
  );
}

export function PdfViewer({ doc }: { doc: PdfDoc }) {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const steps = useStore((s) => s.project!.steps);
  const selectedStepId = useStore((s) => s.selectedStepId);
  const selectStep = useStore((s) => s.selectStep);
  const updateStep = useStore((s) => s.updateStep);
  const addStep = useStore((s) => s.addStep);

  const wrap = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<{ url: string; width: number; height: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const numPages = doc.numPages;

  // fit page into container
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!box.w) return;
    let cancelled = false;
    renderPage(doc, Math.min(page, numPages), box.w * window.devicePixelRatio).then((r) => !cancelled && setImg(r));
    return () => {
      cancelled = true;
    };
  }, [doc, page, box.w, numPages]);

  // prefetch neighbours
  useEffect(() => {
    if (!box.w) return;
    for (const p of [page + 1, page - 1]) if (p >= 1 && p <= numPages) renderPage(doc, p, box.w * window.devicePixelRatio);
  }, [doc, page, box.w, numPages]);

  // keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setPage(Math.min(numPages, page + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setPage(Math.max(1, page - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, numPages, setPage]);

  // compute displayed size (contain)
  let dw = 0, dh = 0;
  if (img && box.w && box.h) {
    const ar = img.width / img.height;
    dw = Math.min(box.w, box.h * ar);
    dh = dw / ar;
  }

  const pageSteps = steps.filter((s) => s.page === page);
  const selected = steps.find((s) => s.id === selectedStepId);

  const toNorm = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".step-rect")) return;
    const p = toNorm(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrawing({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = toNorm(e);
    setDrawing({ ...drawing, x1: p.x, y1: p.y });
  };
  const onPointerUp = () => {
    if (!drawing) return;
    const r: Rect = { x: Math.min(drawing.x0, drawing.x1), y: Math.min(drawing.y0, drawing.y1), w: Math.abs(drawing.x1 - drawing.x0), h: Math.abs(drawing.y1 - drawing.y0) };
    setDrawing(null);
    if (r.w < 0.02 || r.h < 0.02) return; // treat as click
    // Assign to the selected step if it's on this page and has no box yet, otherwise create a new step.
    if (selected && selected.page === page && !selected.rect) updateStep(selected.id, { rect: r });
    else {
      const id = addStep(page);
      updateStep(id, { rect: r });
    }
  };

  const draft = drawing && { x: Math.min(drawing.x0, drawing.x1), y: Math.min(drawing.y0, drawing.y1), w: Math.abs(drawing.x1 - drawing.x0), h: Math.abs(drawing.y1 - drawing.y0) };

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} title="Previous page (←)">
          ‹
        </button>
        <span>
          Page{" "}
          <NumberInput className="page-input" min={1} max={numPages} integer value={page} onChange={setPage} ariaLabel="Page" />{" "}
          / {numPages}
        </span>
        <button onClick={() => setPage(Math.min(numPages, page + 1))} disabled={page >= numPages} title="Next page (→)">
          ›
        </button>
        <span className="muted hint">Drag on the page to mark a step</span>
        <button className="primary" onClick={() => addStep(page)}>
          + New step on this page
        </button>
      </div>
      <div className="pdf-stage" ref={wrap}>
        {img && (
          <div className="pdf-page" style={{ width: dw, height: dh }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            <img src={img.url} alt={`Page ${page}`} draggable={false} />
            {pageSteps.map(
              (s) =>
                s.rect && (
                  <div
                    key={s.id}
                    className={`step-rect ${s.id === selectedStepId ? "selected" : ""}`}
                    style={{ left: `${s.rect.x * 100}%`, top: `${s.rect.y * 100}%`, width: `${s.rect.w * 100}%`, height: `${s.rect.h * 100}%` }}
                    onClick={() => selectStep(s.id)}
                  >
                    <span className="step-rect-label">
                      Step {s.label}
                      {s.items.length > 0 && ` · ${s.items.reduce((a, i) => a + i.qty, 0)} parts`}
                    </span>
                  </div>
                ),
            )}
            {draft && <div className="step-rect drawing" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small crop of a step's box from its page. */
export function StepCrop({ doc, page, rect, width = 96 }: { doc: PdfDoc; page: number; rect?: Rect; width?: number }) {
  const [img, setImg] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    let c = false;
    renderPage(doc, page, 800).then((r) => !c && setImg(r));
    return () => {
      c = true;
    };
  }, [doc, page]);
  if (!img) return <div className="step-crop" style={{ width, height: width * 0.7 }} />;
  const r = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  const pageAr = img.width / img.height;
  const cropAr = (r.w * pageAr) / r.h;
  const height = width / cropAr;
  const h = Math.min(height, width);
  const w = h * cropAr;
  return (
    <div className="step-crop" style={{ width: w, height: h }}>
      <img src={img.url} alt="" style={{ width: w / r.w, height: h / r.h, left: (-r.x * w) / r.w, top: (-r.y * h) / r.h }} draggable={false} />
    </div>
  );
}
