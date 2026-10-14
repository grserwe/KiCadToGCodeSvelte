import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from './parseBoard';
import type { Graphic } from '../model/types';

const fixture = (name: string): string =>
	readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8');

/** A 20 × 10 mm board (file coords 100..120 × 50..60) wrapping the given body. */
function modernBoard(body: string): string {
	return `(kicad_pcb (version 20241229) (generator "pcbnew")
	(gr_rect (start 100 50) (end 120 60) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
	${body}
)`;
}

const silk = (graphics: Graphic[], layer: Graphic['layer'] = 'silk-top') =>
	graphics.filter((g) => g.layer === layer);

/** Angles compare modulo 360 (0° and 359.999…° are the same direction). */
const expectAngle = (actual: number, expected: number) =>
	expect(((((actual - expected) % 360) + 540) % 360) - 180).toBeCloseTo(0, 6);

describe('silkscreen and outline graphics — KiCad 9 sample', () => {
	const { board } = parseBoard(fixture('TopAndBottomLayer.kicad_pcb'));

	it('collects the footprint silkscreen lines and the Edge.Cuts outline', () => {
		const top = silk(board.graphics);
		expect(top.filter((g) => g.kind === 'line')).toHaveLength(16);
		// The two visible reference designators are parsed as (unrendered) text.
		expect(top.filter((g) => g.kind === 'text').map((g) => g.kind === 'text' && g.text)).toEqual(
			expect.arrayContaining(['J1', 'J2'])
		);
		expect(silk(board.graphics, 'silk-bottom')).toHaveLength(0);
		expect(silk(board.graphics, 'edge')).toHaveLength(4);
		// Courtyard and fab layers are not kept.
		expect(board.graphics.length).toBe(16 + 2 + 4);
	});

	it('places footprint lines in board-local Y-up coordinates', () => {
		// J2 sits at file (115.57, 92.71); its first silk line runs from
		// (-0.695, -0.685) to (0, -0.685) footprint-local. Board origin is file
		// (97.155, 97.155) lower-left, so x' = x − 97.155 and y' = 97.155 − y.
		const line = silk(board.graphics).find(
			(g) => g.kind === 'line' && Math.abs(g.start.x - 17.72) < 1e-6
		);
		expect(line).toBeDefined();
		if (line?.kind !== 'line') throw new Error('expected a line');
		expect(line.start.y).toBeCloseTo(5.13, 6);
		expect(line.end.x).toBeCloseTo(18.415, 6);
		expect(line.end.y).toBeCloseTo(5.13, 6);
		expect(line.width).toBeCloseTo(0.12, 6);
	});

	it('maps the Edge.Cuts rectangle onto the board extents', () => {
		const xs = new Set<number>();
		const ys = new Set<number>();
		for (const edge of silk(board.graphics, 'edge')) {
			if (edge.kind !== 'line') throw new Error('expected lines');
			for (const p of [edge.start, edge.end]) {
				xs.add(Math.round(p.x * 1e6) / 1e6);
				ys.add(Math.round(p.y * 1e6) / 1e6);
			}
		}
		expect([...xs].sort((a, b) => a - b)).toEqual([0, 21.59]);
		expect([...ys].sort((a, b) => a - b)).toEqual([0, 8.255]);
	});
});

