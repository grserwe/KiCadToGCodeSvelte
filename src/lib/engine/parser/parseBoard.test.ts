import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from './parseBoard';
import { BoardParseError } from './errors';

const fixture = (name: string): string =>
	readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8');

describe('parseBoard — KiCad 9 sample (TopAndBottomLayer)', () => {
	const { board, warnings } = parseBoard(fixture('TopAndBottomLayer.kicad_pcb'));

	it('reads the board extents from Edge.Cuts', () => {
		expect(board.fileVersion).toBe(20241229);
		expect(board.width).toBeCloseTo(21.59, 6);
		expect(board.height).toBeCloseTo(8.255, 6);
	});

	it('extracts both tracks in board-local Y-up coordinates', () => {
		expect(board.tracks).toHaveLength(2);

		const top = board.tracks.find((t) => t.layer === 'top');
		const bottom = board.tracks.find((t) => t.layer === 'bottom');
		expect(top).toBeDefined();
		expect(bottom).toBeDefined();

		expect(top!.start.x).toBeCloseTo(3.635, 6);
		expect(top!.start.y).toBeCloseTo(4.445, 6);
		expect(top!.end.x).toBeCloseTo(18.415, 6);
		expect(top!.end.y).toBeCloseTo(4.445, 6);
		expect(top!.width).toBeCloseTo(0.25, 6);

		// The bottom track sits 1mm below in KiCad's Y-down view → smaller Y here.
		expect(bottom!.start.y).toBeCloseTo(3.445, 6);
	});

	it('extracts all four through-hole pads with drills', () => {
		expect(board.pads).toHaveLength(4);
		expect(board.pads.every((p) => p.layers === 'through')).toBe(true);
		expect(board.pads.every((p) => p.drill?.diameter === 0.5)).toBe(true);
		expect(board.pads.every((p) => p.plated)).toBe(true);
		expect(board.pads.every((p) => !p.isGround)).toBe(true);

		const rects = board.pads.filter((p) => p.shape.kind === 'rect');
		const circles = board.pads.filter((p) => p.shape.kind === 'circle');
		expect(rects).toHaveLength(2);
		// The "oval" pads are 0.85 × 0.85 — equal axes collapse to circles.
		expect(circles).toHaveLength(2);

		// J1 pad 1 sits at the footprint origin (100.79, 92.71) → local (3.635, 4.445).
		const j1pad1 = board.pads.find((p) => p.padName === '1' && p.position.x < 10);
		expect(j1pad1).toBeDefined();
		expect(j1pad1!.position.x).toBeCloseTo(3.635, 6);
		expect(j1pad1!.position.y).toBeCloseTo(4.445, 6);

		// J1 pad 2 is 1mm below pad 1 in KiCad's view → 1mm less Y here.
		const j1pad2 = board.pads.find((p) => p.padName === '2' && p.position.x < 10);
		expect(j1pad2!.position.y).toBeCloseTo(3.445, 6);
	});

	it('produces no warnings for a fully supported board', () => {
		expect(warnings).toEqual([]);
	});
});

describe('parseBoard — hexagonal custom pads', () => {
	const { board } = parseBoard(fixture('HexagonPad.kicad_pcb'));

	it('parses a hexagon as a 6-point polygon pad', () => {
		const hex = board.pads.find((p) => p.footprint === 'Test:HexPad');
		expect(hex).toBeDefined();
		expect(hex!.shape.kind).toBe('polygon');
		if (hex!.shape.kind !== 'polygon') return;
		expect(hex!.shape.points).toHaveLength(6);

		// Pad-local points are flipped to Y-up: (0.75, 1.299) → (0.75, -1.299).
		expect(hex!.shape.points[0]).toEqual({ x: 1.5, y: -0 });
		expect(hex!.shape.points[1].y).toBeCloseTo(-1.299, 6);

		expect(hex!.position.x).toBeCloseTo(10, 6);
		expect(hex!.position.y).toBeCloseTo(5, 6);
		expect(hex!.isGround).toBe(true);
		expect(hex!.drill?.diameter).toBeCloseTo(0.8, 6);
	});

	it('rotates pad positions by the footprint rotation', () => {
		// Footprint at (120, 95) rotated 90° CCW; pad offset (2, 0) ends up
		// 2mm above the anchor: file (120, 93) → local (20, 7).
		const rotated = board.pads.find((p) => p.footprint === 'Test:RotatedHexPad');
		expect(rotated).toBeDefined();
		expect(rotated!.position.x).toBeCloseTo(20, 6);
		expect(rotated!.position.y).toBeCloseTo(7, 6);
		expect(rotated!.rotationDeg).toBe(90);
	});
});

describe('parseBoard — legacy (pre-KiCad 6) module dialect', () => {
	const { board, warnings } = parseBoard(fixture('LegacyModule.kicad_pcb'));

	it('reads extents from the (general (area)) record', () => {
		expect(board.width).toBeCloseTo(20, 6);
		expect(board.height).toBeCloseTo(10, 6);
	});

	it('parses module pads, including bare-atom GND net detection', () => {
		const thru = board.pads.find((p) => p.padName === '1' && p.source === 'footprint');
		expect(thru).toBeDefined();
		expect(thru!.position.x).toBeCloseTo(5, 6);
		expect(thru!.position.y).toBeCloseTo(5, 6);
		expect(thru!.layers).toBe('through');
		expect(thru!.isGround).toBe(true);
		expect(thru!.drill?.diameter).toBe(1);

		const smd = board.pads.find((p) => p.padName === '2');
		expect(smd).toBeDefined();
		expect(smd!.layers).toBe('top');
		expect(smd!.drill).toBeNull();
		expect(smd!.position.x).toBeCloseTo(7, 6);
	});

	it('defaults a via with no drill record and warns about it', () => {
		const via = board.pads.find((p) => p.source === 'via');
		expect(via).toBeDefined();
		expect(via!.drill?.diameter).toBeCloseTo(0.6, 6);
		expect(via!.layers).toBe('through');
		expect(warnings.some((w) => w.code === 'via-drill-missing')).toBe(true);
	});
});

describe('parseBoard — error handling', () => {
	it('rejects non-KiCad files', () => {
		expect(() => parseBoard('(gerber stuff)')).toThrow(BoardParseError);
		expect(() => parseBoard('hello world')).toThrow(BoardParseError);
	});

	it('rejects files with no version record', () => {
		expect(() => parseBoard('(kicad_pcb (net 0 ""))')).toThrow(BoardParseError);
	});
});
