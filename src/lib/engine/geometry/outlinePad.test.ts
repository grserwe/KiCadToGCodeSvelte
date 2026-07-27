import { describe, expect, it } from 'vitest';
import { buildPadOutline } from './outline';
import { OutlinePadGeometry } from './outlinePad';
import { createRoute } from '../toolpath/routes';
import type { Vec2 } from '../model/types';

/** Regular hexagon, circumradius 1.5, flat sides top and bottom — CCW. */
const HEXAGON_POINTS: Vec2[] = [
	{ x: 1.5, y: 0 },
	{ x: 0.75, y: 1.299038 },
	{ x: -0.75, y: 1.299038 },
	{ x: -1.5, y: 0 },
	{ x: -0.75, y: -1.299038 },
	{ x: 0.75, y: -1.299038 }
];

describe('buildPadOutline', () => {
	it('builds a rectangle as four line edges', () => {
		const edges = buildPadOutline({ kind: 'rect', sizeX: 2, sizeY: 1 }, 0, { x: 0, y: 0 }, 0);
		expect(edges).toHaveLength(4);
		const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
		expect(perimeter).toBeCloseTo(6, 6);
	});

	it('inflates a rectangle into lines plus corner arcs', () => {
		const edges = buildPadOutline({ kind: 'rect', sizeX: 2, sizeY: 1 }, 0, { x: 0, y: 0 }, 0.5);
		// 4 shifted edges + 4 corner arcs of radius 0.5.
		expect(edges).toHaveLength(8);
		const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
		expect(perimeter).toBeCloseTo(6 + 2 * Math.PI * 0.5, 5);
	});

	it('builds a stadium for oval pads', () => {
		const edges = buildPadOutline({ kind: 'oval', sizeX: 3, sizeY: 1 }, 0, { x: 0, y: 0 }, 0);
		expect(edges).toHaveLength(4);
		const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
		// Two 2mm straights + full circle of radius 0.5.
		expect(perimeter).toBeCloseTo(4 + Math.PI, 5);
	});

	it('rotates and translates edges into world space', () => {
		const edges = buildPadOutline({ kind: 'rect', sizeX: 2, sizeY: 1 }, 90, { x: 10, y: 5 }, 0);
		// After 90° CCW rotation the 2mm-wide rect stands upright: x spans
		// ±0.5 around 10, y spans ±1 around 5.
		const xs = edges.flatMap((e) => [e.start.x, e.end.x]);
		const ys = edges.flatMap((e) => [e.start.y, e.end.y]);
		expect(Math.min(...xs)).toBeCloseTo(9.5, 6);
		expect(Math.max(...xs)).toBeCloseTo(10.5, 6);
		expect(Math.min(...ys)).toBeCloseTo(4, 6);
		expect(Math.max(...ys)).toBeCloseTo(6, 6);
	});
});

describe('OutlinePadGeometry — hexagonal pad', () => {
	const buildHexPad = (isGround = false) =>
		new OutlinePadGeometry(
			{ x: 0, y: 0 },
			buildPadOutline({ kind: 'polygon', points: HEXAGON_POINTS }, 0, { x: 0, y: 0 }, 0),
			isGround
		);

	it('measures the hexagon perimeter', () => {
		const pad = buildHexPad();
		expect(pad.perimeter).toBeCloseTo(9, 4);
	});

	it('contains interior points and rejects exterior points', () => {
		const pad = buildHexPad();
		expect(pad.containsPoint({ x: 0, y: 0 })).toBe(true);
		expect(pad.containsPoint({ x: 1.4, y: 0.05 })).toBe(true);
		expect(pad.containsPoint({ x: 2, y: 0 })).toBe(false);
		expect(pad.containsPoint({ x: 0, y: 1.4 })).toBe(false);
	});

	it('engraves the full outline when untouched', () => {
		const pad = buildHexPad();
		const segments = pad.isolationSegments();
		expect(segments).toHaveLength(6);
	});

	it('leaves a gap where a track enters through a vertex', () => {
		const pad = buildHexPad();
		const route = createRoute({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 'top');

		for (const line of [route.line1, route.line2]) {
			const intersection = pad.segmentBoundaryIntersection(line);
			expect(intersection).not.toBeNull();
			line.start = intersection!;
			line.startIntersectsPad = true;
		}
		pad.touchingRoutes.push(route);

		// The offset line at y=0.5 crosses the edge (1.5,0)→(0.75,1.299) at
		// x = 1.5 − 0.75·(0.5/1.299038) ≈ 1.21132.
		expect(route.line1.start.x).toBeCloseTo(1.21132, 4);

		const segments = pad.isolationSegments();
		const total = segments.reduce(
			(sum, s) =>
				s.kind === 'line' ? sum + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) : sum,
			0
		);

		// Keep length: perimeter minus the gap between the two contacts
		// around the vertex at (1.5, 0). Contact distances along the
		// perimeter: 0.57735 (edge 0) and 9 − 0.57735.
		expect(total).toBeCloseTo(9 - 2 * 0.57735, 3);
		expect(segments.length).toBe(6); // partial edge 0, full edges 1–4, partial edge 5
	});

	it('gives ground pads four evenly spaced gaps', () => {
		const pad = buildHexPad(true);
		const segments = pad.isolationSegments();
		const total = segments.reduce(
			(sum, s) =>
				s.kind === 'line' ? sum + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) : sum,
			0
		);
		// Four gaps of perimeter/8 each → half the perimeter remains.
		expect(total).toBeCloseTo(4.5, 4);
	});
});
