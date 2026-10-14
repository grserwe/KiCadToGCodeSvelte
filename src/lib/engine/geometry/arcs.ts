import type { Vec2 } from '../model/types';
import { angleDeg, distance, normalizeAngle } from './primitives';

export interface CenterArc {
	center: Vec2;
	radius: number;
	/** Degrees, 0° = +X, CCW-positive. */
	startAngle: number;
	/** Degrees swept from startAngle; positive = CCW. */
	sweep: number;
}

/**
 * The circular arc through three points, travelling start → mid → end.
 * Returns null when the points are (nearly) collinear.
 */
export function arcThroughPoints(start: Vec2, mid: Vec2, end: Vec2): CenterArc | null {
	const ax = start.x;
	const ay = start.y;
	const bx = mid.x;
	const by = mid.y;
	const cx = end.x;
	const cy = end.y;

	const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
	const span = Math.max(distance(start, mid), distance(mid, end), distance(start, end));
	if (Math.abs(d) < 1e-9 * Math.max(1, span * span)) return null;

	const a2 = ax * ax + ay * ay;
	const b2 = bx * bx + by * by;
	const c2 = cx * cx + cy * cy;
	const center: Vec2 = {
		x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
		y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
	};

	const startAngle = angleDeg(center, start);
	const endAngle = angleDeg(center, end);
	// Orientation of start → mid → end: positive cross product = CCW.
	const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	const sweep =
		cross > 0 ? normalizeAngle(endAngle - startAngle) : -normalizeAngle(startAngle - endAngle);

	return { center, radius: distance(center, start), startAngle, sweep };
}

/** Rotate `point` about `center` by `degrees` (standard CCW rotation in the point's frame). */
export function rotateAbout(point: Vec2, center: Vec2, degrees: number): Vec2 {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}
