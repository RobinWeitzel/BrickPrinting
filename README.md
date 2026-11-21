# BrickPrinting

A static web app (GitHub Pages) for rebuilding LEGO sets with 3D-printed
[MachineBlocks](https://github.com/pks5/machineblocks) parts.

1. **Upload the building instructions PDF.** It stays in your browser and is never uploaded.
2. **Mark the steps.** Drag a box around each step on a page, or click "New step on this page".
3. **Load the set's parts list** ("Set parts"). LEGO manuals often have no part numbers, so parts lists
   come from [Rebrickable's free downloads](https://rebrickable.com/downloads/). Download `sets`, `inventories`,
   `inventory_parts`, `parts` and `colors` (`.csv.gz`, no need to unzip) and drop them into the app once.
   They're stored in your browser only and never bundled with this app. After that, enter a set number.
   You can also import a single set's parts CSV.
4. **Match each LEGO part once** to a MachineBlocks part. "Auto-match obvious parts" handles plain plates, bricks, tiles, slopes and wedges.
   Every part can be resized or fine-tuned using all of its MachineBlocks parameters.
5. **Add parts to each step**, either from the set (shows what's left to place) or straight from the library. Set the color per part,
   or map LEGO colors to your filaments.
   Parts MachineBlocks can't make (dishes, Technic pins, special plates, …) can come from **LDraw**:
   import the official library ([complete.zip](https://library.ldraw.org/library/updates/complete.zip), ~150 MB)
   once under **My parts** in the library. Then "Use LDraw model #…" converts a part by its number when you match it,
   and you can also upload single `.dat` files. You can also upload your own STL files. Converted and uploaded
   parts are stored in your browser and included in "Save backup".
6. **Export:**
   - STL files per color
   - one 3MF per color, laid out on the plate
   - one AMS 3MF with all colors
   
   Every export includes a `parts.csv` parts list.

Parts are generated in the browser with OpenSCAD (WebAssembly, Manifold backend).
Projects are saved in IndexedDB; use "Save backup" to download a project JSON (without the PDF).

## Development

```bash
npm install
npm run dev
```

Update the bundled MachineBlocks library (clones into `.cache/machineblocks`, regenerates
`public/machineblocks/` and `src/data/catalog.json`):

```bash
npm run update-machineblocks
```

## Deploying

Push to `main` on GitHub and set **Settings → Pages → Source** to **GitHub Actions**.
The workflow in `.github/workflows/deploy.yml` builds and publishes `dist/`.

## Licenses

- MachineBlocks (bundled in `public/machineblocks/`): © Jan Philipp Knoeller,
  [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This means non-commercial use only.
- OpenSCAD WASM: GPL-2.0.
- Set and part data: imported by the user from [Rebrickable's downloads](https://rebrickable.com/downloads/); part images load from Rebrickable's CDN. No Rebrickable data is stored in this repository.
- LDraw parts library: imported by the user, [CC BY 4.0](https://library.ldraw.org); not stored in this repository.
- LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this project.
