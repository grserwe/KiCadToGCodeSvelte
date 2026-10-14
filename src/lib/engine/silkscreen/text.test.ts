import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../model/types';
import { decodeGlyph, renderText, type TextGraphic } from './text';
import { NEWSTROKE_ASCII } from './newstroke';

/**
 * Oracle: `newstroke-ascii.kicad-cli.svg` is kicad-cli 10's SVG export of a
 * 400 × 200 mm board carrying every printable ASCII character as its own
 * `gr_text` (size 10 × 10 mm, thickness 0.4, justify left bottom) on a grid:
 * character i at file (10 + 19·(i % 20), 20 + 30·⌊i / 20⌋). Four Latin-1
 * extras follow at indices 95–98 and are skipped here.
 */
const oracle = readFileSync(
	new URL('../__fixtures__/newstroke-ascii.kicad-cli.svg', import.meta.url),
	'utf8'
);
const BOARD_HEIGHT = 200;

type Segment = [Vec2, Vec2];

function oracleSegments(): Map<string, Segment[]> {
	const unescape = (s: string) =>
		s
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&');
	const result = new Map<string, Segment[]>();
	const groups = oracle.matchAll(/<g class="stroked-text"><desc>(.*?)<\/desc>([\s\S]*?)<\/g>/g);
	for (const [, desc, body] of groups) {
		const segments: Segment[] = [];
		for (const [, x1, y1, x2, y2] of body.matchAll(
			/<path d="M([-\d.]+) ([-\d.]+)\s*L([-\d.]+) ([-\d.]+)/g
		)) {
			segments.push([
				{ x: Number(x1), y: Number(y1) },
				{ x: Number(x2), y: Number(y2) }
			]);
		}
		result.set(unescape(desc), segments);
	}
	return result;
}

function text(character: string, index: number): TextGraphic {
	const col = index % 20;
	const row = Math.floor(index / 20);
	return {
		kind: 'text',
		layer: 'silk-top',
		text: character,
		position: { x: 10 + col * 19, y: BOARD_HEIGHT - (20 + row * 30) },
		rotationDeg: 0,
		size: { x: 10, y: 10 },
		thickness: 0.4,
		justify: { horizontal: 'left', vertical: 'bottom' },
		mirrored: false,
		italic: false
	};
}

const sameSegment = (a: Segment, b: Segment, tolerance: number) => {
	const close = (p: Vec2, q: Vec2) =>
		Math.abs(p.x - q.x) <= tolerance && Math.abs(p.y - q.y) <= tolerance;
	return (close(a[0], b[0]) && close(a[1], b[1])) || (close(a[0], b[1]) && close(a[1], b[0]));
};

describe('newstroke glyph table', () => {
	it('covers printable ASCII with well-formed Hershey strings', () => {
		expect(NEWSTROKE_ASCII).toHaveLength(95);
		for (const encoded of NEWSTROKE_ASCII) {
			expect(encoded.length % 2).toBe(0);
			expect(encoded.length).toBeGreaterThanOrEqual(2);
		}
		expect(decodeGlyph(NEWSTROKE_ASCII[0])).toEqual({ width: 16 / 21, strokes: [] });
	});

	it('renders every printable ASCII glyph exactly as kicad-cli does', () => {
		const expected = oracleSegments();
		let compared = 0;
		for (let index = 1; index < 95; index++) {
			const character = String.fromCharCode(0x20 + index);
			const oracleSegs = expected.get(character);
			expect(oracleSegs, `oracle has '${character}'`).toBeDefined();

			const rendered = renderText(text(character, index));
			expect(rendered.missingGlyphs).toBe(0);
			const mine: Segment[] = [];
			for (const stroke of rendered.strokes) {
				for (let i = 0; i + 1 < stroke.length; i++) {
					const a = stroke[i];
					const b = stroke[i + 1];
					mine.push([
						{ x: a.x, y: BOARD_HEIGHT - a.y },
						{ x: b.x, y: BOARD_HEIGHT - b.y }
					]);
				}
			}

			expect(mine.length, `segment count for '${character}'`).toBe(oracleSegs!.length);
			for (const segment of oracleSegs!) {
				const found = mine.some((candidate) => sameSegment(candidate, segment, 0.002));
				expect(found, `segment of '${character}' at ${JSON.stringify(segment)}`).toBe(true);
			}
			compared++;
		}
		expect(compared).toBe(94);
	});
});

