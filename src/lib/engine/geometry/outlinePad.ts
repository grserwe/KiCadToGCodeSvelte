import type { Vec2 } from '../model/types';
import { distance, positiveModulo, pointOnSegment, pointWithinSegmentBounds } from './primitives';
import type { OutlineEdge } from './outline';
import type { OffsetLine, RouteGeom } from '../toolpath/routes';
import type { PathSegment } from '../toolpath/segments';

const MINIMUM_SEGMENT_LENGTH = 0.0001;
const BORDER_TOLERANCE = 0.001;

interface Interval {
	start: number;
	end: number;
}

/**
 * Geometry for an outline pad (rect/oval/roundrect/trapezoid/polygon),
 * operating on the pad's world-space isolation outline. The isolation path is
 * the outline itself with gaps left where routes enter. Port of the C#
 * OutlinePad.
 */
export class OutlinePadGeometry {
	readonly touchingRoutes: RouteGeom[] = [];
	private readonly containmentPolygon: Vec2[] = [];
	readonly perimeter: number;

	constructor(
		readonly center: Vec2,
		readonly edges: OutlineEdge[],
		readonly isGround: boolean
	) {
		for (const edge of edges) {
			edge.tessellate(this.containmentPolygon);
		}
		this.perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
	}

	containsPoint(point: Vec2): boolean {
		let inside = false;
		const polygon = this.containmentPolygon;
		for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
			const current = polygon[index];
			const before = polygon[previous];
			if (
				current.y > point.y !== before.y > point.y &&
				point.x <
					((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x
			) {
				inside = !inside;
			}
		}
		return inside;
	}

	lineEnclosed(line: OffsetLine): boolean {
		return this.containsPoint(line.start) && this.containsPoint(line.end);
	}

	/** Boundary crossing of the segment, nearest its far-from-pad endpoint. */
	segmentBoundaryIntersection(line: OffsetLine): Vec2 | null {
		const intersections: Vec2[] = [];
		for (const edge of this.edges) {
			for (const intersection of edge.infiniteLineIntersections(line)) {
				if (pointOnSegment(line, intersection)) {
					intersections.push(intersection);
				}
			}
		}
		if (intersections.length === 0) return null;

		const farEndpoint =
			distance(line.start, this.center) > distance(line.end, this.center) ? line.start : line.end;
		intersections.sort((p, q) => distance(farEndpoint, p) - distance(farEndpoint, q));
		return intersections[0];
	}

	/** The outline split into cut segments, with gaps where routes enter. */
	isolationSegments(): PathSegment[] {
		const segments: PathSegment[] = [];
		if (this.perimeter <= MINIMUM_SEGMENT_LENGTH) return segments;

		const gaps: Interval[] = [];
		if (this.isGround) {
			// Four evenly spaced gaps keep ground pads connected to the
			// surrounding copper (thermal-relief style).
			const eighth = this.perimeter / 8;
			for (let gapIndex = 0; gapIndex < 4; gapIndex++) {
				const gapStart = gapIndex * 2 * eighth + eighth;
				gaps.push({ start: gapStart, end: gapStart + eighth });
			}
		} else {
			for (const route of this.touchingRoutes) {
				const gap = this.computeRouteGap(route);
				if (gap) gaps.push(gap);
			}
		}

		for (const keep of this.computeKeepIntervals(gaps)) {
			this.appendSegmentsForInterval(segments, keep.start, keep.end);
		}
		return segments;
	}

	/**
	 * The stretch of the outline covered by a route entering the pad, as a
	 * perimeter interval (end may exceed the perimeter to indicate wrapping).
	 */
	private computeRouteGap(route: RouteGeom): Interval | null {
		const contacts: number[] = [];
		this.addBoundaryContact(contacts, route.line1);
		this.addBoundaryContact(contacts, route.line2);

		const centerlineCrossing = this.perimeterDistanceOfRouteCrossing(route);

		if (contacts.length >= 2) {
			const first = contacts[0];
			const second = contacts[1];
			const forwardSpan = positiveModulo(second - first, this.perimeter);
			let gapIsForward: boolean;

			if (centerlineCrossing !== null) {
				// The gap is whichever side of the outline the centerline crosses.
				gapIsForward = positiveModulo(centerlineCrossing - first, this.perimeter) <= forwardSpan;
			} else {
				gapIsForward = forwardSpan <= this.perimeter - forwardSpan;
			}

			return gapIsForward
				? { start: first, end: first + forwardSpan }
				: { start: second, end: second + (this.perimeter - forwardSpan) };
		}
		if (contacts.length === 1) {
			return this.centeredGap(contacts[0], route.width);
		}
		if (centerlineCrossing !== null) {
			return this.centeredGap(centerlineCrossing, route.width);
		}
		return null;
	}

	private centeredGap(centerDistance: number, gapWidth: number): Interval {
		const start = positiveModulo(centerDistance - gapWidth / 2, this.perimeter);
		return { start, end: start + Math.min(gapWidth, this.perimeter) };
	}

	private addBoundaryContact(contacts: number[], line: OffsetLine): void {
		let contact: Vec2 | null = null;
		if (line.startIntersectsPad && this.onBorder(line.start)) {
			contact = line.start;
		} else if (line.endIntersectsPad && this.onBorder(line.end)) {
			contact = line.end;
		}
		if (contact) {
			contacts.push(this.perimeterDistance(contact));
		}
	}

	private onBorder(point: Vec2): boolean {
		let closest = Infinity;
		for (const edge of this.edges) {
			closest = Math.min(closest, edge.distanceToPoint(point).distance);
		}
		return closest <= BORDER_TOLERANCE;
	}

	/** Map a point on (or near) the outline to its distance along the perimeter. */
	private perimeterDistance(point: Vec2): number {
		let closest = Infinity;
		let result = 0;
		let cumulative = 0;
		for (const edge of this.edges) {
			const { distance: edgeDistance, along } = edge.distanceToPoint(point);
			if (edgeDistance < closest) {
				closest = edgeDistance;
				result = cumulative + along;
			}
			cumulative += edge.length;
		}
		return result;
	}

	/** Where the route's centerline segment crosses the outline, if anywhere. */
	private perimeterDistanceOfRouteCrossing(route: RouteGeom): number | null {
		for (const edge of this.edges) {
			for (const intersection of edge.infiniteLineIntersections(route)) {
				if (pointWithinSegmentBounds(intersection, route)) {
					return this.perimeterDistance(intersection);
				}
			}
		}
		return null;
	}

	/** Merge gaps and return the complementary perimeter stretches to engrave. */
	private computeKeepIntervals(gaps: Interval[]): Interval[] {
		if (gaps.length === 0) {
			return [{ start: 0, end: this.perimeter }];
		}

		const normalized: Interval[] = [];
		for (const gap of gaps) {
			const start = positiveModulo(gap.start, this.perimeter);
			const length = Math.min(gap.end - gap.start, this.perimeter);
			if (start + length <= this.perimeter) {
				normalized.push({ start, end: start + length });
			} else {
				normalized.push({ start, end: this.perimeter });
				normalized.push({ start: 0, end: start + length - this.perimeter });
			}
		}
		normalized.sort((a, b) => a.start - b.start);

		const merged: Interval[] = [];
		for (const gap of normalized) {
			const last = merged[merged.length - 1];
			if (last && gap.start <= last.end) {
				last.end = Math.max(last.end, gap.end);
			} else {
				merged.push({ ...gap });
			}
		}

		const keep: Interval[] = [];
		let position = 0;
		for (const gap of merged) {
			if (gap.start - position > MINIMUM_SEGMENT_LENGTH) {
				keep.push({ start: position, end: gap.start });
			}
			position = Math.max(position, gap.end);
		}
		if (this.perimeter - position > MINIMUM_SEGMENT_LENGTH) {
			keep.push({ start: position, end: this.perimeter });
		}
		return keep;
	}

	/** Emit segments covering the interval, splitting outline edges as needed. */
	private appendSegmentsForInterval(segments: PathSegment[], start: number, end: number): void {
		let cumulative = 0;
		for (const edge of this.edges) {
			const edgeStart = cumulative;
			const edgeEnd = cumulative + edge.length;
			const subStart = Math.max(start, edgeStart);
			const subEnd = Math.min(end, edgeEnd);
			if (subEnd - subStart > MINIMUM_SEGMENT_LENGTH) {
				segments.push(edge.createSegment(subStart - edgeStart, subEnd - edgeStart));
			}
			cumulative = edgeEnd;
		}
	}
}
