import type { BoardModel, EngineWarning, Vec2 } from '../model/types';
import { ArcEdge, LineEdge, type OutlineEdge } from '../geometry/outline';
import { distance } from '../geometry/primitives';

/** Endpoints this close (mm) are joined; KiCad itself chains Edge.Cuts at 0.01 mm. */
const CHAIN_TOLERANCE = 0.05;
const MINIMUM_EDGE_LENGTH = 0.0001;
/** Loops enclosing less than this (mm²) are drawing noise, not a cutout. */
const MINIMUM_LOOP_AREA = 0.01;

/**
 * A closed chain of edges: each edge ends where the next one starts, and the
 * last ends at the first's start. Orientation is normalised so that the board
 * material is always on the LEFT when walking the loop: the outer boundary
 * runs counter-clockwise, inner cutouts clockwise. Offsetting every loop to
 * its right-hand side then keeps the cutter off the board everywhere.
 */
export interface OutlineLoop {
	edges: OutlineEdge[];
	/** True for a board boundary; false for a hole cut inside one. */
	outer: boolean;
	/** Enclosed area in mm². */
	area: number;
}

export interface OutlineLoopsResult {
	/** Outer boundaries first, then the cutouts inside them. */
	loops: OutlineLoop[];
	warnings: EngineWarning[];
	/** True when no closed Edge.Cuts shape existed and the board's extents were used. */
	fromExtents: boolean;
}

/**
 * Chain the Edge.Cuts drawings of a board into closed loops. Lines and arcs
 * are joined end to end (in either direction) within a small tolerance;
 * circles and polygons are loops already. A board with no closed outline
 * falls back to the rectangle of its extents.
 */
export function boardOutlineLoops(board: BoardModel): OutlineLoopsResult {
	const warnings: EngineWarning[] = [];
	const closed: OutlineEdge[][] = [];
	const open: OutlineEdge[] = [];

	for (const graphic of board.graphics) {
		if (graphic.layer !== 'edge') continue;
		switch (graphic.kind) {
			case 'line':
				if (distance(graphic.start, graphic.end) > MINIMUM_EDGE_LENGTH) {
					open.push(new LineEdge(graphic.start, graphic.end));
				}
				break;
			case 'arc':
				if (graphic.radius > MINIMUM_EDGE_LENGTH && Math.abs(graphic.sweep) > 0.001) {
					open.push(new ArcEdge(graphic.center, graphic.radius, graphic.startAngle, graphic.sweep));
				}
				break;
			case 'circle':
				if (graphic.radius > MINIMUM_EDGE_LENGTH) {
					closed.push([
						new ArcEdge(graphic.center, graphic.radius, 0, 180),
						new ArcEdge(graphic.center, graphic.radius, 180, 180)
					]);
				}
				break;
			case 'polygon': {
				const edges = polygonLoop(graphic.points);
				if (edges.length >= 3) closed.push(edges);
				else open.push(...edges);
				break;
			}
			case 'text':
				break;
		}
	}

	const dangling = chainOpenEdges(open, closed);
	if (dangling > 0) {
		warnings.push({
			code: 'outline-open',
			message: `${dangling} drawing${dangling === 1 ? '' : 's'} on the board outline (Edge.Cuts) ${dangling === 1 ? 'does' : 'do'} not join into a closed shape and ${dangling === 1 ? 'was' : 'were'} left out of the cutout.`
		});
	}

	const loops = orientLoops(closed);
	if (loops.length > 0) return { loops, warnings, fromExtents: false };

	warnings.push({
		code: 'outline-open',
		message:
			'The board has no closed outline on Edge.Cuts, so the cutout follows the rectangle of its extents.'
	});
	const rectangle = polygonLoop([
		{ x: 0, y: 0 },
		{ x: board.width, y: 0 },
		{ x: board.width, y: board.height },
		{ x: 0, y: board.height }
	]);
	return { loops: orientLoops([rectangle]), warnings, fromExtents: true };
}

