import type { LayerId, Vec2 } from '../model/types';
import { angleDeg, degToRad, normalizeAngle } from '../geometry/primitives';

/**
 * One of a route's two parallel isolation lines. Endpoints start as plain
 * parallels and are moved by junction trimming and pad clipping.
 */
export interface OffsetLine {
	start: Vec2;
	end: Vec2;
	startIntersectsPad: boolean;
	endIntersectsPad: boolean;
	enclosedByPad: boolean;
}

/** A copper track plus its two isolation offset lines. */
export interface RouteGeom {
	start: Vec2;
	end: Vec2;
	/** Clamped copper width in mm. */
	width: number;
	/** Perpendicular distance from centerline to each offset line. */
	offsetDistance: number;
	layer: LayerId;
	/** Left of the start→end direction. */
	line1: OffsetLine;
	/** Right of the start→end direction. */
	line2: OffsetLine;
}

export function routeAngle(route: RouteGeom): number {
	return angleDeg(route.start, route.end);
}

/** The route's outgoing angle as seen from one of its endpoints. */
export function routeAngleFrom(route: RouteGeom, endpoint: 'start' | 'end'): number {
	return endpoint === 'start' ? routeAngle(route) : normalizeAngle(routeAngle(route) + 180);
}

/**
 * Build a route with its two plain parallel offset lines: line1 to the LEFT of
 * the start→end direction, line2 to the RIGHT. (The C# engine reaches the same
 * deterministic sides through its intersection-test dance.)
 */
export function createRoute(
	start: Vec2,
	end: Vec2,
	width: number,
	offsetDistance: number,
	layer: LayerId
): RouteGeom {
	const theta = degToRad(angleDeg(start, end));
	const leftNormal: Vec2 = { x: -Math.sin(theta), y: Math.cos(theta) };

	const offsetLine = (side: 1 | -1): OffsetLine => ({
		start: {
			x: start.x + side * offsetDistance * leftNormal.x,
			y: start.y + side * offsetDistance * leftNormal.y
		},
		end: {
			x: end.x + side * offsetDistance * leftNormal.x,
			y: end.y + side * offsetDistance * leftNormal.y
		},
		startIntersectsPad: false,
		endIntersectsPad: false,
		enclosedByPad: false
	});

	return {
		start,
		end,
		width,
		offsetDistance,
		layer,
		line1: offsetLine(1),
		line2: offsetLine(-1)
	};
}
