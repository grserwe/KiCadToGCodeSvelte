import type { BoardModel, LayerId, Pad, Vec2 } from '../model/types';
import { distance, pointToSegmentDistance } from '../geometry/primitives';
import { OutlinePadGeometry } from '../geometry/outlinePad';
import { buildPadOutline } from '../geometry/outline';
import { arcPoint, arcSweep, makeArc, type PathSegment } from './segments';

/**
 * Keeping the extra isolation passes off copper.
 *
 * Every pass is built by offsetting each feature on its own, so pass 2 and up
 * of one track know nothing about the copper next to it: wherever two
 * features are closer than the full multi-pass cut, an outer pass of one cuts
 * into the other. Those passes are only there to widen the gap, so the parts
 * of them that would touch copper are simply left out.
 *
 * "Copper" is every designed track and pad on the layer, on any net,
 * including the pour's own tracks and pads. The pour copper the bit never
 * designed (the area between features) is not protected: widening the gap
 * into it is the point of the extra passes.
 */

/** Sampling step along a path when looking for copper (mm). */
const SAMPLE_STEP_MM = 0.02;
/** Bisection steps refining each boundary, from SAMPLE_STEP_MM down to ~5 nm. */
const REFINE_STEPS = 12;
/** Pieces shorter than this are dropped rather than plunged for (mm). */
const MINIMUM_PIECE_MM = 0.1;
/** Slack so a path sitting exactly at the tool radius from copper still counts as clear. */
const TOLERANCE_MM = 0.001;

interface Obstacle {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	/** True when a tool centered at the point would touch this copper. */
	blocks(point: Vec2): boolean;
}

export interface CopperClearance {
	/** True when a tool centered here stays off every piece of copper. */
	isClear(point: Vec2): boolean;
	/** The obstacles whose reach overlaps a box (pre-filter for one path). */
	near(minX: number, minY: number, maxX: number, maxY: number): Obstacle[];
}

/**
 * The region a tool of `toolRadius` must keep its center out of to leave
 * every track and pad on `layer` untouched.
 */
export function buildCopperClearance(
	board: BoardModel,
	layer: LayerId,
	toolRadius: number
): CopperClearance {
	const reach = Math.max(0, toolRadius - TOLERANCE_MM);
	const obstacles: Obstacle[] = [];

	for (const track of board.tracks) {
		if (track.layer !== layer) continue;
		const limit = track.width / 2 + reach;
		obstacles.push({
			minX: Math.min(track.start.x, track.end.x) - limit,
			minY: Math.min(track.start.y, track.end.y) - limit,
			maxX: Math.max(track.start.x, track.end.x) + limit,
			maxY: Math.max(track.start.y, track.end.y) + limit,
			blocks: (point) => pointToSegmentDistance(point, track) < limit
		});
	}

	for (const pad of board.pads) {
		if (!pad.plated || (pad.layers !== layer && pad.layers !== 'through')) continue;
		const obstacle = padObstacle(pad, reach);
		if (obstacle) obstacles.push(obstacle);
	}

	const near = (minX: number, minY: number, maxX: number, maxY: number) =>
		obstacles.filter((o) => o.maxX >= minX && o.minX <= maxX && o.maxY >= minY && o.minY <= maxY);

	return {
		isClear: (point) => !obstacles.some((o) => o.blocks(point)),
		near
	};
}

function padObstacle(pad: Pad, reach: number): Obstacle | null {
	if (pad.shape.kind === 'circle') {
		const limit = pad.shape.diameter / 2 + reach;
		const center = pad.position;
		return {
			minX: center.x - limit,
			minY: center.y - limit,
			maxX: center.x + limit,
			maxY: center.y + limit,
			blocks: (point) => distance(point, center) < limit
		};
	}

	const edges = buildPadOutline(pad.shape, pad.rotationDeg, pad.position, reach);
	if (edges.length === 0) return null;
	const geometry = new OutlinePadGeometry(pad.position, edges, false);
	const outline: Vec2[] = [];
	for (const edge of edges) edge.tessellate(outline);
	const xs = outline.map((p) => p.x);
	const ys = outline.map((p) => p.y);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
		blocks: (point) => geometry.containsPoint(point)
	};
}

