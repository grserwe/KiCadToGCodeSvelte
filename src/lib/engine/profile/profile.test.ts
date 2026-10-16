import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BoardModel, Graphic } from '../model/types';
import { ArcEdge, LineEdge, type OutlineEdge } from '../geometry/outline';
import { parseBoard } from '../parser/parseBoard';
import { boardOutlineLoops, signedArea, tessellateLoop } from './loops';
import { offsetLoopRight } from './offset';
import { buildProfileToolpath } from './toolpath';

function boardWith(graphics: Graphic[], width = 30, height = 20): BoardModel {
	return { width, height, fileVersion: 20241229, tracks: [], pads: [], graphics };
}

const line = (x1: number, y1: number, x2: number, y2: number): Graphic => ({
	kind: 'line',
	layer: 'edge',
	start: { x: x1, y: y1 },
	end: { x: x2, y: y2 },
	width: 0.1
});

function bounds(edges: OutlineEdge[]) {
	const points = tessellateLoop(edges);
	return {
		minX: Math.min(...points.map((p) => p.x)),
		maxX: Math.max(...points.map((p) => p.x)),
		minY: Math.min(...points.map((p) => p.y)),
		maxY: Math.max(...points.map((p) => p.y))
	};
}

/** Every edge should end exactly where the next begins, around to the start. */
function expectContinuous(edges: OutlineEdge[]) {
	for (let index = 0; index < edges.length; index++) {
		const next = edges[(index + 1) % edges.length];
		expect(edges[index].end.x).toBeCloseTo(next.start.x, 5);
		expect(edges[index].end.y).toBeCloseTo(next.start.y, 5);
	}
}

describe('boardOutlineLoops', () => {
	it('chains the sample board’s four Edge.Cuts lines into one CCW loop', () => {
		const sample = readFileSync(
			new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
			'utf8'
		);
		const { board } = parseBoard(sample);
		const result = boardOutlineLoops(board);
		expect(result.fromExtents).toBe(false);
		expect(result.warnings).toEqual([]);
		expect(result.loops).toHaveLength(1);
		const [loop] = result.loops;
		expect(loop.outer).toBe(true);
		expect(loop.edges).toHaveLength(4);
		expectContinuous(loop.edges);
		expect(signedArea(tessellateLoop(loop.edges))).toBeCloseTo(board.width * board.height, 3);
	});

	it('joins lines drawn in any direction, bridging small gaps', () => {
		const board = boardWith([
			line(0, 0, 10, 0),
			line(10, 10, 10, 0.01), // reversed, and 0.01 short of the corner
			line(0, 10, 10, 10),
			line(0, 0, 0, 10)
		]);
		const result = boardOutlineLoops(board);
		expect(result.warnings).toEqual([]);
		expect(result.loops).toHaveLength(1);
		expectContinuous(result.loops[0].edges);
		expect(signedArea(tessellateLoop(result.loops[0].edges))).toBeGreaterThan(99);
	});

	it('winds a circle inside the boundary clockwise and lists it after the boundary', () => {
		const board = boardWith([
			{
				kind: 'polygon',
				layer: 'edge',
				points: [
					{ x: 0, y: 0 },
					{ x: 30, y: 0 },
					{ x: 30, y: 20 },
					{ x: 0, y: 20 }
				],
				width: 0.1,
				filled: false
			},
			{
				kind: 'circle',
				layer: 'edge',
				center: { x: 15, y: 10 },
				radius: 3,
				width: 0.1,
				filled: false
			}
		]);
		const { loops } = boardOutlineLoops(board);
		expect(loops.map((loop) => loop.outer)).toEqual([true, false]);
		expect(signedArea(tessellateLoop(loops[0].edges))).toBeGreaterThan(0);
		expect(signedArea(tessellateLoop(loops[1].edges))).toBeLessThan(0);
		expect(loops[1].area).toBeCloseTo(Math.PI * 9, 0);
	});

	it('reports open edges and falls back to the extents when nothing closes', () => {
		const board = boardWith([line(0, 0, 10, 0), line(10, 0, 10, 10)], 30, 20);
		const result = boardOutlineLoops(board);
		expect(result.fromExtents).toBe(true);
		expect(result.warnings.map((w) => w.code)).toEqual(['outline-open', 'outline-open']);
		expect(result.loops).toHaveLength(1);
		expect(bounds(result.loops[0].edges)).toEqual({ minX: 0, maxX: 30, minY: 0, maxY: 20 });
	});
});

