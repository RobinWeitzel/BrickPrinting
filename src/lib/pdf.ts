import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

export async function loadPdf(blob: Blob): Promise<PdfDoc> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Renders a page into an image URL (cached per doc/page/width). */
const cache = new WeakMap<PdfDoc, Map<string, Promise<{ url: string; width: number; height: number }>>>();

export function renderPage(doc: PdfDoc, pageNum: number, targetWidth: number) {
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  const w = Math.max(200, Math.round(targetWidth / 200) * 200); // bucket widths to limit re-renders
  const key = `${pageNum}@${w}`;
  let p = m.get(key);
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(pageNum);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: w / vp1.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvas, viewport: vp }).promise;
      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.9));
      return { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
    })();
    m.set(key, p);
  }
  return p;
}
