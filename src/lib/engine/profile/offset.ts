import type { Vec2 } from '../model/types';
import { ArcEdge, LineEdge, type OutlineEdge } from '../geometry/outline';
import {
	angleDeg,
	distance,
	infiniteLineIntersection,
	normalizeAngle
} from '../geometry/primitives';

const MINIMUM_EDGE_LENGTH = 0.0001;
/** How far an intersection may sit off an edge and still count as on it (mm). */
const ON_EDGE_TOLERANCE = 0.001;

export interface OffsetLoopResult {
	edges: OutlineEdge[];
	/** Inward-curving arcs whose radius was smaller than the offset: the cutter cannot follow them. */
	tightArcs: number;
}

/**
 * Offset a closed loop to its right-hand side by `amount` — the cutter's
 * centreline when the material lies on the loop's left. Lines shift along
 * their right-hand normal; arcs curving left (counter-clockwise) grow, arcs
 * curving right shrink. At a left turn the offset edges pull apart and the
 * gap is closed with an arc of radius `amount` around the original corner;
 * at a right turn they overlap and are trimmed back to their intersection.
 * Inward arcs tighter than the offset are dropped (counted in `tightArcs`)
 * and their neighbours meet in a cusp, so the cutter overcuts there instead
 * of wandering.
 */
export function offsetLoopRight(loop: OutlineEdge[], amount: number): OffsetLoopResult {
	if (amount <= 0 || loop.length === 0) return { edges: [...loop], tightArcs: 0 };

	interface Piece {
		edge: OutlineEdge;
		/** The original vertex at this piece's end, where it meets the next piece. */
		corner: Vec2;
		/** A neighbouring arc collapsed here: trim to the cusp instead of judging the turn. */
		forceTrim: boolean;
		/** Edge inserted after this piece to close a gap at a left turn. */
		join: OutlineEdge | null;
	}

	let tightArcs = 0;
	let trimFirstJoin = false;
	const pieces: Piece[] = [];
	for (const edge of loop) {
		const offset = offsetEdge(edge, amount);
		if (!offset) {
			tightArcs++;
			// The arc vanishes; the pieces either side of it must meet each other.
			const previous = pieces[pieces.length - 1];
			if (previous) {
				previous.corner = edge.end;
				previous.forceTrim = true;
			} else {
				trimFirstJoin = true;
			}
			continue;
		}
		pieces.push({ edge: offset, corner: edge.end, forceTrim: false, join: null });
	}
	if (pieces.length === 0) return { edges: [], tightArcs };
	if (trimFirstJoin) pieces[pieces.length - 1].forceTrim = true;

	for (let index = 0; index < pieces.length; index++) {
		const piece = pieces[index];
		const next = pieces[(index + 1) % pieces.length];
		const gapStart = piece.edge.end;
		const gapEnd = next.edge.start;
		if (distance(gapStart, gapEnd) <= MINIMUM_EDGE_LENGTH) continue;

		const startAngle = angleDeg(piece.corner, gapStart);
		const sweep = normalizeAngle(angleDeg(piece.corner, gapEnd) - startAngle);
		if (!piece.forceTrim && sweep <= 180 + 1e-6) {
			// Left turn: swing around the corner at the offset distance.
			piece.join = new ArcEdge(piece.corner, amount, startAngle, sweep);
			continue;
		}

		// Right turn (or a collapsed arc): the offsets overlap — cut them back.
		const meeting = nearestIntersection(piece.edge, next.edge, piece.corner);
		if (meeting) {
			piece.edge = trimEnd(piece.edge, meeting);
			next.edge = trimStart(next.edge, meeting);
		} else {
			piece.join = new LineEdge(gapStart, gapEnd);
		}
	}

	const edges: OutlineEdge[] = [];
	for (const piece of pieces) {
		for (const edge of [piece.edge, piece.join]) {
			if (edge && edge.length > MINIMUM_EDGE_LENGTH) edges.push(edge);
		}
	}
	return { edges, tightArcs };
}

