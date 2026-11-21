import type { Vec2 } from '../model/types';
import {
	angleDeg,
	degToRad,
	distance,
	pointOnSegment,
	pointToSegmentDistance,
	positiveModulo
} from './primitives';
import type { OffsetLine, RouteGeom } from '../toolpath/routes';
import { makeArc, makeFullCircle, type ArcSeg } from '../toolpath/segments';

const BORDER_TOLERANCE = 0.00001;
/** Half the angle of each thermal spoke (four 45° spokes, four 45° cut arcs). */
const THERMAL_SPOKE_HALF_ANGLE = 22.5;
/** Uncut stretches shorter than this (degrees) are not worth an arc. */
const ANGLE_TOLERANCE = 0.01;

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
		/** Thermal relief: four spokes left uncut, joining the pad to the copper around it. */
		readonly thermalRelief: boolean
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
	 * circle. Thermal-relief pads instead get four 45° arcs between spokes at
	 * 0°/90°/180°/270°, with further gaps where routes enter.
	 */
	isolationArcs(): ArcSeg[] {
		if (this.thermalRelief) {
			return this.thermalArcs();
		}

		// Every place a route's isolation line meets the circle splits it.
		const angles: number[] = [];
		for (const route of this.touchingRoutes) {
			for (const line of [route.line1, route.line2]) {
				const contact = this.boundaryContact(line);
				if (contact) angles.push(angleDeg(this.center, contact));
			}
		}
		angles.sort((a, b) => a - b);
		const splits = angles.filter(
			(angle, index) => index === 0 || angle - angles[index - 1] > ANGLE_TOLERANCE
		);
		if (splits.length > 1 && splits[0] + 360 - splits[splits.length - 1] <= ANGLE_TOLERANCE) {
			splits.pop();
		}
		if (splits.length < 2) {
			return [makeFullCircle(this.center, this.radius)];
		}

		// Keep each stretch between splits that no touching route covers.
		// Deciding by what covers the stretch (rather than pairing contacts
		// up) stays right when a route meets the circle with only one of its
		// lines — e.g. a wide track turning a corner on the pad, whose inner
		// lines meet each other outside the circle.
		const keeps: { start: number; end: number }[] = [];
		for (let index = 0; index < splits.length; index++) {
			const start = splits[index];
			const end = index + 1 < splits.length ? splits[index + 1] : splits[0] + 360;
			if (this.coveredByRoute((start + end) / 2)) continue;
			const previous = keeps[keeps.length - 1];
			if (previous && previous.end === start) previous.end = end;
			else keeps.push({ start, end });
		}
		// A keep running through the first split comes out in two pieces.
		if (keeps.length > 1 && keeps[keeps.length - 1].end === keeps[0].start + 360) {
			keeps[0].start = keeps.pop()!.start - 360;
		}
		if (keeps.length === 1 && keeps[0].end - keeps[0].start >= 360) {
			return [makeFullCircle(this.center, this.radius)];
		}

		// Arcs run clockwise, from the high angle down to the low one, and
		// are emitted in order of decreasing start angle.
		return keeps
			.map((keep) =>
				makeArc(
					this.center,
					this.radius,
					positiveModulo(keep.end, 360),
					positiveModulo(keep.start, 360)
				)
			)
			.sort((a, b) => b.startAngle - a.startAngle);
	}

	/** Whether the circle point at `angle` lies inside a touching route's isolated copper. */
	private coveredByRoute(angle: number): boolean {
		const point = {
			x: this.center.x + this.radius * Math.cos(degToRad(angle)),
			y: this.center.y + this.radius * Math.sin(degToRad(angle))
		};
		return this.touchingRoutes.some(
			(route) =>
				pointToSegmentDistance(point, { start: route.start, end: route.end }) <
				route.offsetDistance - BORDER_TOLERANCE
		);
	}

	private thermalArcs(): ArcSeg[] {
		/** Counterclockwise angular stretches (degrees) left uncut. */
		const gaps: { start: number; end: number }[] = [0, 90, 180, 270].map((spoke) => ({
			start: spoke - THERMAL_SPOKE_HALF_ANGLE,
			end: spoke + THERMAL_SPOKE_HALF_ANGLE
		}));

		for (const route of this.touchingRoutes) {
			const contacts = [this.boundaryContact(route.line1), this.boundaryContact(route.line2)]
				.filter((contact): contact is Vec2 => contact !== null)
				.map((contact) => angleDeg(this.center, contact));
			if (contacts.length === 2) {
				// The route covers the short way round between its two contacts.
				const forward = positiveModulo(contacts[1] - contacts[0], 360);
				gaps.push(
					forward <= 180
						? { start: contacts[0], end: contacts[0] + forward }
						: { start: contacts[1], end: contacts[1] + 360 - forward }
				);
			} else if (contacts.length === 1) {
				const halfAngle = (Math.asin(Math.min(1, route.width / 2 / this.radius)) * 180) / Math.PI;
				gaps.push({ start: contacts[0] - halfAngle, end: contacts[0] + halfAngle });
			}
		}

		// Unwrap into [0, 360), merge, and keep the complement.
		const pieces: { start: number; end: number }[] = [];
		for (const gap of gaps) {
			const start = positiveModulo(gap.start, 360);
			const end = start + Math.min(gap.end - gap.start, 360);
			if (end <= 360) {
				pieces.push({ start, end });
			} else {
				pieces.push({ start, end: 360 }, { start: 0, end: end - 360 });
			}
		}
		pieces.sort((a, b) => a.start - b.start);

		const keeps: { start: number; end: number }[] = [];
		let position = 0;
		for (const piece of pieces) {
			if (piece.start - position > ANGLE_TOLERANCE)
				keeps.push({ start: position, end: piece.start });
			position = Math.max(position, piece.end);
		}
		if (360 - position > ANGLE_TOLERANCE) keeps.push({ start: position, end: 360 });
		// A keep running through 0° comes out in two pieces; rejoin them.
		if (keeps.length > 1 && keeps[0].start === 0 && keeps[keeps.length - 1].end === 360) {
			const first = keeps.shift()!;
			keeps[keeps.length - 1].end = 360 + first.end;
		}

		// Arcs run clockwise, from the high angle down to the low one.
		return keeps
			.reverse()
			.map((keep) => makeArc(this.center, this.radius, keep.end % 360, keep.start));
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