describe('renderText layout (values from kicad-cli exports)', () => {
	// Probe board: 60 × 30 mm, file origin (100, 100); numbers below are from
	// kicad-cli's SVG of the same texts, converted to this Y-up frame.
	const H = 30;
	const base = (overrides: Partial<TextGraphic>): TextGraphic => ({
		kind: 'text',
		layer: 'silk-top',
		text: '',
		position: { x: 0, y: 0 },
		rotationDeg: 0,
		size: { x: 1, y: 1 },
		thickness: 0.15,
		justify: { horizontal: 'center', vertical: 'center' },
		mirrored: false,
		italic: false,
		...overrides
	});
	const bounds = (strokes: Vec2[][]) => {
		const xs = strokes.flat().map((p) => p.x);
		const ys = strokes.flat().map((p) => p.y);
		return {
			minX: Math.min(...xs),
			maxX: Math.max(...xs),
			minY: Math.min(...ys),
			maxY: Math.max(...ys)
		};
	};

	it('places left/bottom text with a 2 × 1 size (height first)', () => {
		const { strokes } = renderText(
			base({
				text: 'Hg',
				position: { x: 5, y: H - 22 },
				size: { x: 1, y: 2 },
				thickness: 0.2,
				justify: { horizontal: 'left', vertical: 'bottom' }
			})
		);
		const b = bounds(strokes);
		expect(b.minX).toBeCloseTo(5.3697, 3);
		expect(b.maxX).toBeCloseTo(6.8459, 3);
		expect(H - b.maxY).toBeCloseTo(19.7448, 3);
		expect(H - b.minY).toBeCloseTo(22.4115, 3);
	});

	it('places right/top text', () => {
		const { strokes } = renderText(
			base({
				text: 'Ab',
				position: { x: 25, y: H - 22 },
				justify: { horizontal: 'right', vertical: 'top' }
			})
		);
		const b = bounds(strokes);
		expect(b.minX).toBeCloseTo(23.2346, 3);
		expect(b.maxX).toBeCloseTo(24.7108, 3);
		expect(H - b.maxY).toBeCloseTo(22.0398, 3);
		expect(H - b.minY).toBeCloseTo(23.0398, 3);
	});

	it('centres text by default', () => {
		const { strokes } = renderText(
			base({ text: 'Mq', position: { x: 45, y: H - 22 }, size: { x: 1.5, y: 1.5 } })
		);
		const b = bounds(strokes);
		expect(b.minX).toBeCloseTo(43.8214, 3);
		expect(b.maxX).toBeCloseTo(46.1786, 3);
		expect(H - b.maxY).toBeCloseTo(21.1861, 3);
		expect(H - b.minY).toBeCloseTo(23.1861, 3);
	});

	it('rotates counterclockwise about the anchor', () => {
		const { strokes } = renderText(
			base({ text: 'R90', position: { x: 27, y: H - 10 }, rotationDeg: 90 })
		);
		const b = bounds(strokes);
		expect(b.minX).toBeCloseTo(26.4548, 3);
		expect(b.maxX).toBeCloseTo(27.4548, 3);
		expect(H - b.maxY).toBeCloseTo(8.7381, 3);
		expect(H - b.minY).toBeCloseTo(11.2143, 3);
		// First point of 'R' (its right stem's foot) in KiCad's export.
		expect(strokes[0][0].x).toBeCloseTo(27.4548, 3);
		expect(H - strokes[0][0].y).toBeCloseTo(10.6429, 3);
	});

	it('mirrors about the anchor for back-side text', () => {
		const { strokes } = renderText(
			base({ text: 'Fb', position: { x: 50, y: H - 5 }, mirrored: true })
		);
		const b = bounds(strokes);
		expect(b.minX).toBeCloseTo(49.3095, 3);
		expect(b.maxX).toBeCloseTo(50.6429, 3);
		expect(strokes[0][0].x).toBeCloseTo(50.3095, 3);
	});

	it('substitutes ? for characters outside the font and counts them', () => {
		const { strokes, missingGlyphs } = renderText(base({ text: 'Ω' }));
		expect(missingGlyphs).toBe(1);
		expect(strokes.length).toBeGreaterThan(0);
	});
});