/** Closed chain of line edges through the points (consecutive duplicates dropped). */
function polygonLoop(points: Vec2[]): LineEdge[] {
	const edges: LineEdge[] = [];
	for (let index = 0; index < points.length; index++) {
		const start = points[index];
		const end = points[(index + 1) % points.length];
		if (distance(start, end) > MINIMUM_EDGE_LENGTH) edges.push(new LineEdge(start, end));
	}
	return edges;
}

/**
 * Greedily chain open edges by nearest endpoint. Closed chains are appended
 * to `closed`; returns how many drawings could not be chained into a loop.
 */
function chainOpenEdges(open: OutlineEdge[], closed: OutlineEdge[][]): number {
	const remaining = [...open];
	let dangling = 0;

	while (remaining.length > 0) {
		const chain: OutlineEdge[] = [remaining.shift()!];
		let drawings = 1;
		let isClosed = false;

		for (;;) {
			const tail = chain[chain.length - 1].end;
			const head = chain[0].start;
			if (chain.length > 1 && distance(tail, head) <= CHAIN_TOLERANCE) {
				if (distance(tail, head) > MINIMUM_EDGE_LENGTH) chain.push(new LineEdge(tail, head));
				isClosed = true;
				break;
			}

			let bestIndex = -1;
			let bestDistance = CHAIN_TOLERANCE;
			let reverse = false;
			for (let index = 0; index < remaining.length; index++) {
				const edge = remaining[index];
				const toStart = distance(tail, edge.start);
				const toEnd = distance(tail, edge.end);
				if (toStart <= bestDistance) {
					bestDistance = toStart;
					bestIndex = index;
					reverse = false;
				}
				if (toEnd < bestDistance) {
					bestDistance = toEnd;
					bestIndex = index;
					reverse = true;
				}
			}
			if (bestIndex < 0) break;

			const next = remaining.splice(bestIndex, 1)[0];
			const oriented = reverse ? next.reversed() : next;
			// Bridge small gaps so the loop stays continuous for the cutter.
			if (distance(tail, oriented.start) > MINIMUM_EDGE_LENGTH) {
				chain.push(new LineEdge(tail, oriented.start));
			}
			chain.push(oriented);
			drawings++;
		}

		if (isClosed) closed.push(chain);
		else dangling += drawings;
	}
	return dangling;
}

/**
 * Sort loops largest first, decide which are holes (their start lies inside a
 * larger loop), and wind outer loops counter-clockwise and holes clockwise.
 */
function orientLoops(chains: OutlineEdge[][]): OutlineLoop[] {
	const measured = chains
		.map((edges) => {
			const points = tessellateLoop(edges);
			return { edges, points, signedArea: signedArea(points) };
		})
		.filter((loop) => Math.abs(loop.signedArea) >= MINIMUM_LOOP_AREA)
		.sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea));

	const loops: OutlineLoop[] = [];
	const outers: Vec2[][] = [];
	for (const loop of measured) {
		const outer = !outers.some((polygon) => pointInPolygon(loop.points[0], polygon));
		const counterClockwise = loop.signedArea > 0;
		const edges = counterClockwise === outer ? loop.edges : reverseLoop(loop.edges);
		loops.push({ edges, outer, area: Math.abs(loop.signedArea) });
		if (outer) outers.push(loop.points);
	}
	// Outer boundaries first; the caller cuts holes before freeing the board.
	return loops.sort((a, b) => Number(b.outer) - Number(a.outer));
}

/** Walk the loop backwards: edges reversed, in reverse order. */
export function reverseLoop(edges: OutlineEdge[]): OutlineEdge[] {
	return edges.map((edge) => edge.reversed()).reverse();
}

export function tessellateLoop(edges: OutlineEdge[]): Vec2[] {
	const points: Vec2[] = [];
	for (const edge of edges) edge.tessellate(points);
	return points;
}

export function signedArea(points: Vec2[]): number {
	let doubleArea = 0;
	for (let index = 0; index < points.length; index++) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		doubleArea += current.x * next.y - next.x * current.y;
	}
	return doubleArea / 2;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if (a.y > point.y !== b.y > point.y) {
			const crossX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
			if (point.x < crossX) inside = !inside;
		}
	}
	return inside;
}
