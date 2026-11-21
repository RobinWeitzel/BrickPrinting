import { del, get, set } from "idb-keyval";
import { create } from "zustand";
import type { Color, InventoryPart, Match, Project, ProjectSummary, Settings, Step, StepItem } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const DEFAULT_SETTINGS: Settings = {
  filaments: [],
  plate: { width: 256, depth: 256, spacing: 4 },
};

interface State {
  ready: boolean;
  settings: Settings;
  projects: ProjectSummary[];
  project: Project | null;
  pdfBlob: Blob | null;
  page: number;
  selectedStepId: string | null;

  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;

  createProject(name: string): Promise<void>;
  openProject(id: string | null): Promise<void>;
  deleteProject(id: string): Promise<void>;
  importProject(p: Project): Promise<void>;
  updateProject(fn: (p: Project) => Project): void;

  setPdf(file: File, info: Project["pdf"]): Promise<void>;
  setPage(page: number): void;

  addStep(page: number): string;
  updateStep(id: string, patch: Partial<Step>): void;
  deleteStep(id: string): void;
  selectStep(id: string | null): void;

  addItem(stepId: string, item: Omit<StepItem, "id">): void;
  updateItem(stepId: string, itemId: string, patch: Partial<StepItem>): void;
  removeItem(stepId: string, itemId: string): void;

  setInventory(set: Project["set"], inv: InventoryPart[]): void;
  setMatch(partNum: string, match: Match | null): void;
  setColorMapping(colorId: number, color: Color | null): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function summarize(p: Project): ProjectSummary {
  return { id: p.id, name: p.name, updatedAt: p.updatedAt, steps: p.steps.length };
}

export const useStore = create<State>((setState, getState) => {
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const { project, projects } = getState();
      if (!project) return;
      await set(`project:${project.id}`, project);
      const list = [summarize(project), ...projects.filter((x) => x.id !== project.id)];
      await set("projects", list);
      setState({ projects: list });
    }, 300);
  };

  const update = (fn: (p: Project) => Project) => {
    const p = getState().project;
    if (!p) return;
    setState({ project: { ...fn(p), updatedAt: Date.now() } });
    persist();
  };

  const updateSteps = (fn: (steps: Step[]) => Step[]) => update((p) => ({ ...p, steps: fn(p.steps) }));

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    projects: [],
    project: null,
    pdfBlob: null,
    page: 1,
    selectedStepId: null,

    async init() {
      const [settings, projects, lastId] = await Promise.all([get<Settings>("settings"), get<ProjectSummary[]>("projects"), get<string>("lastProject")]);
      setState({ settings: { ...DEFAULT_SETTINGS, ...settings }, projects: projects ?? [], ready: true });
      if (lastId && projects?.some((p) => p.id === lastId)) await getState().openProject(lastId);
    },

    updateSettings(patch) {
      const s = { ...getState().settings, ...patch };
      setState({ settings: s });
      set("settings", s);
    },

    async createProject(name) {
      const p: Project = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), inventory: [], matches: {}, colorMap: {}, steps: [] };
      setState({ project: p, pdfBlob: null, page: 1, selectedStepId: null });
      await set("lastProject", p.id);
      persist();
    },

    async openProject(id) {
      if (!id) {
        setState({ project: null, pdfBlob: null });
        await del("lastProject");
        return;
      }
      const [p, blob] = await Promise.all([get<Project>(`project:${id}`), get<Blob>(`pdf:${id}`)]);
      if (!p) return;
      setState({ project: { ...p, colorMap: p.colorMap ?? {} }, pdfBlob: blob ?? null, page: p.steps.at(-1)?.page ?? 1, selectedStepId: p.steps.at(-1)?.id ?? null });
      await set("lastProject", id);
    },

    async deleteProject(id) {
      await Promise.all([del(`project:${id}`), del(`pdf:${id}`)]);
      const list = getState().projects.filter((p) => p.id !== id);
      await set("projects", list);
      setState({ projects: list });
      if (getState().project?.id === id) await getState().openProject(null);
    },

    async importProject(p) {
      const exists = getState().projects.some((x) => x.id === p.id);
      const proj = exists ? { ...p, id: uid(), name: p.name + " (imported)" } : p;
      setState({ project: proj, pdfBlob: null, page: 1, selectedStepId: proj.steps[0]?.id ?? null });
      await set("lastProject", proj.id);
      persist();
    },

    updateProject: update,

    async setPdf(file, info) {
      const p = getState().project;
      if (!p) return;
      await set(`pdf:${p.id}`, file);
      setState({ pdfBlob: file });
      update((p) => ({ ...p, pdf: info }));
    },

    setPage(page) {
      setState({ page });
    },

    addStep(page) {
      const id = uid();
      const steps = getState().project?.steps ?? [];
      const lastNum = steps.reduce((m, s) => Math.max(m, Number(s.label) || 0), 0);
      const step: Step = { id, page, label: String(lastNum + 1), items: [] };
      updateSteps((s) => {
        // keep steps ordered by page, append after the last step on the same/earlier page
        const idx = s.findLastIndex((x) => x.page <= page);
        const copy = [...s];
        copy.splice(idx + 1, 0, step);
        return copy;
      });
      setState({ selectedStepId: id });
      return id;
    },
    updateStep(id, patch) {
      updateSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    },
    deleteStep(id) {
      updateSteps((s) => s.filter((x) => x.id !== id));
      if (getState().selectedStepId === id) setState({ selectedStepId: null });
    },
    selectStep(id) {
      setState({ selectedStepId: id });
      const st = getState().project?.steps.find((s) => s.id === id);
      if (st) setState({ page: st.page });
    },

    addItem(stepId, item) {
      updateSteps((s) =>
        s.map((x) => {
          if (x.id !== stepId) return x;
          // merge with an identical existing item
          const same = x.items.find((i) => i.invKey === item.invKey && JSON.stringify(i.spec) === JSON.stringify(item.spec) && JSON.stringify(i.color) === JSON.stringify(item.color));
          if (same) return { ...x, items: x.items.map((i) => (i === same ? { ...i, qty: i.qty + item.qty } : i)) };
          return { ...x, items: [...x.items, { ...item, id: uid() }] };
        }),
      );
    },
    updateItem(stepId, itemId, patch) {
      updateSteps((s) => s.map((x) => (x.id === stepId ? { ...x, items: x.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : x)));
    },
    removeItem(stepId, itemId) {
      updateSteps((s) => s.map((x) => (x.id === stepId ? { ...x, items: x.items.filter((i) => i.id !== itemId) } : x)));
    },

    setInventory(setInfo, inv) {
      update((p) => ({ ...p, set: setInfo, inventory: inv }));
    },
    setMatch(partNum, match) {
      update((p) => {
        const matches = { ...p.matches };
        if (match) matches[partNum] = match;
        else delete matches[partNum];
        return { ...p, matches };
      });
    },
    setColorMapping(colorId, color) {
      update((p) => {
        const colorMap = { ...p.colorMap };
        if (color) colorMap[colorId] = color;
        else delete colorMap[colorId];
        return { ...p, colorMap };
      });
    },
  };
});
