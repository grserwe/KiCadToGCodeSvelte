import type { BoardModel, EngineWarning, LayerId, Pad, Track, Vec2 } from '../model/types';
import { distance } from '../geometry/primitives';
import { collectJunctions, completeJunction } from '../geometry/junctions';
import { CircularPadGeometry } from '../geometry/circularPad';
import { OutlinePadGeometry } from '../geometry/outlinePad';
import { buildPadOutline } from '../geometry/outline';
import { createRoute, type OffsetLine, type RouteGeom } from './routes';
import type { PathSegment } from './segments';

const MINIMUM_SEGMENT_LENGTH = 0.0001;

export interface ToolpathOptions {
	/**
	 * Distance the cut is offset outward from the copper boundary — the tool
	 * radius (plus stepover on later passes). 0 cuts along the copper edge,
	 * matching the old C# engine.
	 */
	isolationOffset: number;
	/** Tracks narrower than this are widened to it before offsetting (mm). */
	minimumTrackWidth: number;
	/** Pads/vias smaller than this are grown to it (mm). */
	minimumPadDiameter: number;
}

export interface LayerToolpath {
	segments: PathSegment[];
	warnings: EngineWarning[];
}

type PadGeometry = CircularPadGeometry | OutlinePadGeometry;

/**
 * Build the isolation toolpath for one copper layer: parallel offset lines
 * along each track (trimmed at junctions and pad boundaries) plus pad
 * isolation outlines with gaps where tracks enter.
 */
export function buildLayerToolpath(
	board: BoardModel,
	layer: LayerId,
	options: ToolpathOptions
): LayerToolpath {
	const warnings: EngineWarning[] = [];

	// 1. Pads on this layer, inflated by the isolation offset.
	const pads = board.pads
		.filter((pad) => pad.plated && (pad.layers === layer || pad.layers === 'through'))
		.map((pad) => createPadGeometry(pad, options, warnings))
		.filter((geometry): geometry is PadGeometry => geometry !== null);

	// 2. Tracks become routes with two plain parallel offset lines. Tracks are
	//    first split wherever another track or a pad joins them mid-length
	//    (T-junctions, component leads sitting on a track), so that every
	//    meeting point is a junction of endpoints and the trimming below never
	//    cuts straight through copper.
	const trackWidth = (track: Track) => Math.max(track.width, options.minimumTrackWidth);
	const routes: RouteGeom[] = splitTracksAtMidpointJoins(
		board.tracks.filter((track) => track.layer === layer),
		pads,
		(track) => trackWidth(track) / 2 + options.isolationOffset
	).map((track) =>
		createRoute(
			track.start,
			track.end,
			trackWidth(track),
			trackWidth(track) / 2 + options.isolationOffset,
			layer
		)
	);

	// 3. Junction trimming: miter or join offset lines where tracks meet.
	for (const junction of collectJunctions(routes)) {
		completeJunction(junction);
	}

	// 4. Pads clip the offset lines and record which routes touch them
	//    (which is where their isolation gaps go).
	for (const pad of pads) {
		for (const route of routes) {
			trimRouteAgainstPad(pad, route);
		}
	}

	// 5. Collect all cut segments.
	const segments: PathSegment[] = [];
	for (const route of routes) {
		for (const line of [route.line1, route.line2]) {
			if (!line.enclosedByPad && distance(line.start, line.end) > MINIMUM_SEGMENT_LENGTH) {
				segments.push({ kind: 'line', start: line.start, end: line.end });
			}
		}
	}
	for (const pad of pads) {
		segments.push(
			...(pad instanceof CircularPadGeometry ? pad.isolationArcs() : pad.isolationSegments())
		);
	}

	return { segments, warnings };
}

function createPadGeometry(
	pad: Pad,
	options: ToolpathOptions,
	warnings: EngineWarning[]
): PadGeometry | null {
	if (pad.shape.kind === 'circle') {
		const diameter = Math.max(pad.shape.diameter, options.minimumPadDiameter);
		return new CircularPadGeometry(
			pad.position,
			diameter / 2 + options.isolationOffset,
			pad.isGround
		);
	}

	if (pad.shape.kind === 'polygon') {
		if (!isConvex(pad.shape.points)) {
			warnings.push({
				code: 'custom-pad-primitives',
				message: `A custom polygon pad at (${pad.position.x.toFixed(2)}, ${pad.position.y.toFixed(2)}) is not convex; its tool-offset outline is approximate.`
			});
		}
		const edges = buildPadOutline(
			pad.shape,
			pad.rotationDeg,
			pad.position,
			options.isolationOffset
		);
		return new OutlinePadGeometry(pad.position, edges, pad.isGround);
	}

	// Grow undersized pads, preserving the already-large dimension (the C#
	// EnsureMinimumSize behavior).
	let shape = pad.shape;
	if (shape.sizeX < options.minimumPadDiameter || shape.sizeY < options.minimumPadDiameter) {
		shape = {
			...shape,
			sizeX: Math.max(shape.sizeX, options.minimumPadDiameter),
			sizeY: Math.max(shape.sizeY, options.minimumPadDiameter)
		};
	}

	const edges = buildPadOutline(shape, pad.rotationDeg, pad.position, options.isolationOffset);
	if (edges.length === 0) return null;
	return new OutlinePadGeometry(pad.position, edges, pad.isGround);
}

