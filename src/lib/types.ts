export type ParamValue = number | boolean | string | ParamValue[];
export type ParamValues = Record<string, ParamValue>;

/** A rectangle removed through the full height of a part, in studs from the part's corner (x along length, y across). */
export interface Cutout {
  x: number;
  y: number;
  w: number;
  d: number;
}

/** A printable part: a preset from the catalog (scad/library.json) plus parameter overrides and optional cut-outs. */
export interface PartSpec {
  presetId: string;
  overrides: ParamValues;
  cutouts?: Cutout[];
}

export interface Color {
  name: string;
  hex: string; // "#RRGGBB"
}

/** One line of the LEGO set inventory (part + color). */
export interface InventoryPart {
  key: string; // `${partNum}:${colorId}` (+ ":spare" for spares)
  partNum: string;
  name: string;
  imgUrl?: string;
  colorId: number;
  colorName: string;
  colorHex: string;
  qty: number;
  isSpare: boolean;
}

export type Match =
  | { kind: "part"; spec: PartSpec }
  | { kind: "none"; note?: string };

/** Color of an item: either follows the LEGO color (via the project color map) or is set explicitly. */
export type ColorRef = { lego: number } | { custom: Color };

export interface StepItem {
  id: string;
  qty: number;
  /** Link to an inventory line. The printed part then comes from the project's matches. */
  invKey?: string;
  /** Explicit part (used when not linked to the inventory, or to override the match). */
  spec?: PartSpec;
  color: ColorRef;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
} // normalized 0..1 page coordinates

export interface Step {
  id: string;
  page: number; // 1-based
  label: string;
  rect?: Rect;
  items: StepItem[];
}

export interface PdfInfo {
  name: string;
  size: number;
  fingerprint: string;
  pages: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pdf?: PdfInfo;
  set?: { num: string; name: string; imgUrl?: string };
  inventory: InventoryPart[];
  /** LEGO part number -> printable part */
  matches: Record<string, Match>;
  /** LEGO color id -> filament color */
  colorMap: Record<string, Color>;
  /** most recently picked colors, newest first */
  recentColors?: ColorRef[];
  steps: Step[];
}

export interface Settings {
  filaments: Color[];
  plate: { width: number; depth: number; spacing: number };
  /** overrides of the fit values in scad/config.scad (from the calibration coupons), e.g. { RIB_D: 4.8 } */
  fit?: Record<string, number>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  steps: number;
}
