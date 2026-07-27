# KiCadToGCode (SvelteKit)

Convert KiCad PCB designs into CNC GCode for isolation-engraving traces on copper-clad board and drilling through-holes — entirely in the browser. The successor to the original Blazor app at [kicadtogcode.com](https://kicadtogcode.com) ([grserwe/KiCadToGCode](https://github.com/grserwe/KiCadToGCode)).

## Features

- Accepts a `.kicad_pcb` file (KiCad 4 through 9) or a zipped KiCad project
- Isolation-routing GCode for top and bottom copper, tool-diameter/V-bit aware, multi-pass with stepover
- Drill GCode grouped per drill size, plus registration holes for double-sided flip-over machining (bottom side mirrored about the vertical centerline)
- All pad shapes: circle, oval, rect, roundrect (incl. chamfered), trapezoid, and custom polygon (e.g. hexagonal) pads; ground pads get thermal-relief gaps
- SVG preview of both board sides: copper, engraving paths, drills, registration holes, zoom/pan
- Configurable CNC settings (feeds, speeds, depths, origin, units), persisted in the browser
- All processing client-side in a Web Worker — your design never leaves your machine
- Recoverable problems surface as warnings (oval slot holes, copper zones, curved traces, inner layers) instead of failures

## How the toolpaths are made

1. **Parse** — a character-level S-expression tokenizer reads the `.kicad_pcb` into a board model in board-local, Y-up millimeter coordinates. Legacy (`module`) and modern (`footprint`) dialects both supported.
2. **Offset** — every track becomes two parallel lines at `width/2 + tool radius`; where tracks meet, the lines are mitered or joined by angular adjacency.
3. **Pad isolation** — circular pads become arcs with gaps where tracks enter; other shapes build an outline (lines + corner arcs, inflated exactly by the tool radius) and gaps are cut out as perimeter intervals.
4. **Emit** — a greedy nearest-neighbour walk orders the segments, then the transform pipeline applies side mirroring, user flips, XY-zero placement, and unit conversion before writing GRBL-safe GCode (G0/G1/G2/G3, M3/M5).

## Roadmap (not yet supported)

- Copper zones / filled pours
- Curved (arc) traces
- Board outline cut-out GCode
- Inner layers (4+ layer boards)

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