/** A track endpoint resting on another track's centerline is a T-junction. */
const TEE_JUNCTION_TOLERANCE = 0.001;

/**
 * Split tracks wherever something else joins them mid-length, so every meeting
 * point is a junction of track ENDPOINTS (the only kind the junction trimming
 * understands):
 *
 * - **T-junctions** — another track's endpoint lies on this track's
 *   centerline, strictly between its ends. Without a split the trunk's offset
 *   line would run straight through the stub's copper.
 * - **Pads sitting along the track** (a component lead mid-track) — the point
 *   of the track nearest the pad center is strictly between the ends and
 *   either it or its counterpart on an offset line falls inside the pad's
 *   isolation outline, while neither track endpoint does (that case is the
 *   ordinary "track ends in a pad" clip). Cut at the nearest point so both
 *   pieces end inside the pad.
 */
function splitTracksAtMidpointJoins(
	tracks: Track[],
	pads: PadGeometry[],
	offsetDistanceOf: (track: Track) => number
): Track[] {
	const result: Track[] = [];

	for (const track of tracks) {
		const length = distance(track.start, track.end);
		if (length <= MINIMUM_SEGMENT_LENGTH) {
			result.push(track);
			continue;
		}
		const direction = {
			x: (track.end.x - track.start.x) / length,
			y: (track.end.y - track.start.y) / length
		};
		const leftNormal = { x: -direction.y, y: direction.x };
		const offsetDistance = offsetDistanceOf(track);
		const alongOf = (point: Vec2): number =>
			(point.x - track.start.x) * direction.x + (point.y - track.start.y) * direction.y;
		const isInterior = (along: number): boolean =>
			along > MINIMUM_SEGMENT_LENGTH && along < length - MINIMUM_SEGMENT_LENGTH;
		const pointAlong = (along: number): Vec2 => ({
			x: track.start.x + direction.x * along,
			y: track.start.y + direction.y * along
		});

		const cuts: { along: number; point: Vec2 }[] = [];

		for (const other of tracks) {
			if (other === track) continue;
			for (const endpoint of [other.start, other.end]) {
				const along = alongOf(endpoint);
				if (!isInterior(along)) continue;
				if (distance(endpoint, pointAlong(along)) > TEE_JUNCTION_TOLERANCE) continue;
				// Cut at the stub's own endpoint so the junction keys match exactly.
				cuts.push({ along, point: endpoint });
			}
		}

		for (const pad of pads) {
			if (pad.containsPoint(track.start) || pad.containsPoint(track.end)) continue;
			const along = alongOf(pad.center);
			if (!isInterior(along)) continue;
			const foot = pointAlong(along);
			const touches = [0, offsetDistance, -offsetDistance].some((side) =>
				pad.containsPoint({ x: foot.x + leftNormal.x * side, y: foot.y + leftNormal.y * side })
			);
			if (touches) cuts.push({ along, point: foot });
		}

		cuts.sort((a, b) => a.along - b.along);
		let previousAlong = 0;
		let previousPoint = track.start;
		for (const cut of cuts) {
			if (cut.along - previousAlong <= MINIMUM_SEGMENT_LENGTH) continue;
			result.push({ ...track, start: previousPoint, end: cut.point });
			previousAlong = cut.along;
			previousPoint = cut.point;
		}
		result.push({ ...track, start: previousPoint, end: track.end });
	}

	return result;
}

/**
 * Clip a route's offset lines against a pad: lines fully inside the pad are
 * dropped, lines crossing the boundary are cut at the crossing and flagged
 * (the flags anchor the pad's isolation gaps). Port of the C#
 * BoardLayer.PerformPadAndLineChecks.
 */
function trimRouteAgainstPad(pad: PadGeometry, route: RouteGeom): void {
	let touches = false;

	for (const line of [route.line1, route.line2]) {
		if (pad.lineEnclosed(line)) {
			line.enclosedByPad = true;
			continue;
		}

		const intersection = pad.segmentBoundaryIntersection(line);
		if (!intersection) continue;
		touches = true;

		if (pad.containsPoint(line.start)) {
			line.start = intersection;
			line.startIntersectsPad = true;
		} else if (pad.containsPoint(line.end)) {
			line.end = intersection;
			line.endIntersectsPad = true;
		} else if (closerToPad(pad.center, line, 'start')) {
			line.start = intersection;
			line.startIntersectsPad = true;
		} else {
			line.end = intersection;
			line.endIntersectsPad = true;
		}
	}

	if (touches) {
		pad.touchingRoutes.push(route);
	}
}

function closerToPad(center: Vec2, line: OffsetLine, endpoint: 'start'): boolean {
	void endpoint;
	return distance(center, line.start) < distance(center, line.end);
}

function isConvex(points: Vec2[]): boolean {
	if (points.length < 4) return true;
	let sign = 0;
	for (let index = 0; index < points.length; index++) {
		const a = points[index];
		const b = points[(index + 1) % points.length];
		const c = points[(index + 2) % points.length];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (Math.abs(cross) < 1e-9) continue;
		const currentSign = Math.sign(cross);
		if (sign === 0) {
			sign = currentSign;
		} else if (currentSign !== sign) {
			return false;
		}
	}
	return true;
}
