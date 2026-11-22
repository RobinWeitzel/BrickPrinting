# BrickPrinting

A static web app (GitHub Pages) for rebuilding LEGO sets with 3D-printed parts from our own
**FDM-friendly brick system**: LEGO scale (8 mm grid, 3.2 mm plates), but designed for printing and
**not LEGO compatible**. Studs only point up, crush-rib sockets give the clutch, and everything
sideways connects through slots and separate clips, or Ø3 axles. Every part prints flat without supports.
The parametric OpenSCAD library lives in [`scad/`](scad/README.md).

1. **Upload the building instructions PDF.** It stays in your browser and is never uploaded.
2. **Mark the steps.** Drag a box around each step on a page, or click "New step on this page".
3. **Load the set's parts list** ("Set parts"). LEGO manuals often have no part numbers, so parts lists
   come from [Rebrickable's free downloads](https://rebrickable.com/downloads/). Download `sets`, `inventories`,
   `inventory_parts`, `parts` and `colors` (`.csv.gz`, no need to unzip) and drop them into the app once.
   They're stored in your browser only and never bundled with this app. After that, enter a set number.
   You can also import a single set's parts CSV.
4. **Match each LEGO part once** to a part of the library. "Auto-match parts" handles plain bricks, plates,
   tiles, slopes, wedges, round, corner and arch parts, resizing them as needed. Every part can be changed with all
   parameters of its generator (size, height, slots, hollow, …).
5. **Add parts to each step**, either from the set (shows what's left to place) or straight from the library. Set the color per part,
   or map LEGO colors to your filaments.
6. **Export:**
   - STL files per color
   - one 3MF per color, laid out on the plate
   - one AMS 3MF with all colors

   Every export includes a `parts.csv` parts list. The export dialog also tells you how many clips and axles the build needs.

**Fit:** under Settings → *Fit (calibration)* you can change the connector fit values (from the calibration coupons
in the library) for your printer and filament. See [scad/README.md](scad/README.md#re-calibrating-with-the-coupon-generator).

Parts are generated in the browser with OpenSCAD (WebAssembly, Manifold backend).
Projects are saved in IndexedDB. "Save backup" downloads a project JSON (without the PDF).

The part list of the MachineBlocks library the app used before is kept in
[docs/machineblocks-base-collection.md](docs/machineblocks-base-collection.md) as a checklist for the base set.

## Development

```bash
npm install
npm run dev
```

After changing the OpenSCAD library (`scad/`), regenerate `public/library/` and `src/data/catalog.json`.
With `--thumbs`, the thumbnails are re-rendered too (needs the OpenSCAD CLI and the Python venv, see
[scad/README.md](scad/README.md#building-and-checking)):

```bash
npm run build-library -- --thumbs
```

## Deploying

Push to `main` on GitHub and set **Settings → Pages → Source** to **GitHub Actions**.
The workflow in `.github/workflows/deploy.yml` builds and publishes `dist/`.

## Licenses

- OpenSCAD WASM: GPL-2.0.
- Set and part data: imported by the user from [Rebrickable's downloads](https://rebrickable.com/downloads/); part images load from Rebrickable's CDN. No Rebrickable data is stored in this repository.
- LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this project.
