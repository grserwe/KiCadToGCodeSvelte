import type { Vec2 } from '../model/types';
import {
	angleDeg,
	infiniteLineIntersection,
	positionKey,
	roughlyParallel,
	samePosition
} from './primitives';
import type { OffsetLine, RouteGeom } from '../toolpath/routes';
import { routeAngleFrom } from '../toolpath/routes';

/** A point where one or more route ends meet. */
export interface Junction {
	position: Vec2;
	routes: RouteGeom[];
}

/** Group route endpoints into junctions (positions matching to 0.1 µm). */
export function collectJunctions(routes: RouteGeom[]): Junction[] {
	const junctions = new Map<string, Junction>();

	for (const route of routes) {
		for (const position of [route.start, route.end]) {
			const key = positionKey(position);
			const existing = junctions.get(key);
			if (existing) {
				existing.routes.push(route);
			} else {
				junctions.set(key, { position, routes: [route] });
			}
		}
	}

	return [...junctions.values()];
}

/**
 * Trim the offset lines of all routes meeting at a junction: for each pair of
 * angularly adjacent routes, the two offset lines lying between them either
 * join (parallel continuation) or meet at their miter intersection point.
 * Port of the C# RouteEndpoint.CompleteIntersections.
 */
export function completeJunction(junction: Junction): void {
	if (junction.routes.length < 2) return;

	const outgoing = (route: RouteGeom): number =>
		routeAngleFrom(route, endpointAt(route, junction.position));

	const sorted = [...junction.routes].sort((a, b) => outgoing(a) - outgoing(b));

	for (let index = 0; index < sorted.length; index++) {
		const route = sorted[index];
		const adjacent = sorted[(index + 1) % sorted.length];

		const routeAngleHere = outgoing(route);
		const adjacentAngleHere = outgoing(adjacent);

		const routeLine = lineBetween(route, junction.position, routeAngleHere, adjacentAngleHere);
		const adjacentLine = lineBetween(
			adjacent,
			junction.position,
			routeAngleHere,
			adjacentAngleHere
		);

		const routeEnd = endpointAt(route, junction.position);
		const adjacentEnd = endpointAt(adjacent, junction.position);

		if (roughlyParallel(route, adjacent)) {
			// Collinear continuation: butt the two offset lines together.
			const joinPoint = adjacentEnd === 'start' ? adjacentLine.start : adjacentLine.end;
			setEndpoint(routeLine, routeEnd, { ...joinPoint });
		} else {
			const intersection = infiniteLineIntersection(routeLine, adjacentLine);
			if (intersection) {
				setEndpoint(routeLine, routeEnd, { ...intersection });
				setEndpoint(adjacentLine, adjacentEnd, { ...intersection });
			}
		}
	}
}

function endpointAt(route: RouteGeom, position: Vec2): 'start' | 'end' {
	return samePosition(route.start, position) ? 'start' : 'end';
}

function setEndpoint(line: OffsetLine, endpoint: 'start' | 'end', value: Vec2): void {
	if (endpoint === 'start') {
		line.start = value;
	} else {
		line.end = value;
	}
}

/**
 * Which of the route's two offset lines lies angularly between the route and
 * its adjacent route (the wedge swept CCW from routeAngle to adjacentAngle).
 * Tested via the far endpoint of line1, exactly like the C# original.
 */
function lineBetween(
	route: RouteGeom,
	junctionPosition: Vec2,
	routeAngleHere: number,
	adjacentAngleHere: number
): OffsetLine {
	const nearEnd = endpointAt(route, junctionPosition);
	const farPoint = nearEnd === 'start' ? route.line1.end : route.line1.start;
	const testAngle = angleDeg(junctionPosition, farPoint);

	let line1IsBetween: boolean;
	if (adjacentAngleHere < routeAngleHere) {
		// The wedge wraps through 0°.
		line1IsBetween = testAngle >= routeAngleHere || testAngle <= adjacentAngleHere;
	} else {
		line1IsBetween = routeAngleHere < testAngle && testAngle < adjacentAngleHere;
	}

	return line1IsBetween ? route.line1 : route.line2;
}
