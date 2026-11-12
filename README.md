# KiCadToGCode (SvelteKit)

**Live at [kicadtogcode.com](https://kicadtogcode.com)** — free, no sign-up, and your design never leaves your browser.

Convert KiCad PCB designs into CNC GCode for isolation-engraving traces on copper-clad board and drilling through-holes — entirely in the browser. This app replaced the original Blazor version ([grserwe/KiCadToGCode](https://github.com/grserwe/KiCadToGCode)) on the same domain.

## Features

- Accepts a `.kicad_pcb` file (KiCad 4 through 10) or a zipped KiCad project
- Isolation-routing GCode for top and bottom copper, tool-diameter/V-bit aware, multi-pass with stepover
- Drill GCode grouped per drill size, or onto the drill bits you list (each hole uses the nearest bit within a set difference, so 0.8/0.9/1.0 mm share one file), plus registration holes for double-sided flip-over machining (bottom side mirrored about the vertical centerline)
- Board cutout GCode: an end mill follows the Edge.Cuts outline (lines, arcs, circles, rectangles, polygons — chained into closed loops, with inner cutouts cut first) offset by the cutter radius, climb milling in depth passes, leaving holding tabs on the straight edges
- All pad shapes: circle, oval, rect, roundrect (incl. chamfered), trapezoid, and custom polygon (e.g. hexagonal) pads; ground pads get thermal-relief gaps
- Copper pours (KiCad zones) for free: on a layer with a pour, the pour's net is left uncut, so all the copper the bit never touches becomes that net. Its tracks get no isolation, its pads join the copper with thermal spokes, solidly, or not at all, following the zone's pad-connection setting and any per-pad override (vias always solid), and everything else is isolated as usual
- SVG preview of both board sides: copper, engraving paths, drills, registration holes, zoom/pan
- GCode viewer: replays each generated program the way a GRBL controller would, drawing cuts at the tool's real width, rapids, and plunges over the designed copper (mapped into machine coordinates), with a move-by-move step-through and checks for rapids with the tool down, inconsistent arcs, cutting with the spindle off, and missing feed rates or units
- Configurable CNC settings (feeds, speeds, depths, origin, units), persisted in the browser
- Clearance-aware minimum widths: thin traces and small pads are widened to your configured minimums (so copper doesn't peel during machining), capped automatically wherever copper on another net is too close — widening can never cause a short, and blocked spots are reported
- Silkscreen SVG for laser marking: the top (and bottom) silkscreen drawings and text as a millimetre-sized SVG ready for LightBurn, with Print and Cut alignment targets on two drilled holes, plus the board outline and registration holes on their own colour/layer
- All processing client-side in a Web Worker — your design never leaves your machine
- Recoverable problems surface as warnings (oval slot holes, curved traces, inner layers, an isolation cut wider than a pour's clearance) instead of failures

## How the toolpaths are made

1. **Parse** — a character-level S-expression tokenizer reads the `.kicad_pcb` into a board model in board-local, Y-up millimeter coordinates. Legacy (`module`) and modern (`footprint`) dialects both supported.
2. **Offset** — every track becomes two parallel lines at `width/2 + tool radius`; where tracks meet, the lines are mitered or joined by angular adjacency. A track that runs through a pad (a component lead sitting mid-track) is first split at that pad so both pieces end inside it.
3. **Pad isolation** — circular pads become arcs with gaps where tracks enter; other shapes build an outline (lines + corner arcs, inflated exactly by the tool radius) and gaps are cut out as perimeter intervals.
   Thermal-relief pads keep four 45° spokes uncut as well.
4. **Emit** — a greedy nearest-neighbour walk orders the segments, then the transform pipeline applies side mirroring, user flips, XY-zero placement, and unit conversion before writing GRBL-safe GCode (G0/G1/G2/G3, M3/M5).

## Board cutout

The profile program (`<board>-profile.txt`) cuts the board free, so it runs last. The Edge.Cuts drawings are chained end to end into closed loops (endpoints within 0.05 mm join; circles and polygons are loops already), the largest loop is the board boundary and loops inside it are holes. Every loop is wound so the material is on its left — boundary counter-clockwise, holes clockwise — and then offset to its right by the cutter radius: straight edges shift, outward arcs grow, inward arcs shrink, convex corners get an arc around the vertex and concave corners are trimmed to the intersection. Holes are cut before the boundary. With the bottom side mirrored, the loop direction is reversed so the machine still climb mills.

The cut is made in depth passes (total depth ÷ depth per pass, in output units). On the passes below the tab top, the cutter lifts to the tab height over each tab, which are spread evenly along the straight edges and kept clear of the corners. A board with no closed outline is cut along the rectangle of its extents, with a warning; an inside curve tighter than the cutter is reported and cut as a cusp.

## Silkscreen for the laser

The silkscreen output is an SVG, not GCode: LightBurn imports SVG and plans the laser job itself. The parser keeps every `fp_*`/`gr_*` drawing on F.SilkS, B.SilkS and Edge.Cuts (lines, arcs, circles, rectangles, polygons, in both the modern three-point and the KiCad 4/5 centre-and-angle arc dialects), placed with the same footprint transform the pads use. The SVG uses LightBurn's first three palette colours so each kind of geometry arrives on its own layer:

- **black** — silk lines as centreline vectors (a diode laser's spot is about a silk line's width, so a single pass draws them at the right size)
- **blue** — filled silk shapes, to be cut in Fill mode
- **red** — the board outline and the registration holes, for aligning the burn to the milled board; set that layer's output off before burning

The bottom side is mirrored left-over-right (the face the laser sees), the same convention as the bottom isolation GCode. Silkscreen _text_ (reference designators, labels) is parsed but not drawn yet — KiCad draws text with its own stroke font, which the engine doesn't carry — and a warning lists how many items were left out.

## Copper pours

Isolation milling never removes the copper between cuts, so it is all still on the board, joined up. On a layer with a KiCad zone, that leftover copper is used as the pour:

- tracks on the pour's net are not cut around (they are part of the pour);
- pads on the pour's net get the zone's pad connection: thermal reliefs (four uncut spokes, plus gaps where their tracks enter), solid (no cut at all), or none (a ring with gaps only for their tracks). A pad's own `zone_connect` overrides the zone; vias are always solid, as in KiCad;
- everything on other nets is isolated as before, including ground-named pads that are not on the pour's net.

The milled pour covers more than KiCad's fill: it reaches every bit of copper left uncut, beyond the zone outline, and it keeps copper islands KiCad would have removed, which just float. As long as the isolation cut (tool diameter plus the extra passes) is no wider than the zone clearance, the cuts lie inside KiCad's clearance gaps, so every connection KiCad's fill makes is still there; a wider cut is reported. A layer has only one sheet of leftover copper, so it can carry only one pour net: when zones for several nets share a layer, the one with the largest area is used and the others are reported as ignored. Layers without a zone keep the old behaviour (ground-named pads get thermal reliefs; every track is isolated).

## Roadmap (not yet supported)

- Several pour nets on one layer (split planes)
- Curved (arc) traces
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

## Feedback form

"Send feedback" in the footer (and "Report a problem" next to the output) opens a dialog that emails the message to the developer. The user's PCB file is attached by default — they can untick it — and they may add screenshots or other files. The current settings and any warnings on screen go into the email body. `POST /api/feedback` receives the form and sends it with nodemailer over SMTP, rate-limited per client and guarded by a honeypot field; without SMTP credentials it logs the message in dev and answers 503 in production.

Configure with `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (optionally `SMTP_PORT`, default 465), `EMAIL_FROM` and `FEEDBACK_TO` — see `.env.example`. Production uses Resend's SMTP relay with a sender on the verified `kicadtogcode.com` domain. The Dockerfile raises adapter-node's `BODY_SIZE_LIMIT` to 25 MB so attachments fit.

## Usage counts

Anonymous, cookie-free counts go to [GoatCounter](https://www.goatcounter.com): page views, plus three events, `board-converted`, `sample-converted` and `output-downloaded`. Regenerating after a settings change isn't counted. `src/lib/analytics.ts` only ever sends those fixed names, never anything from the board, including its name. Results are at [grserwe.goatcounter.com](https://grserwe.goatcounter.com).

The site code comes from `PUBLIC_GOATCOUNTER_CODE`, set in `fly.toml`. Without it nothing loads, and the note on the landing page saying what is counted disappears too. GoatCounter's script also ignores localhost, so local development never adds to the numbers.

## Architecture

- **SvelteKit + TypeScript + Tailwind 4**, `adapter-node`, no database, no auth. The only server code is `src/routes/api/feedback/` and `src/lib/server/email.ts`.
- The conversion engine is a pure, framework-free TS library in `src/lib/engine/` (`sexpr/` tokenizer → `parser/` → `model/` → `geometry/` → `toolpath/` → `gcode/`, plus `profile/` for the board cutout and `silkscreen/` for the laser SVG), runnable in the browser worker and in vitest.
- Deployed on [Fly.io](https://fly.io) via GitHub Actions (`.github/workflows/deploy.yml`): checks on every push/PR, deploy on master.
