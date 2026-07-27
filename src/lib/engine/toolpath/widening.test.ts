import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BoardModel, Pad, Track } from '../model/types';
import { parseBoard } from '../parser/parseBoard';
import { applyMinimumWidths } from './widening';

const OPTIONS = { minimumTrackWidthMm: 0.5, minimumPadDiameterMm: 1.5, clearanceMm: 0.2 };

function board(tracks: Track[], pads: Pad[] = []): BoardModel {
	return { width: 30, height: 30, fileVersion: 20241229, tracks, pads };
}

function track(y: number, width: number, net: number, layer: 'top' | 'bottom' = 'top'): Track {
	return { start: { x: 5, y }, end: { x: 25, y }, width, layer, net };
}

function circlePad(
	x: number,
	y: number,
	diameter: number,
	net: number,
	overrides: Partial<Pad> = {}
): Pad {
	return {
		position: { x, y },
		shape: { kind: 'circle', diameter },
		rotationDeg: 0,
		drill: { diameter: 0.5 },
		layers: 'through',
		isGround: false,
		plated: true,
		source: 'footprint',
		net,
		...overrides
	};
}

describe('applyMinimumWidths', () => {
	it('widens an isolated thin track fully to the minimum', () => {
		const { board: widened, warnings } = applyMinimumWidths(board([track(10, 0.2, 1)]), OPTIONS);
		expect(widened.tracks[0].width).toBeCloseTo(0.5, 6);
		expect(warnings).toEqual([]);
	});

	it('leaves tracks already at or above the minimum untouched', () => {
		const { board: widened } = applyMinimumWidths(board([track(10, 0.8, 1)]), OPTIONS);
		expect(widened.tracks[0].width).toBe(0.8);
	});

	it('caps widening between parallel tracks on different nets', () => {
		// Two 0.2mm tracks 0.6mm apart (centerlines): designed gap = 0.4.
		// Full widening (+0.15 each side) would leave 0.1 < 0.2 clearance.
		// Available = 0.4 − 0.2 = 0.2 → each side grows 0.1 → width 0.4.
		const tracks = [track(10, 0.2, 1), track(10.6, 0.2, 2)];
		const { board: widened, warnings } = applyMinimumWidths(board(tracks), OPTIONS);

		expect(widened.tracks[0].width).toBeCloseTo(0.4, 6);
		expect(widened.tracks[1].width).toBeCloseTo(0.4, 6);
		// Verify the promised clearance survives.
		const gap = 0.6 - widened.tracks[0].width / 2 - widened.tracks[1].width / 2;
		expect(gap).toBeCloseTo(OPTIONS.clearanceMm, 6);
		expect(warnings.some((w) => w.code === 'width-capped')).toBe(true);
	});

	it('lets same-net tracks widen fully even when close', () => {
		const tracks = [track(10, 0.2, 7), track(10.6, 0.2, 7)];
		const { board: widened, warnings } = applyMinimumWidths(board(tracks), OPTIONS);
		expect(widened.tracks[0].width).toBeCloseTo(0.5, 6);
		expect(widened.tracks[1].width).toBeCloseTo(0.5, 6);
		expect(warnings).toEqual([]);
	});

	it('treats net 0 (unconnected) features as different nets', () => {
		const tracks = [track(10, 0.2, 0), track(10.6, 0.2, 0)];
		const { board: widened } = applyMinimumWidths(board(tracks), OPTIONS);
		expect(widened.tracks[0].width).toBeCloseTo(0.4, 6);
	});

	it('ignores pairs on opposite copper layers', () => {
		const tracks = [track(10, 0.2, 1, 'top'), track(10.6, 0.2, 2, 'bottom')];
		const { board: widened } = applyMinimumWidths(board(tracks), OPTIONS);
		expect(widened.tracks[0].width).toBeCloseTo(0.5, 6);
		expect(widened.tracks[1].width).toBeCloseTo(0.5, 6);
	});

	it('keeps the designed size and warns when the design is already too tight', () => {
		// Gap = 0.6 − 0.25 − 0.25 = 0.1 < 0.2 clearance.
		const tracks = [track(10, 0.5, 1), track(10.6, 0.5, 2)];
		const { board: widened, warnings } = applyMinimumWidths(board(tracks), OPTIONS);
		expect(widened.tracks[0].width).toBe(0.5);
		expect(warnings.some((w) => w.code === 'clearance')).toBe(true);
	});

	it('caps circular pads against each other', () => {
		// Centers 1mm apart, both 0.85 → designed gap 0.15. Clearance 0.1:
		// available 0.05, split evenly → diameters 0.9.
		const pads = [circlePad(10, 10, 0.85, 1), circlePad(10, 11, 0.85, 2)];
		const { board: widened, warnings } = applyMinimumWidths(board([], pads), {
			...OPTIONS,
			clearanceMm: 0.1
		});
		for (const pad of widened.pads) {
			if (pad.shape.kind !== 'circle') throw new Error('expected circle');
			expect(pad.shape.diameter).toBeCloseTo(0.9, 6);
		}
		expect(warnings.some((w) => w.code === 'width-capped')).toBe(true);
	});

	it('grows rect pads per axis and respects neighbors', () => {
		const rectShape: Pad['shape'] = { kind: 'rect', sizeX: 0.8, sizeY: 2 };
		const pads = [{ ...circlePad(10, 10, 1, 1), shape: rectShape }, circlePad(10, 14, 0.85, 2)];
		const { board: widened } = applyMinimumWidths(board([], pads), OPTIONS);
		const rect = widened.pads[0];
		if (rect.shape.kind !== 'rect') throw new Error('expected rect');
		// Far apart (gap ≈ 2.575): full growth. X reaches 1.5, Y stays 2.
		expect(rect.shape.sizeX).toBeCloseTo(1.5, 6);
		expect(rect.shape.sizeY).toBe(2);
	});

	it('never grows polygon (custom) pads but they still block neighbors', () => {
		const diamondShape: Pad['shape'] = {
			kind: 'polygon',
			points: [
				{ x: 0.4, y: 0 },
				{ x: 0, y: 0.4 },
				{ x: -0.4, y: 0 },
				{ x: 0, y: -0.4 }
			]
		};
		const hex = { ...circlePad(10, 10.9, 1, 2), shape: diamondShape };
		// Pad below wants to grow from 0.85 to 1.5 (+0.325 radius). Gap from
		// circle edge (10,10 r0.425) to the diamond's lowest point (10,10.5):
		// 0.9 − 0.425 − 0.4 = 0.075 < clearance 0.2 → no growth + warning.
		const pads = [circlePad(10, 10, 0.85, 1), hex];
		const { board: widened, warnings } = applyMinimumWidths(board([], pads), OPTIONS);
		const circle = widened.pads[0];
		if (circle.shape.kind !== 'circle') throw new Error('expected circle');
		expect(circle.shape.diameter).toBe(0.85);
		expect(widened.pads[1].shape).toEqual(hex.shape);
		expect(warnings.some((w) => w.code === 'clearance')).toBe(true);
	});

	it('caps a track against a different-net pad', () => {
		// Track edge at y=10.1; pad (10,11) r 0.425 → designed gap 0.475.
		// Track wants +0.15, pad +0.325 (total 0.475 > available 0.275).
		const tracks = [track(10, 0.2, 1)];
		const pads = [circlePad(10, 11, 0.85, 2)];
		const { board: widened, warnings } = applyMinimumWidths(board(tracks, pads), OPTIONS);
		const pad = widened.pads[0];
		if (pad.shape.kind !== 'circle') throw new Error('expected circle');
		const trackEdge = 10 + widened.tracks[0].width / 2;
		const padEdge = 11 - pad.shape.diameter / 2;
		expect(padEdge - trackEdge).toBeGreaterThanOrEqual(OPTIONS.clearanceMm - 1e-9);
		expect(warnings.some((w) => w.code === 'width-capped')).toBe(true);
	});
});

describe('applyMinimumWidths — sample board', () => {
	const sample = readFileSync(
		new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
		'utf8'
	);

	it('caps the 1mm-pitch header pads instead of shorting them', () => {
		const { board: parsed } = parseBoard(sample);
		const { board: widened, warnings } = applyMinimumWidths(parsed, {
			minimumTrackWidthMm: 0.1,
			minimumPadDiameterMm: 1.5,
			clearanceMm: 0.1
		});

		// Pads are 0.85, 1mm apart, different nets: blind widening to 1.5
		// would overlap them. Designed gap 0.15 − clearance 0.1 → grow 0.05.
		for (const pad of widened.pads) {
			const size =
				pad.shape.kind === 'circle'
					? pad.shape.diameter
					: pad.shape.kind === 'rect'
						? pad.shape.sizeX
						: 0;
			expect(size).toBeCloseTo(0.9, 6);
		}
		expect(warnings.some((w) => w.code === 'width-capped')).toBe(true);
	});
});
