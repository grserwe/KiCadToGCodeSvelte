# KiCadToGCode (SvelteKit)

Convert KiCad PCB designs into CNC GCode for isolation-engraving traces on copper-clad board and drilling through-holes — entirely in the browser. The successor to the original Blazor app at [kicadtogcode.com](https://kicadtogcode.com) ([grserwe/KiCadToGCode](https://github.com/grserwe/KiCadToGCode)).

## Features (target)

- Accepts a `.kicad_pcb` file or a zipped KiCad project
- Isolation-routing GCode for top and bottom copper, tool-diameter/V-bit aware, multi-pass
- Drill GCode grouped per drill size, plus registration holes for double-sided flip-over machining
- SVG preview of both board sides: copper, toolpaths, drills, board outline
- Configurable CNC settings (feeds, speeds, depths, origin, units), persisted in the browser
- All processing client-side in a Web Worker — your design never leaves your machine

## Development

```bash
npm install
npm run dev        # dev server
npm run test       # vitest unit tests
npm run check      # svelte-check / type-check
npm run lint       # prettier + eslint
npm run build      # production build (adapter-node)
```

## Architecture

- **SvelteKit + TypeScript + Tailwind 4**, `adapter-node`, no database, no auth.
- The conversion engine is a pure, framework-free TS library in `src/lib/engine/` (`sexpr/` tokenizer → `parser/` → `model/` → `geometry/` → `toolpath/` → `gcode/`), runnable in the browser worker and in vitest.
- Deployed on [Fly.io](https://fly.io) via GitHub Actions (`.github/workflows/deploy.yml`): checks on every push/PR, deploy on master.
