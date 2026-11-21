import { useEffect, useState } from "react";
import { catalog } from "./lib/catalog";
import { download } from "./lib/export";
import { useStore } from "./lib/store";
import type { Project } from "./lib/types";
import { ExportDialog } from "./components/ExportDialog";
import { InventoryView } from "./components/InventoryView";
import { PdfDropZone, PdfViewer, usePdfDoc } from "./components/PdfViewer";
import { SettingsDialog } from "./components/SettingsDialog";
import { StepsPanel } from "./components/StepsPanel";

export default function App() {
  const ready = useStore((s) => s.ready);
  const project = useStore((s) => s.project);
  const init = useStore((s) => s.init);
  useEffect(() => {
    init();
  }, [init]);
  if (!ready) return <div className="loading">Loading…</div>;
  return project ? <Workspace /> : <Home />;
}

function Home() {
  const projects = useStore((s) => s.projects);
  const createProject = useStore((s) => s.createProject);
  const openProject = useStore((s) => s.openProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const importProject = useStore((s) => s.importProject);
  const [name, setName] = useState("");

  async function importJson(file: File | undefined) {
    if (!file) return;
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (!p.id || !Array.isArray(p.steps)) throw new Error("Not a BrickPrinting project file.");
      await importProject(p);
    } catch (e) {
      alert(String(e));
    }
  }

  return (
    <div className="home">
      <header className="home-head">
        <h1>🧱 BrickPrinting</h1>
        <p className="muted">Turn LEGO building instructions into a list of 3D-printable MachineBlocks parts, step by step.</p>
      </header>
      <section className="card">
        <h3>New project</h3>
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            createProject(name.trim() || "Untitled build");
          }}
        >
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. 4488 Millennium Falcon" autoFocus />
          <button className="primary">Create</button>
          <label className="button">
            Import project…
            <input type="file" accept=".json,application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
          </label>
        </form>
      </section>
      {projects.length > 0 && (
        <section className="card">
          <h3>Your projects</h3>
          <div className="project-list">
            {[...projects]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((p) => (
                <div key={p.id} className="project-row">
                  <button className="link project-name" onClick={() => openProject(p.id)}>
                    {p.name}
                  </button>
                  <span className="muted small">
                    {p.steps} steps · edited {new Date(p.updatedAt).toLocaleString()}
                  </span>
                  <button className="icon danger" onClick={() => confirm(`Delete project "${p.name}"? This cannot be undone.`) && deleteProject(p.id)} aria-label="Delete">
                    ✕
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}
      <footer className="muted small">
        Parts from{" "}
        <a href={catalog.source} target="_blank" rel="noreferrer">
          MachineBlocks
        </a>{" "}
        by Jan Philipp Knoeller (CC BY-NC-SA 4.0, rev {catalog.revision}). Set parts lists come from Rebrickable downloads that you import yourself. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this tool. Everything is stored locally in your browser.
      </footer>
    </div>
  );
}

function Workspace() {
  const project = useStore((s) => s.project)!;
  const updateProject = useStore((s) => s.updateProject);
  const openProject = useStore((s) => s.openProject);
  const pdfBlob = useStore((s) => s.pdfBlob);
  const doc = usePdfDoc();
  const [dialog, setDialog] = useState<null | "inventory" | "export" | "settings">(null);

  const unmatched = new Set(project.inventory.filter((i) => !project.matches[i.partNum]).map((i) => i.partNum)).size;

  return (
    <div className="workspace">
      <header className="topbar">
        <button className="link brand" onClick={() => openProject(null)} title="All projects">
          🧱
        </button>
        <input className="project-title" value={project.name} onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))} />
        <span className="spacer" />
        <button onClick={() => setDialog("inventory")}>
          Set parts {project.set ? `(${project.set.num})` : ""}
          {unmatched > 0 && <span className="badge warn">{unmatched} unmatched</span>}
        </button>
        <button className="primary" onClick={() => setDialog("export")}>
          Export
        </button>
        <button onClick={() => download(new Blob([JSON.stringify(project, null, 1)], { type: "application/json" }), `${project.name}.brickprinting.json`)} title="Download a backup of this project (without the PDF)">
          Save backup
        </button>
        <button className="icon" onClick={() => setDialog("settings")} title="Settings" aria-label="Settings">
          ⚙
        </button>
      </header>
      <main className="workspace-main">
        <section className="pdf-area">{pdfBlob ? doc ? <PdfViewer doc={doc} /> : <div className="loading">Opening PDF…</div> : <PdfDropZone />}</section>
        <StepsPanel doc={doc} />
      </main>
      {dialog === "inventory" && <InventoryView onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
