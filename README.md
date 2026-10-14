# KiCadToGCode (SvelteKit)

Convert KiCad PCB designs into CNC GCode for isolation-engraving traces on copper-clad board and drilling through-holes — entirely in the browser. The successor to the original Blazor app at [kicadtogcode.com](https://kicadtogcode.com) ([grserwe/KiCadToGCode](https://github.com/grserwe/KiCadToGCode)).

## Features

- Accepts a `.kicad_pcb` file (KiCad 4 through 9) or a zipped KiCad project
- Isolation-routing GCode for top and bottom copper, tool-diameter/V-bit aware, multi-pass with stepover
- Drill GCode grouped per drill size, plus registration holes for double-sided flip-over machining (bottom side mirrored about the vertical centerline)
- All pad shapes: circle, oval, rect, roundrect (incl. chamfered), trapezoid, and custom polygon (e.g. hexagonal) pads; ground pads get thermal-relief gaps
- SVG preview of both board sides: copper, engraving paths, drills, registration holes, zoom/pan
- GCode viewer: replays each generated program the way a GRBL controller would, drawing cuts at the tool's real width, rapids, and plunges over the designed copper (mapped into machine coordinates), with a move-by-move step-through and checks for rapids with the tool down, inconsistent arcs, cutting with the spindle off, and missing feed rates or units
- Configurable CNC settings (feeds, speeds, depths, origin, units), persisted in the browser
- Clearance-aware minimum widths: thin traces and small pads are widened to your configured minimums (so copper doesn't peel during machining), capped automatically wherever copper on another net is too close — widening can never cause a short, and blocked spots are reported
- Silkscreen SVG for laser marking: the top (and bottom) silkscreen drawings as a millimetre-sized SVG ready for LightBurn, with the board outline and registration holes on their own colour/layer so the burn lines up with the milled board
- All processing client-side in a Web Worker — your design never leaves your machine
- Recoverable problems surface as warnings (oval slot holes, copper zones, curved traces, inner layers) instead of failures

## How the toolpaths are made

1. **Parse** — a character-level S-expression tokenizer reads the `.kicad_pcb` into a board model in board-local, Y-up millimeter coordinates. Legacy (`module`) and modern (`footprint`) dialects both supported.
2. **Offset** — every track becomes two parallel lines at `width/2 + tool radius`; where tracks meet, the lines are mitered or joined by angular adjacency. A track that runs through a pad (a component lead sitting mid-track) is first split at that pad so both pieces end inside it.
3. **Pad isolation** — circular pads become arcs with gaps where tracks enter; other shapes build an outline (lines + corner arcs, inflated exactly by the tool radius) and gaps are cut out as perimeter intervals.
4. **Emit** — a greedy nearest-neighbour walk orders the segments, then the transform pipeline applies side mirroring, user flips, XY-zero placement, and unit conversion before writing GRBL-safe GCode (G0/G1/G2/G3, M3/M5).

## Silkscreen for the laser

The silkscreen output is an SVG, not GCode: LightBurn imports SVG and plans the laser job itself. The parser keeps every `fp_*`/`gr_*` drawing on F.SilkS, B.SilkS and Edge.Cuts (lines, arcs, circles, rectangles, polygons, in both the modern three-point and the KiCad 4/5 centre-and-angle arc dialects), placed with the same footprint transform the pads use. The SVG uses LightBurn's first three palette colours so each kind of geometry arrives on its own layer:

- **black** — silk lines as centreline vectors (a diode laser's spot is about a silk line's width, so a single pass draws them at the right size)
- **blue** — filled silk shapes, to be cut in Fill mode
- **red** — the board outline and the registration holes, for aligning the burn to the milled board; set that layer's output off before burning

The bottom side is mirrored left-over-right (the face the laser sees), the same convention as the bottom isolation GCode. Silkscreen _text_ (reference designators, labels) is parsed but not drawn yet — KiCad draws text with its own stroke font, which the engine doesn't carry — and a warning lists how many items were left out.

## Roadmap (not yet supported)

- Silkscreen text (needs a stroke font)
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
- The conversion engine is a pure, framework-free TS library in `src/lib/engine/` (`sexpr/` tokenizer → `parser/` → `model/` → `geometry/` → `toolpath/` → `gcode/`, plus `silkscreen/` for the laser SVG), runnable in the browser worker and in vitest.
- Deployed on [Fly.io](https://fly.io) via GitHub Actions (`.github/workflows/deploy.yml`): checks on every push/PR, deploy on master.
