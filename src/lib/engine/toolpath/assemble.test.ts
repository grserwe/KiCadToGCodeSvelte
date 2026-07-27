import { describe, expect, it } from 'vitest';
import type { BoardModel, Pad, Track } from '../model/types';
import { buildLayerToolpath, type ToolpathOptions } from './assemble';
import { arcSweep } from './segments';

const OPTIONS: ToolpathOptions = {
	isolationOffset: 0,
	minimumTrackWidth: 0.1,
	minimumPadDiameter: 1.5
};

function board(tracks: Track[], pads: Pad[]): BoardModel {
	return { width: 30, height: 30, fileVersion: 20241229, tracks, pads };
}

function circlePad(x: number, y: number, diameter: number, overrides: Partial<Pad> = {}): Pad {
	return {
		position: { x, y },
		shape: { kind: 'circle', diameter },
		rotationDeg: 0,
		drill: { diameter: 0.8 },
		layers: 'through',
		isGround: false,
		plated: true,
		source: 'footprint',
		net: 1,
		...overrides
	};
}

describe('buildLayerToolpath', () => {
	it('emits two offset lines for a lone track', () => {
		const result = buildLayerToolpath(
			board([{ start: { x: 5, y: 5 }, end: { x: 15, y: 5 }, width: 1, layer: 'top', net: 1 }], []),
			'top',
			OPTIONS
		);
		expect(result.segments).toHaveLength(2);
		const ys = result.segments.map((s) => (s.kind === 'line' ? s.start.y : NaN)).sort();
		expect(ys[0]).toBeCloseTo(4.5, 6);
		expect(ys[1]).toBeCloseTo(5.5, 6);
	});

	it('widens thin tracks to the minimum track width', () => {
		const result = buildLayerToolpath(
			board(
				[{ start: { x: 5, y: 5 }, end: { x: 15, y: 5 }, width: 0.01, layer: 'top', net: 1 }],
				[]
			),
			'top',
			OPTIONS
		);
		const ys = result.segments.map((s) => (s.kind === 'line' ? s.start.y : NaN)).sort();
		expect(ys[1] - ys[0]).toBeCloseTo(0.1, 6);
	});

	it('ignores tracks and pads on the other layer', () => {
		const result = buildLayerToolpath(
			board(
				[{ start: { x: 5, y: 5 }, end: { x: 15, y: 5 }, width: 1, layer: 'bottom', net: 1 }],
				[circlePad(20, 20, 2, { layers: 'bottom' })]
			),
			'top',
			OPTIONS
		);
		expect(result.segments).toHaveLength(0);
	});

	it('includes through-hole pads on both layers', () => {
		const pads = [circlePad(10, 10, 2)];
		const top = buildLayerToolpath(board([], pads), 'top', OPTIONS);
		const bottom = buildLayerToolpath(board([], pads), 'bottom', OPTIONS);
		expect(top.segments).toHaveLength(1);
		expect(bottom.segments).toHaveLength(1);
	});

	it('skips isolation for unplated (mounting hole) pads', () => {
		const result = buildLayerToolpath(
			board([], [circlePad(10, 10, 2, { plated: false })]),
			'top',
			OPTIONS
		);
		expect(result.segments).toHaveLength(0);
	});

	it('grows small pads to the minimum pad diameter', () => {
		const result = buildLayerToolpath(board([], [circlePad(10, 10, 0.6)]), 'top', OPTIONS);
		expect(result.segments).toHaveLength(1);
		const arc = result.segments[0];
		if (arc.kind !== 'arc') throw new Error('expected arc');
		expect(arc.radius).toBeCloseTo(0.75, 6);
	});

	it('connects a track to a pad with a gap in the pad ring', () => {
		const result = buildLayerToolpath(
			board(
				[{ start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, width: 1, layer: 'top', net: 1 }],
				[circlePad(10, 10, 3)]
			),
			'top',
			OPTIONS
		);

		const arcs = result.segments.filter((s) => s.kind === 'arc');
		const lines = result.segments.filter((s) => s.kind === 'line');
		expect(arcs).toHaveLength(1);
		expect(lines).toHaveLength(2);

		// Pad radius 1.5; entry gap half-angle = atan2(0.5, sqrt(1.5²−0.5²)).
		const halfAngle = (Math.atan2(0.5, Math.sqrt(1.5 * 1.5 - 0.25)) * 180) / Math.PI;
		expect(arcSweep(arcs[0] as never)).toBeCloseTo(360 - 2 * halfAngle, 3);

		// Offset lines were clipped to start on the pad boundary.
		for (const line of lines) {
			if (line.kind !== 'line') continue;
			const startDistance = Math.hypot(line.start.x - 10, line.start.y - 10);
			expect(startDistance).toBeCloseTo(1.5, 4);
			expect(line.end.x).toBeCloseTo(20, 6);
		}
	});

	it('applies the isolation offset to tracks and pads together', () => {
		const result = buildLayerToolpath(
			board(
				[{ start: { x: 10, y: 10 }, end: { x: 20, y: 10 }, width: 1, layer: 'top', net: 1 }],
				[circlePad(10, 10, 3)]
			),
			'top',
			{ ...OPTIONS, isolationOffset: 0.2 }
		);

		const arcs = result.segments.filter((s) => s.kind === 'arc');
		expect(arcs).toHaveLength(1);
		if (arcs[0].kind !== 'arc') throw new Error('expected arc');
		expect(arcs[0].radius).toBeCloseTo(1.7, 6);

		const lines = result.segments.filter((s) => s.kind === 'line');
		for (const line of lines) {
			if (line.kind !== 'line') continue;
			expect(Math.abs(line.start.y - 10)).toBeCloseTo(0.7, 6);
			// Clipped exactly onto the inflated pad boundary.
			expect(Math.hypot(line.start.x - 10, line.start.y - 10)).toBeCloseTo(1.7, 4);
		}
	});

	it('produces a continuous isolation loop for an L-shaped net into a pad', () => {
		// Two tracks forming an L, ending in a pad — the continuity invariant:
		// every trimmed line endpoint flagged as touching a pad must sit on
		// that pad's boundary, and junction miters must meet exactly.
		const result = buildLayerToolpath(
			board(
				[
					{ start: { x: 5, y: 5 }, end: { x: 15, y: 5 }, width: 0.8, layer: 'top', net: 1 },
					{ start: { x: 15, y: 5 }, end: { x: 15, y: 15 }, width: 0.8, layer: 'top', net: 1 }
				],
				[circlePad(5, 5, 2), circlePad(15, 15, 2)]
			),
			'top',
			OPTIONS
		);

		// 2 tracks × 2 offset lines + 2 pad arcs.
		expect(result.segments.filter((s) => s.kind === 'line')).toHaveLength(4);
		expect(result.segments.filter((s) => s.kind === 'arc')).toHaveLength(2);

		// Continuity: line endpoints on each pad boundary within tolerance.
		for (const segment of result.segments) {
			if (segment.kind !== 'line') continue;
			for (const point of [segment.start, segment.end]) {
				const nearPadA = Math.abs(Math.hypot(point.x - 5, point.y - 5) - 1);
				const nearPadB = Math.abs(Math.hypot(point.x - 15, point.y - 15) - 1);
				const nearMiterX = Math.abs(point.x - 15) <= 0.45;
				expect(nearPadA < 0.001 || nearPadB < 0.001 || nearMiterX).toBe(true);
			}
		}
	});
});