/** The edge shifted to its right by `amount`; null for an arc that collapses. */
function offsetEdge(edge: OutlineEdge, amount: number): OutlineEdge | null {
	if (edge.kind === 'line') {
		const dx = edge.end.x - edge.start.x;
		const dy = edge.end.y - edge.start.y;
		const length = Math.hypot(dx, dy);
		const normal = { x: dy / length, y: -dx / length };
		return new LineEdge(
			{ x: edge.start.x + normal.x * amount, y: edge.start.y + normal.y * amount },
			{ x: edge.end.x + normal.x * amount, y: edge.end.y + normal.y * amount }
		);
	}
	// A left-curving arc has its centre on the left: the right-hand offset is
	// further out. A right-curving arc's centre is on the right: it shrinks.
	const radius = edge.sweep >= 0 ? edge.radius + amount : edge.radius - amount;
	if (radius <= MINIMUM_EDGE_LENGTH) return null;
	return new ArcEdge(edge.center, radius, edge.startAngle, edge.sweep);
}

/** Intersection of two offset edges closest to the original corner, if they meet. */
function nearestIntersection(a: OutlineEdge, b: OutlineEdge, corner: Vec2): Vec2 | null {
	let best: Vec2 | null = null;
	let bestDistance = Infinity;
	for (const point of curveIntersections(a, b)) {
		if (a.distanceToPoint(point).distance > ON_EDGE_TOLERANCE) continue;
		if (b.distanceToPoint(point).distance > ON_EDGE_TOLERANCE) continue;
		const d = distance(point, corner);
		if (d < bestDistance) {
			bestDistance = d;
			best = point;
		}
	}
	return best;
}

/** Intersections of the infinite line / full circle carrying each edge. */
function curveIntersections(a: OutlineEdge, b: OutlineEdge): Vec2[] {
	if (a.kind === 'line' && b.kind === 'line') {
		const point = infiniteLineIntersection(a, b);
		return point ? [point] : [];
	}
	if (a.kind === 'line') return lineCircle(a, b as ArcEdge);
	if (b.kind === 'line') return lineCircle(b, a);
	return circleCircle(a, b as ArcEdge);
}

function lineCircle(line: LineEdge, arc: ArcEdge): Vec2[] {
	const dx = line.end.x - line.start.x;
	const dy = line.end.y - line.start.y;
	const fx = line.start.x - arc.center.x;
	const fy = line.start.y - arc.center.y;
	const a = dx * dx + dy * dy;
	const b = 2 * (fx * dx + fy * dy);
	const c = fx * fx + fy * fy - arc.radius * arc.radius;
	const det = b * b - 4 * a * c;
	if (a < 1e-12 || det < 0) return [];
	const root = Math.sqrt(det);
	return [(-b + root) / (2 * a), (-b - root) / (2 * a)].map((t) => ({
		x: line.start.x + t * dx,
		y: line.start.y + t * dy
	}));
}

function circleCircle(a: ArcEdge, b: ArcEdge): Vec2[] {
	const d = distance(a.center, b.center);
	if (d < 1e-9 || d > a.radius + b.radius || d < Math.abs(a.radius - b.radius)) return [];
	const along = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
	const h = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
	const ux = (b.center.x - a.center.x) / d;
	const uy = (b.center.y - a.center.y) / d;
	const mid = { x: a.center.x + ux * along, y: a.center.y + uy * along };
	return [
		{ x: mid.x - uy * h, y: mid.y + ux * h },
		{ x: mid.x + uy * h, y: mid.y - ux * h }
	];
}

function trimEnd(edge: OutlineEdge, point: Vec2): OutlineEdge {
	if (edge.kind === 'line') return new LineEdge(edge.start, point);
	return new ArcEdge(edge.center, edge.radius, edge.startAngle, sweepTo(edge, point));
}

function trimStart(edge: OutlineEdge, point: Vec2): OutlineEdge {
	if (edge.kind === 'line') return new LineEdge(point, edge.end);
	const consumed = sweepTo(edge, point);
	return new ArcEdge(edge.center, edge.radius, edge.startAngle + consumed, edge.sweep - consumed);
}

/** Signed sweep from the arc's start to a point on its circle, in the arc's direction. */
function sweepTo(arc: ArcEdge, point: Vec2): number {
	const direction = arc.sweep >= 0 ? 1 : -1;
	const into = normalizeAngle(direction * (angleDeg(arc.center, point) - arc.startAngle));
	return direction * Math.min(into, Math.abs(arc.sweep));
}