export interface ClippedPass {
	segments: PathSegment[];
	/** Total path length before clipping (mm). */
	lengthBefore: number;
	/** Total path length kept (mm). */
	lengthAfter: number;
}

/**
 * Cut every segment down to the pieces along which the tool stays off
 * copper. Segments that are clear all the way are kept as they are.
 */
export function clipToClearance(segments: PathSegment[], clearance: CopperClearance): ClippedPass {
	const result: PathSegment[] = [];
	let lengthBefore = 0;
	let lengthAfter = 0;

	for (const segment of segments) {
		const length = segmentLength(segment);
		lengthBefore += length;
		if (length <= 0) continue;

		const at = pointAt(segment);
		const box = segmentBox(segment);
		const nearby = clearance.near(box.minX, box.minY, box.maxX, box.maxY);
		const isClear = (t: number) => {
			const point = at(t);
			return !nearby.some((o) => o.blocks(point));
		};

		const samples = Math.max(2, Math.ceil(length / SAMPLE_STEP_MM));
		const pieces: [number, number][] = [];
		let pieceStart: number | null = isClear(0) ? 0 : null;
		let previousT = 0;
		let previousClear = pieceStart !== null;
		for (let index = 1; index <= samples; index++) {
			const t = index / samples;
			const clear = isClear(t);
			if (clear !== previousClear) {
				const boundary = refine(isClear, previousT, t, previousClear);
				if (clear) {
					pieceStart = boundary;
				} else if (pieceStart !== null) {
					pieces.push([pieceStart, boundary]);
					pieceStart = null;
				}
			}
			previousT = t;
			previousClear = clear;
		}
		if (pieceStart !== null) pieces.push([pieceStart, 1]);

		if (pieces.length === 1 && pieces[0][0] === 0 && pieces[0][1] === 1) {
			result.push(segment);
			lengthAfter += length;
			continue;
		}
		for (const [from, to] of pieces) {
			if ((to - from) * length < MINIMUM_PIECE_MM) continue;
			result.push(subSegment(segment, from, to));
			lengthAfter += (to - from) * length;
		}
	}

	return { segments: result, lengthBefore, lengthAfter };
}

/** Bisect for the clear/blocked boundary between two parameters. */
function refine(
	isClear: (t: number) => boolean,
	from: number,
	to: number,
	fromClear: boolean
): number {
	let low = from;
	let high = to;
	for (let step = 0; step < REFINE_STEPS; step++) {
		const middle = (low + high) / 2;
		if (isClear(middle) === fromClear) low = middle;
		else high = middle;
	}
	// Stay on the clear side of the boundary.
	return fromClear ? low : high;
}

function segmentLength(segment: PathSegment): number {
	if (segment.kind === 'line') return distance(segment.start, segment.end);
	return (arcSweep(segment) * Math.PI * segment.radius) / 180;
}

/** Position along a segment, t from 0 (start) to 1 (end), in travel direction. */
function pointAt(segment: PathSegment): (t: number) => Vec2 {
	if (segment.kind === 'line') {
		const { start, end } = segment;
		return (t) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
	}
	const sweep = arcSweep(segment);
	// Arcs travel clockwise: the angle decreases from startAngle.
	return (t) => arcPoint(segment, segment.startAngle - t * sweep);
}

function subSegment(segment: PathSegment, from: number, to: number): PathSegment {
	if (segment.kind === 'line') {
		const at = pointAt(segment);
		return { kind: 'line', start: at(from), end: at(to) };
	}
	const sweep = arcSweep(segment);
	return makeArc(
		segment.center,
		segment.radius,
		segment.startAngle - from * sweep,
		segment.startAngle - to * sweep
	);
}

function segmentBox(segment: PathSegment): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	if (segment.kind === 'line') {
		return {
			minX: Math.min(segment.start.x, segment.end.x),
			minY: Math.min(segment.start.y, segment.end.y),
			maxX: Math.max(segment.start.x, segment.end.x),
			maxY: Math.max(segment.start.y, segment.end.y)
		};
	}
	// The arc's whole circle: a loose but safe bound.
	return {
		minX: segment.center.x - segment.radius,
		minY: segment.center.y - segment.radius,
		maxX: segment.center.x + segment.radius,
		maxY: segment.center.y + segment.radius
	};
}