describe('offsetLoopRight', () => {
	const square: OutlineEdge[] = [
		new LineEdge({ x: 0, y: 0 }, { x: 10, y: 0 }),
		new LineEdge({ x: 10, y: 0 }, { x: 10, y: 10 }),
		new LineEdge({ x: 10, y: 10 }, { x: 0, y: 10 }),
		new LineEdge({ x: 0, y: 10 }, { x: 0, y: 0 })
	];

	it('grows a CCW square outward with rounded corners', () => {
		const { edges, tightArcs } = offsetLoopRight(square, 1);
		expect(tightArcs).toBe(0);
		expect(edges.map((edge) => edge.kind)).toEqual([
			'line',
			'arc',
			'line',
			'arc',
			'line',
			'arc',
			'line',
			'arc'
		]);
		expectContinuous(edges);
		expect(bounds(edges)).toEqual({ minX: -1, maxX: 11, minY: -1, maxY: 11 });
		const arc = edges[1] as ArcEdge;
		expect(arc.center).toEqual({ x: 10, y: 0 });
		expect(arc.radius).toBe(1);
		expect(arc.sweep).toBeCloseTo(90, 6);
	});

	it('shrinks a CW square inward with sharp trimmed corners', () => {
		const clockwise = square.map((edge) => edge.reversed()).reverse();
		const { edges } = offsetLoopRight(clockwise, 1);
		expect(edges.every((edge) => edge.kind === 'line')).toBe(true);
		expect(edges).toHaveLength(4);
		expectContinuous(edges);
		expect(bounds(edges)).toEqual({ minX: 1, maxX: 9, minY: 1, maxY: 9 });
	});

	it('trims the inside corner of an L-shape and rounds the outside ones', () => {
		const lShape: OutlineEdge[] = [
			new LineEdge({ x: 0, y: 0 }, { x: 10, y: 0 }),
			new LineEdge({ x: 10, y: 0 }, { x: 10, y: 4 }),
			new LineEdge({ x: 10, y: 4 }, { x: 4, y: 4 }), // → inside corner at (4,4)
			new LineEdge({ x: 4, y: 4 }, { x: 4, y: 10 }),
			new LineEdge({ x: 4, y: 10 }, { x: 0, y: 10 }),
			new LineEdge({ x: 0, y: 10 }, { x: 0, y: 0 })
		];
		const { edges } = offsetLoopRight(lShape, 1);
		expectContinuous(edges);
		// Five convex corners get arcs; the reflex one is a plain line-line meeting.
		expect(edges.filter((edge) => edge.kind === 'arc')).toHaveLength(5);
		const meeting = edges.find(
			(edge) =>
				edge.kind === 'line' && Math.abs(edge.end.x - 5) < 1e-9 && Math.abs(edge.end.y - 5) < 1e-9
		);
		expect(meeting).toBeDefined();
		// The cutter centre never comes closer than its radius to the material,
		// which is the union of two rectangles.
		const rectDistance = (p: { x: number; y: number }, maxX: number, maxY: number) =>
			Math.hypot(Math.max(-p.x, 0, p.x - maxX), Math.max(-p.y, 0, p.y - maxY));
		for (const point of tessellateLoop(edges)) {
			const clearance = Math.min(rectDistance(point, 10, 4), rectDistance(point, 4, 10));
			expect(clearance).toBeGreaterThanOrEqual(1 - 1e-6);
			expect(clearance).toBeLessThanOrEqual(1 + 1e-6);
		}
	});

	it('grows convex arcs and shrinks concave ones', () => {
		// Rounded-corner square: a CCW 90° arc at the top-right.
		const rounded: OutlineEdge[] = [
			new LineEdge({ x: 0, y: 0 }, { x: 10, y: 0 }),
			new LineEdge({ x: 10, y: 0 }, { x: 10, y: 8 }),
			new ArcEdge({ x: 8, y: 8 }, 2, 0, 90),
			new LineEdge({ x: 8, y: 10 }, { x: 0, y: 10 }),
			new LineEdge({ x: 0, y: 10 }, { x: 0, y: 0 })
		];
		const grown = offsetLoopRight(rounded, 1).edges;
		expectContinuous(grown);
		const corner = grown.find((edge) => edge.kind === 'arc' && edge.center.x === 8) as ArcEdge;
		expect(corner.radius).toBe(3);

		// A semicircular bite out of the top edge: a CW arc on a CCW loop.
		const bitten: OutlineEdge[] = [
			new LineEdge({ x: 0, y: 0 }, { x: 10, y: 0 }),
			new LineEdge({ x: 10, y: 0 }, { x: 10, y: 10 }),
			new LineEdge({ x: 10, y: 10 }, { x: 7, y: 10 }),
			new ArcEdge({ x: 5, y: 10 }, 2, 0, -180),
			new LineEdge({ x: 3, y: 10 }, { x: 0, y: 10 }),
			new LineEdge({ x: 0, y: 10 }, { x: 0, y: 0 })
		];
		const shrunk = offsetLoopRight(bitten, 0.5);
		expect(shrunk.tightArcs).toBe(0);
		expectContinuous(shrunk.edges);
		const bite = shrunk.edges.find((edge) => edge.kind === 'arc' && edge.center.x === 5) as ArcEdge;
		expect(bite.radius).toBe(1.5);
		expect(bite.sweep).toBeCloseTo(-180, 6);

		// A cutter wider than the bite can't follow it: the arc collapses to a cusp.
		const tooBig = offsetLoopRight(bitten, 2.5);
		expect(tooBig.tightArcs).toBe(1);
		expectContinuous(tooBig.edges);
	});
});

describe('buildProfileToolpath', () => {
	it('cuts holes before the boundary and skips holes smaller than the cutter', () => {
		const board = boardWith([
			{
				kind: 'polygon',
				layer: 'edge',
				points: [
					{ x: 0, y: 0 },
					{ x: 30, y: 0 },
					{ x: 30, y: 20 },
					{ x: 0, y: 20 }
				],
				width: 0.1,
				filled: false
			},
			{
				kind: 'circle',
				layer: 'edge',
				center: { x: 10, y: 10 },
				radius: 3,
				width: 0.1,
				filled: false
			},
			{
				kind: 'circle',
				layer: 'edge',
				center: { x: 22, y: 10 },
				radius: 0.4,
				width: 0.1,
				filled: false
			}
		]);
		const { loops, warnings } = buildProfileToolpath(board, 1);
		expect(loops.map((loop) => loop.outer)).toEqual([false, true]);
		expect(loops[0].length).toBeCloseTo(2 * Math.PI * 2.5, 6);
		expect(bounds(loops[1].edges)).toEqual({ minX: -0.5, maxX: 30.5, minY: -0.5, maxY: 20.5 });
		expect(warnings.map((w) => w.code)).toEqual(['outline-tight']);
	});
});