describe('silkscreen graphics — primitives', () => {
	it('rotates and places footprint drawings by the footprint rotation', () => {
		// Footprint at file (110, 55) rotated 90° CCW (on screen). A local line
		// along +X (0→2, 0) then points "up" on screen = −Y in the file = +Y here.
		const { board } = parseBoard(
			modernBoard(`(footprint "Test" (layer "F.Cu") (at 110 55 90)
				(fp_line (start 0 0) (end 2 0) (stroke (width 0.2) (type solid)) (layer "F.SilkS")))`)
		);
		const [line] = silk(board.graphics);
		if (line.kind !== 'line') throw new Error('expected a line');
		expect(line.start.x).toBeCloseTo(10, 6);
		expect(line.start.y).toBeCloseTo(5, 6);
		expect(line.end.x).toBeCloseTo(10, 6);
		expect(line.end.y).toBeCloseTo(7, 6);
		expect(line.width).toBeCloseTo(0.2, 6);
	});

	it('reads three-point arcs into center form with the Y flip reversing the sweep', () => {
		// In file coords: quarter arc about (110, 55), from (112, 55) via
		// (110+√2, 55+√2) to (110, 57) — that is clockwise on screen (toward +Y
		// in the Y-down file) and so clockwise once Y is flipped.
		const s = Math.SQRT2;
		const { board } = parseBoard(
			modernBoard(
				`(gr_arc (start 112 55) (mid ${110 + s} ${55 + s}) (end 110 57) (stroke (width 0.15) (type solid)) (layer "F.SilkS"))`
			)
		);
		const [arc] = silk(board.graphics);
		if (arc.kind !== 'arc') throw new Error('expected an arc');
		expect(arc.center.x).toBeCloseTo(10, 6);
		expect(arc.center.y).toBeCloseTo(5, 6);
		expect(arc.radius).toBeCloseTo(2, 6);
		expectAngle(arc.startAngle, 0);
		expect(arc.sweep).toBeCloseTo(-90, 6);
	});

	it('reads legacy center/angle arcs (positive angle = clockwise on screen)', () => {
		const file = `(kicad_pcb (version 4) (host pcbnew 4.0.7)
	(general (area 100 50 120 60))
	(module Test:Legacy (layer F.Cu) (at 110 55)
		(fp_arc (start 0 0) (end 2 0) (angle 90) (layer F.SilkS) (width 0.15))
	)
)`;
		const { board } = parseBoard(file);
		const [arc] = silk(board.graphics);
		if (arc.kind !== 'arc') throw new Error('expected an arc');
		expect(arc.center.x).toBeCloseTo(10, 6);
		expect(arc.center.y).toBeCloseTo(5, 6);
		expect(arc.radius).toBeCloseTo(2, 6);
		expectAngle(arc.startAngle, 0);
		expect(arc.sweep).toBeCloseTo(-90, 6);
		expect(arc.width).toBeCloseTo(0.15, 6);
	});

	it('reads circles, rectangles, and polygons with their fill', () => {
		const { board } = parseBoard(
			modernBoard(`(footprint "Test" (layer "F.Cu") (at 110 55)
				(fp_circle (center 0 0) (end 1 0) (stroke (width 0.1) (type solid)) (fill solid) (layer "F.SilkS"))
				(fp_rect (start -1 -1) (end 1 1) (stroke (width 0.1) (type solid)) (fill none) (layer "F.SilkS"))
				(fp_poly (pts (xy 0 0) (xy 1 0) (xy 0 1)) (stroke (width 0.1) (type solid)) (fill yes) (layer "B.SilkS")))`)
		);
		const [circle, rect] = silk(board.graphics);
		if (circle.kind !== 'circle' || rect.kind !== 'polygon') throw new Error('unexpected kinds');
		expect(circle.radius).toBeCloseTo(1, 6);
		expect(circle.filled).toBe(true);
		expect(rect.points).toHaveLength(4);
		expect(rect.filled).toBe(false);
		expect(rect.points.map((p) => [p.x, p.y])).toEqual([
			[9, 6],
			[11, 6],
			[11, 4],
			[9, 4]
		]);

		const [poly] = silk(board.graphics, 'silk-bottom');
		if (poly.kind !== 'polygon') throw new Error('expected a polygon');
		expect(poly.filled).toBe(true);
		expect(poly.points).toHaveLength(3);
	});

	it('keeps visible text and drops hidden text', () => {
		const { board } = parseBoard(
			modernBoard(`(footprint "Test" (layer "F.Cu") (at 110 55)
				(property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
				(property "Value" "10k" (at 0 2 0) (layer "F.SilkS") (hide yes) (effects (font (size 1 1) (thickness 0.15))))
				(fp_text user "label" (at 0 0 0) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.1)))))
			(gr_text "Board" (at 101 51 0) (layer "F.SilkS") (effects (font (size 1.5 1.5) (thickness 0.3))))`)
		);
		const texts = silk(board.graphics).filter((g) => g.kind === 'text');
		expect(texts.map((g) => g.kind === 'text' && g.text)).toEqual(['R1', 'label', 'Board']);
		const reference = texts[0];
		if (reference.kind !== 'text') throw new Error('expected text');
		expect(reference.position.x).toBeCloseTo(10, 6);
		expect(reference.position.y).toBeCloseTo(7, 6);
		expect(reference.height).toBeCloseTo(1, 6);
		expect(reference.thickness).toBeCloseTo(0.15, 6);
	});

	it('ignores custom-pad primitives, which have no layer of their own', () => {
		const { board } = parseBoard(fixture('HexagonPad.kicad_pcb'));
		expect(silk(board.graphics)).toHaveLength(0);
	});
});
