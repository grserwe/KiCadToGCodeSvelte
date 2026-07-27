import type { Vec2 } from '../model/types';
import { degToRad, normalizeAngle } from '../geometry/primitives';

/** A straight cut. */
export interface LineSeg {
	kind: 'line';
	start: Vec2;
	end: Vec2;
}

/**
 * A circular cut. Arcs always travel CLOCKWISE from startAngle to endAngle
 * (decreasing angle, wrapping through 0), matching the C# Arc convention.
 * Angles: 0° = +X, counterclockwise-positive. startAngle === endAngle − 360
 * (e.g. 0 and 360) denotes a full circle.
 */
export interface ArcSeg {
	kind: 'arc';
	center: Vec2;
	radius: number;
	startAngle: number;
	endAngle: number;
}

export type PathSegment = LineSeg | ArcSeg;

export function arcPoint(arc: ArcSeg, angleDegrees: number): Vec2 {
	const radians = degToRad(angleDegrees);
	return {
		x: arc.center.x + arc.radius * Math.cos(radians),
		y: arc.center.y + arc.radius * Math.sin(radians)
	};
}

/** Degrees swept clockwise from startAngle to endAngle (360 for a full circle). */
export function arcSweep(arc: ArcSeg): number {
	if (arc.startAngle < arc.endAngle && Math.abs(arc.endAngle - arc.startAngle) !== 360) {
		return arc.startAngle + (360 - arc.endAngle);
	}
	return Math.abs(arc.endAngle - arc.startAngle);
}

export function segmentStart(segment: PathSegment): Vec2 {
	return segment.kind === 'line' ? segment.start : arcPoint(segment, segment.startAngle);
}

export function segmentEnd(segment: PathSegment): Vec2 {
	return segment.kind === 'line' ? segment.end : arcPoint(segment, segment.endAngle);
}

export function makeArc(
	center: Vec2,
	radius: number,
	startAngle: number,
	endAngle: number
): ArcSeg {
	const start = startAngle === 360 ? 360 : normalizeAngle(startAngle);
	const end = endAngle === 360 ? 360 : normalizeAngle(endAngle);
	return { kind: 'arc', center, radius, startAngle: start, endAngle: end };
}

export function makeFullCircle(center: Vec2, radius: number): ArcSeg {
	return { kind: 'arc', center, radius, startAngle: 0, endAngle: 360 };
}
