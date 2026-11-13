import { describe, expect, it } from 'vitest';
import type { BoardModel, Pad, Track } from '../model/types';
import { buildLayerToolpath } from './assemble';
import { buildCopperClearance, clipToClearance } from './clearance';
import { arcPoint, arcSweep, type PathSegment } from './segments';
import { distance, pointToSegmentDistance } from '../geometry/primitives';

const TOOL = 0.15;
const RADIUS = TOOL / 2;

function board(tracks: Track[], pads: Pad[]): BoardModel {
	return { width: 30, height: 30, fileVersion: 20241229, tracks, pads, pours: [], graphics: [] };
}

function track(y: number, net: number, width = 0.25): Track {
	return { start: { x: 5, y }, end: { x: 15, y }, width, layer: 'top', net };
}

function circlePad(x: number, y: number, diameter: number, net: number): Pad {
	return {
		position: { x, y },
		shape: { kind: 'circle', diameter },
		rotationDeg: 0,
		drill: { diameter: 0.8 },
		layers: 'through',
		isGround: false,
		plated: true,
		source: 'footprint',
		net
	};
}

function rectPad(x: number, y: number, net: number): Pad {
	return { ...circlePad(x, y, 1, net), shape: { kind: 'rect', sizeX: 1.5, sizeY: 1 } };
}

/** Points along every segment, every 0.005 mm. */
function samplePoints(segments: PathSegment[]) {
	const points = [];
	for (const segment of segments) {
		if (segment.kind === 'line') {
			const n = Math.ceil(distance(segment.start, segment.end) / 0.005);
			for (let i = 0; i <= n; i++) {
				const t = i / n;
				points.push({
					x: segment.start.x + (segment.end.x - segment.start.x) * t,
					y: segment.start.y + (segment.end.y - segment.start.y) * t
				});
			}
		} else {
			const sweep = arcSweep(segment);
			const n = Math.ceil((sweep * Math.PI * segment.radius) / 180 / 0.005);
			for (let i = 0; i <= n; i++) {
				points.push(arcPoint(segment, segment.startAngle - (i / n) * sweep));
			}
		}
	}
	return points;
}

function pass(model: BoardModel, index: number, stepover = 0.5) {
	return buildLayerToolpath(model, 'top', {
		isolationOffset: RADIUS + index * stepover * TOOL,
		minimumTrackWidth: 0,
		minimumPadDiameter: 0
	}).segments;
}

const totalLength = (segments: PathSegment[]) =>
	segments.reduce(
		(sum, s) =>
			sum +
			(s.kind === 'line' ? distance(s.start, s.end) : (arcSweep(s) * Math.PI * s.radius) / 180),
		0
	);

describe('clipToClearance', () => {
	it('leaves a lone track’s outer passes untouched', () => {
		const model = board([track(10, 1)], []);
		const clearance = buildCopperClearance(model, 'top', RADIUS);
		for (const index of [1, 2]) {
			const segments = pass(model, index);
			const clipped = clipToClearance(segments, clearance);
			expect(clipped.segments).toEqual(segments);
			expect(clipped.lengthAfter).toBeCloseTo(clipped.lengthBefore, 9);
		}
	});

	it('drops the part of an outer pass that would cut a neighbouring track', () => {
		// Copper edges 0.2 mm apart: the third pass of each track (offset 0.225,
		// cutting out to 0.3 mm) would bite 0.1 mm into the other.
		const a = track(10, 1);
		const b = track(10 + 0.25 + 0.2, 2);
		const model = board([a, b], []);
		const clearance = buildCopperClearance(model, 'top', RADIUS);

		const unclipped = pass(model, 2);
		const intruding = samplePoints(unclipped).filter(
			(p) =>
				pointToSegmentDistance(p, a) < a.width / 2 + RADIUS - 1e-6 ||
				pointToSegmentDistance(p, b) < b.width / 2 + RADIUS - 1e-6
		);
		expect(intruding.length).toBeGreaterThan(0);

		const clipped = clipToClearance(unclipped, clearance);
		for (const p of samplePoints(clipped.segments)) {
			expect(pointToSegmentDistance(p, a)).toBeGreaterThanOrEqual(a.width / 2 + RADIUS - 0.002);
			expect(pointToSegmentDistance(p, b)).toBeGreaterThanOrEqual(b.width / 2 + RADIUS - 0.002);
		}
		// The outer sides (below a, above b) are kept whole; the inner lines go.
		expect(clipped.segments).toHaveLength(2);
		expect(clipped.lengthAfter).toBeCloseTo(totalLength(clipped.segments), 6);
		expect(clipped.lengthAfter).toBeLessThan(clipped.lengthBefore);
	});

	it('keeps the inner lines where the gap is wide enough', () => {
		const a = track(10, 1);
		const b = track(10 + 0.25 + 0.8, 2);
		const model = board([a, b], []);
		const clearance = buildCopperClearance(model, 'top', RADIUS);
		const segments = pass(model, 2);
		expect(clipToClearance(segments, clearance).segments).toEqual(segments);
	});

	it('cuts a pad’s outer ring into the arcs that stay off a nearby track', () => {
		// Pad edge at y = 9.5; track copper starts 0.2 mm below it.
		const pad = circlePad(10, 10, 1, 1);
		const t = { ...track(9.5 - 0.2 - 0.125, 2) };
		const model = board([t], [pad]);
		const clearance = buildCopperClearance(model, 'top', RADIUS);

		const clipped = clipToClearance(pass(model, 2), clearance);
		const arcs = clipped.segments.filter((s) => s.kind === 'arc');
		expect(arcs.length).toBeGreaterThan(0);
		for (const arc of arcs) {
			// Partial arcs, not the full ring.
			expect(arcSweep(arc)).toBeLessThan(360);
		}
		for (const p of samplePoints(clipped.segments)) {
			expect(pointToSegmentDistance(p, t)).toBeGreaterThanOrEqual(t.width / 2 + RADIUS - 0.002);
			expect(distance(p, pad.position)).toBeGreaterThanOrEqual(0.5 + RADIUS - 0.002);
		}
	});

	it('keeps outer passes off rectangular pads too', () => {
		const pad = rectPad(10, 10.5 + 0.125 + 0.2 + 0.5, 2);
		const t = track(10.5, 1);
		const model = board([t], [pad]);
		const clearance = buildCopperClearance(model, 'top', RADIUS);
		const clipped = clipToClearance(pass(model, 2), clearance);
		for (const p of samplePoints(clipped.segments)) {
			const insideX = Math.abs(p.x - 10) <= 0.75 + RADIUS - 0.002;
			const insideY = Math.abs(p.y - pad.position.y) <= 0.5 + RADIUS - 0.002;
			expect(insideX && insideY).toBe(false);
		}
	});

	it('ignores copper on the other layer', () => {
		const a = track(10, 1);
		const b = { ...track(10 + 0.25 + 0.2, 2), layer: 'bottom' as const };
		const model = board([a, b], []);
		const clearance = buildCopperClearance(model, 'top', RADIUS);
		const segments = pass(model, 2);
		expect(clipToClearance(segments, clearance).segments).toEqual(segments);
	});
});
