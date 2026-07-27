import type { Vec2 } from '../model/types';

/** Positions matching to 4 decimal places (0.1 µm) are the same point. */
export const POSITION_DECIMALS = 4;

export function positionKey(point: Vec2): string {
	return `${point.x.toFixed(POSITION_DECIMALS)},${point.y.toFixed(POSITION_DECIMALS)}`;
}

export function samePosition(a: Vec2, b: Vec2): boolean {
	return positionKey(a) === positionKey(b);
}

export function distance(a: Vec2, b: Vec2): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

export const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;
export const radToDeg = (radians: number): number => (radians * 180) / Math.PI;

/** Normalize an angle to [0, 360). */
export function normalizeAngle(degrees: number): number {
	const result = degrees % 360;
	return result < 0 ? result + 360 : result;
}

/** Angle of the vector from `from` to `to`: 0° = +X, counterclockwise-positive. */
export function angleDeg(from: Vec2, to: Vec2): number {
	return normalizeAngle(radToDeg(Math.atan2(to.y - from.y, to.x - from.x)));
}

export function positiveModulo(value: number, modulus: number): number {
	const result = value % modulus;
	return result < 0 ? result + modulus : result;
}

export interface Segment2 {
	start: Vec2;
	end: Vec2;
}

/**
 * Intersection of the two INFINITE lines through the segments. Parallel lines
 * yield null unless they share an endpoint (matches the C# Line class, which
 * junction pairing relies on: a parallel test line means "wrong side").
 */
export function infiniteLineIntersection(a: Segment2, b: Segment2): Vec2 | null {
	const a1 = a.end.y - a.start.y;
	const b1 = a.start.x - a.end.x;
	const c1 = a1 * a.start.x + b1 * a.start.y;

	const a2 = b.end.y - b.start.y;
	const b2 = b.start.x - b.end.x;
	const c2 = a2 * b.start.x + b2 * b.start.y;

	const det = a1 * b2 - a2 * b1;
	if (det !== 0) {
		return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
	}

	if (samePosition(a.start, b.start) || samePosition(a.start, b.end)) return { ...a.start };
	if (samePosition(a.end, b.end) || samePosition(a.end, b.start)) return { ...a.end };
	return null;
}

/**
 * Whether the point lies on the segment (within tolerance). The bounding box
 * is widened by the tolerance so axis-aligned segments accept points carrying
 * ordinary floating-point error.
 */
export function pointOnSegment(segment: Segment2, point: Vec2, tolerance = 0.0001): boolean {
	const cross =
		(segment.end.x - segment.start.x) * (point.y - segment.start.y) -
		(segment.end.y - segment.start.y) * (point.x - segment.start.x);
	if (Math.abs(cross) > tolerance) return false;

	const minX = Math.min(segment.start.x, segment.end.x) - tolerance;
	const maxX = Math.max(segment.start.x, segment.end.x) + tolerance;
	const minY = Math.min(segment.start.y, segment.end.y) - tolerance;
	const maxY = Math.max(segment.start.y, segment.end.y) + tolerance;
	return minX <= point.x && point.x <= maxX && minY <= point.y && point.y <= maxY;
}

/** Point within the segment's bounding box, rounded to 5 decimals (C# parity). */
export function pointWithinSegmentBounds(point: Vec2, segment: Segment2): boolean {
	const round = (v: number) => Math.round(v * 1e5) / 1e5;
	const px = round(point.x);
	const py = round(point.y);
	return (
		round(Math.min(segment.start.x, segment.end.x)) <= px &&
		px <= round(Math.max(segment.start.x, segment.end.x)) &&
		round(Math.min(segment.start.y, segment.end.y)) <= py &&
		py <= round(Math.max(segment.start.y, segment.end.y))
	);
}

/** Shortest distance from a point to a segment. */
export function pointToSegmentDistance(point: Vec2, segment: Segment2): number {
	const dx = segment.end.x - segment.start.x;
	const dy = segment.end.y - segment.start.y;
	const lengthSquared = dx * dx + dy * dy;
	let ratio = 0;
	if (lengthSquared > 0) {
		ratio = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared;
		ratio = Math.max(0, Math.min(1, ratio));
	}
	return distance(point, {
		x: segment.start.x + dx * ratio,
		y: segment.start.y + dy * ratio
	});
}

/** Shortest distance between two segments (0 when they cross). */
export function segmentToSegmentDistance(a: Segment2, b: Segment2): number {
	if (segmentsCross(a, b)) return 0;
	return Math.min(
		pointToSegmentDistance(a.start, b),
		pointToSegmentDistance(a.end, b),
		pointToSegmentDistance(b.start, a),
		pointToSegmentDistance(b.end, a)
	);
}

function segmentsCross(a: Segment2, b: Segment2): boolean {
	const orient = (p: Vec2, q: Vec2, r: Vec2): number =>
		Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
	const o1 = orient(a.start, a.end, b.start);
	const o2 = orient(a.start, a.end, b.end);
	const o3 = orient(b.start, b.end, a.start);
	const o4 = orient(b.start, b.end, a.end);
	return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Whether two segments' directions are within ~1 degree of parallel. */
export function roughlyParallel(a: Segment2, b: Segment2): boolean {
	const dx1 = a.end.x - a.start.x;
	const dy1 = a.end.y - a.start.y;
	const dx2 = b.end.x - b.start.x;
	const dy2 = b.end.y - b.start.y;
	const cosine = Math.abs(
		(dx1 * dx2 + dy1 * dy2) / Math.sqrt((dx1 * dx1 + dy1 * dy1) * (dx2 * dx2 + dy2 * dy2))
	);
	return cosine >= 0.9998;
}
