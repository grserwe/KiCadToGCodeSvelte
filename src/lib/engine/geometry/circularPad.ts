import type { Vec2 } from '../model/types';
import { angleDeg, distance, pointOnSegment } from './primitives';
import type { OffsetLine, RouteGeom } from '../toolpath/routes';
import { makeArc, makeFullCircle, type ArcSeg } from '../toolpath/segments';

const BORDER_TOLERANCE = 0.00001;

/**
 * Geometry for a circular pad (or via) inflated by the isolation offset.
 * Implements the pad-boundary queries used by track trimming plus the
 * isolation-arc generation. Port of the C# CircularPad.
 */
export class CircularPadGeometry {
	readonly touchingRoutes: RouteGeom[] = [];

	constructor(
		readonly center: Vec2,
		/** Effective isolation radius: copper radius + tool offset. */
		readonly radius: number,
		readonly isGround: boolean
	) {}

	containsPoint(point: Vec2): boolean {
		return distance(point, this.center) < this.radius;
	}

	lineEnclosed(line: OffsetLine): boolean {
		return (
			distance(this.center, line.start) < this.radius &&
			distance(this.center, line.end) < this.radius
		);
	}

	/**
	 * Where the offset-line segment crosses the pad circle, choosing the
	 * crossing nearest the line endpoint farthest from the pad (the point
	 * where the line enters from outside).
	 */
	segmentBoundaryIntersection(line: OffsetLine): Vec2 | null {
		const dx = line.end.x - line.start.x;
		const dy = line.end.y - line.start.y;
		const fx = line.start.x - this.center.x;
		const fy = line.start.y - this.center.y;

		const a = dx * dx + dy * dy;
		const b = 2 * (fx * dx + fy * dy);
		const c = fx * fx + fy * fy - this.radius * this.radius;
		const det = b * b - 4 * a * c;

		if (a <= 1e-7 || det < 0) return null;

		const sqrtDet = Math.sqrt(det);
		const candidates: Vec2[] = [];
		for (const t of [(-b + sqrtDet) / (2 * a), (-b - sqrtDet) / (2 * a)]) {
			const point = { x: line.start.x + t * dx, y: line.start.y + t * dy };
			if (pointOnSegment(line, point)) {
				candidates.push(point);
			}
		}
		if (candidates.length === 0) return null;

		const farEndpoint =
			distance(line.start, this.center) > distance(line.end, this.center) ? line.start : line.end;
		candidates.sort((p, q) => distance(farEndpoint, p) - distance(farEndpoint, q));
		return candidates[0];
	}

	/**
	 * The isolation arcs: a full circle when untouched, otherwise arcs covering
	 * the boundary with gaps where each touching route's offset lines meet the
	 * circle. Ground pads instead get four 45° thermal-relief arcs.
	 */
	isolationArcs(): ArcSeg[] {
		if (this.isGround) {
			const arcs: ArcSeg[] = [];
			for (let startAngle = 337.5; startAngle > 0; startAngle -= 90) {
				arcs.push(makeArc(this.center, this.radius, startAngle, startAngle - 45));
			}
			return arcs;
		}

		interface BoundaryHit {
			isStart: boolean;
			angle: number;
		}
		const hits: BoundaryHit[] = [];

		for (const route of this.touchingRoutes) {
			const contact1 = this.boundaryContact(route.line1);
			const contact2 = this.boundaryContact(route.line2);

			if (contact1 && contact2) {
				let angle1 = angleDeg(this.center, contact1);
				let angle2 = angleDeg(this.center, contact2);

				if (angle1 > angle2) {
					[angle1, angle2] = [angle2, angle1];
				}
				// Keep the pair ordered so the route's gap is the SHORT way
				// around; when the gap straddles 0° the roles swap.
				if (Math.abs(360 - angle2 + angle1) < angle2 - angle1) {
					[angle1, angle2] = [angle2, angle1];
				}

				hits.push({ isStart: true, angle: angle1 });
				hits.push({ isStart: false, angle: angle2 });
			} else if (contact1) {
				hits.push({ isStart: false, angle: angleDeg(this.center, contact1) });
			} else if (contact2) {
				hits.push({ isStart: false, angle: angleDeg(this.center, contact2) });
			}
		}

		if (hits.length === 0) {
			return [makeFullCircle(this.center, this.radius)];
		}
		if (hits.length % 2 !== 0) {
			hits.pop();
			if (hits.length === 0) {
				return [makeFullCircle(this.center, this.radius)];
			}
		}

		const ordered = [...hits].sort((a, b) => b.angle - a.angle);

		// Rotate the list when it starts mid-gap so pairs line up as
		// (keep-arc start, keep-arc end).
		if (
			(!ordered[0].isStart && ordered[1].isStart) ||
			(!ordered[0].isStart &&
				!ordered[1].isStart &&
				Math.abs(ordered[0].angle - ordered[1].angle) < 180)
		) {
			ordered.push(ordered.shift()!);
		}

		const arcs: ArcSeg[] = [];
		for (let index = 0; index < ordered.length; index += 2) {
			const from = ordered[index];
			const to = ordered[index + 1] ?? ordered[0];
			arcs.push(makeArc(this.center, this.radius, from.angle % 360, to.angle % 360));
		}
		return arcs;
	}

	/** A trimmed offset-line endpoint resting on this pad's boundary. */
	private boundaryContact(line: OffsetLine): Vec2 | null {
		if (line.startIntersectsPad && this.onBorder(line.start)) return line.start;
		if (line.endIntersectsPad && this.onBorder(line.end)) return line.end;
		return null;
	}

	private onBorder(point: Vec2): boolean {
		return Math.abs(distance(point, this.center) - this.radius) <= BORDER_TOLERANCE;
	}
}
