import type { BoardModel, EngineWarning, Pad, Track, Vec2 } from '../model/types';
import { buildPadOutline } from '../geometry/outline';
import {
	distance,
	pointToSegmentDistance,
	segmentToSegmentDistance,
	type Segment2
} from '../geometry/primitives';

export interface WideningOptions {
	/** Tracks narrower than this are widened toward it (mm). */
	minimumTrackWidthMm: number;
	/** Pads/vias smaller than this are grown toward it (mm). */
	minimumPadDiameterMm: number;
	/**
	 * Copper on different nets must keep at least this gap (mm) — normally the
	 * tool's effective cutting width, so an isolation channel still fits.
	 */
	clearanceMm: number;
}

export interface WideningResult {
	board: BoardModel;
	warnings: EngineWarning[];
}

/**
 * Widen thin tracks and small pads toward the configured minimums WITHOUT
 * shorting the board: for every pair of features on different nets that share
 * a copper layer, growth is capped so their copper edges stay at least
 * `clearanceMm` apart. Same-net features may touch freely (they're already
 * connected). Features whose DESIGNED spacing is under the clearance are left
 * at their designed size and reported.
 */
export function applyMinimumWidths(board: BoardModel, options: WideningOptions): WideningResult {
	const warnings: EngineWarning[] = [];
	const features = collectFeatures(board, options);

	// Allowed growth fraction per feature, whittled down by each conflicting
	// pair. 1 = full growth to the minimum, 0 = keep the designed size.
	const fractions = features.map(() => 1);
	const clearanceIssues: Vec2[] = [];
	let cappedCount = 0;

	for (let a = 0; a < features.length; a++) {
		for (let b = a + 1; b < features.length; b++) {
			const featureA = features[a];
			const featureB = features[b];
			if (sameNet(featureA.net, featureB.net)) continue;
			if (!sharesLayer(featureA, featureB)) continue;

			const growthBudget = featureA.desiredGrowth + featureB.desiredGrowth;
			const reach = growthBudget + options.clearanceMm;
			if (!boxesWithinReach(featureA, featureB, reach)) continue;

			const gap = boundaryGap(featureA, featureB);
			if (gap >= reach) continue;

			const available = gap - options.clearanceMm;
			if (available <= 0) {
				// Already too close as designed: no growth for either feature.
				fractions[a] = 0;
				fractions[b] = 0;
				clearanceIssues.push(midpoint(featureA.center, featureB.center));
				continue;
			}
			if (growthBudget <= 0) continue;

			// Split the available room proportionally to each side's desired
			// growth; taking the minimum across pairs keeps every pair safe.
			const scale = available / growthBudget;
			if (featureA.desiredGrowth > 0) {
				fractions[a] = Math.min(fractions[a], scale);
			}
			if (featureB.desiredGrowth > 0) {
				fractions[b] = Math.min(fractions[b], scale);
			}
		}
	}

	const tracks: Track[] = [...board.tracks];
	const pads: Pad[] = [...board.pads];

	for (let index = 0; index < features.length; index++) {
		const feature = features[index];
		if (feature.desiredGrowth <= 0) continue;
		const fraction = fractions[index];
		if (fraction < 1) cappedCount++;
		if (feature.kind === 'track') {
			tracks[feature.index] = {
				...tracks[feature.index],
				width: tracks[feature.index].width + 2 * feature.desiredGrowth * fraction
			};
		} else {
			pads[feature.index] = growPad(pads[feature.index], fraction, options.minimumPadDiameterMm);
		}
	}

	if (cappedCount > 0) {
		warnings.push({
			code: 'width-capped',
			message: `${cappedCount} trace${cappedCount === 1 ? '' : 's'}/pad${cappedCount === 1 ? '' : 's'} could not be widened to the full minimum — copper on another net is too close. They were widened as far as the ${options.clearanceMm.toFixed(2)} mm clearance allows.`
		});
	}
	if (clearanceIssues.length > 0) {
		const first = clearanceIssues[0];
		warnings.push({
			code: 'clearance',
			message: `Copper on different nets is closer than the tool's cutting width (${options.clearanceMm.toFixed(2)} mm) in ${clearanceIssues.length} place${clearanceIssues.length === 1 ? '' : 's'} (first near ${first.x.toFixed(1)}, ${first.y.toFixed(1)} mm). The isolation cut may nick both sides there.`
		});
	}

	return { board: { ...board, tracks, pads }, warnings };
}

interface Feature {
	kind: 'track' | 'pad';
	/** Index into board.tracks or board.pads. */
	index: number;
	net: number;
	layers: 'top' | 'bottom' | 'through';
	center: Vec2;
	/** How far the copper edge wants to move outward (mm). */
	desiredGrowth: number;
	/** Designed boundary, as segments (tracks carry their half-width separately). */
	boundary: Boundary;
	/** Bounding box of the designed copper. */
	box: { minX: number; minY: number; maxX: number; maxY: number };
}

type Boundary =
	| { kind: 'stroke'; segment: Segment2; halfWidth: number }
	| { kind: 'circle'; center: Vec2; radius: number }
	| { kind: 'loop'; segments: Segment2[] };

function collectFeatures(board: BoardModel, options: WideningOptions): Feature[] {
	const features: Feature[] = [];

	board.tracks.forEach((track, index) => {
		const desired = Math.max(0, (options.minimumTrackWidthMm - track.width) / 2);
		const half = track.width / 2;
		features.push({
			kind: 'track',
			index,
			net: track.net,
			layers: track.layer,
			center: midpoint(track.start, track.end),
			desiredGrowth: desired,
			boundary: {
				kind: 'stroke',
				segment: { start: track.start, end: track.end },
				halfWidth: half
			},
			box: {
				minX: Math.min(track.start.x, track.end.x) - half,
				minY: Math.min(track.start.y, track.end.y) - half,
				maxX: Math.max(track.start.x, track.end.x) + half,
				maxY: Math.max(track.start.y, track.end.y) + half
			}
		});
	});

	board.pads.forEach((pad, index) => {
		if (!pad.plated) return;
		const feature = padFeature(pad, index, options);
		if (feature) features.push(feature);
	});

	return features;
}

function padFeature(pad: Pad, index: number, options: WideningOptions): Feature | null {
	if (pad.shape.kind === 'circle') {
		const radius = pad.shape.diameter / 2;
		const desired = Math.max(0, (options.minimumPadDiameterMm - pad.shape.diameter) / 2);
		return {
			kind: 'pad',
			index,
			net: pad.net,
			layers: pad.layers,
			center: pad.position,
			desiredGrowth: desired,
			boundary: { kind: 'circle', center: pad.position, radius },
			box: {
				minX: pad.position.x - radius,
				minY: pad.position.y - radius,
				maxX: pad.position.x + radius,
				maxY: pad.position.y + radius
			}
		};
	}

	// Polygon (custom) pads keep their drawn geometry — no growth — but still
	// constrain their neighbors' growth.
	const desired =
		pad.shape.kind === 'polygon'
			? 0
			: Math.max(
					0,
					Math.max(
						options.minimumPadDiameterMm - pad.shape.sizeX,
						options.minimumPadDiameterMm - pad.shape.sizeY
					) / 2
				);

	const edges = buildPadOutline(pad.shape, pad.rotationDeg, pad.position, 0);
	if (edges.length === 0) return null;
	const points: Vec2[] = [];
	for (const edge of edges) {
		edge.tessellate(points);
	}
	const segments: Segment2[] = points.map((point, i) => ({
		start: point,
		end: points[(i + 1) % points.length]
	}));

	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	return {
		kind: 'pad',
		index,
		net: pad.net,
		layers: pad.layers,
		center: pad.position,
		desiredGrowth: desired,
		boundary: { kind: 'loop', segments },
		box: {
			minX: Math.min(...xs),
			minY: Math.min(...ys),
			maxX: Math.max(...xs),
			maxY: Math.max(...ys)
		}
	};
}

/** Grow a pad's shape by `fraction` of its desired increase (per axis). */
function growPad(pad: Pad, fraction: number, minimum: number): Pad {
	if (pad.shape.kind === 'circle') {
		const target = Math.max(pad.shape.diameter, minimum);
		return {
			...pad,
			shape: {
				kind: 'circle',
				diameter: pad.shape.diameter + (target - pad.shape.diameter) * fraction
			}
		};
	}
	if (pad.shape.kind === 'polygon') return pad;

	const growX = Math.max(0, minimum - pad.shape.sizeX) * fraction;
	const growY = Math.max(0, minimum - pad.shape.sizeY) * fraction;
	return {
		...pad,
		shape: { ...pad.shape, sizeX: pad.shape.sizeX + growX, sizeY: pad.shape.sizeY + growY }
	};
}

function sameNet(a: number, b: number): boolean {
	return a > 0 && a === b;
}

function sharesLayer(a: Feature, b: Feature): boolean {
	return a.layers === 'through' || b.layers === 'through' || a.layers === b.layers;
}

function boxesWithinReach(a: Feature, b: Feature, reach: number): boolean {
	return (
		a.box.minX - reach <= b.box.maxX &&
		b.box.minX - reach <= a.box.maxX &&
		a.box.minY - reach <= b.box.maxY &&
		b.box.minY - reach <= a.box.maxY
	);
}

/** Gap between two features' DESIGNED copper edges (negative = overlapping). */
function boundaryGap(a: Feature, b: Feature): number {
	return boundaryDistance(a.boundary, b.boundary);
}

function boundaryDistance(a: Boundary, b: Boundary): number {
	if (a.kind === 'circle' && b.kind === 'circle') {
		return distance(a.center, b.center) - a.radius - b.radius;
	}
	if (a.kind === 'circle') return circleToBoundary(a, b);
	if (b.kind === 'circle') return circleToBoundary(b, a);

	const segmentsA = boundarySegments(a);
	const segmentsB = boundarySegments(b);
	let minimum = Infinity;
	for (const segA of segmentsA) {
		for (const segB of segmentsB) {
			minimum = Math.min(minimum, segmentToSegmentDistance(segA, segB));
		}
	}
	return minimum - strokeAllowance(a) - strokeAllowance(b);
}

function circleToBoundary(circle: Extract<Boundary, { kind: 'circle' }>, other: Boundary): number {
	if (other.kind === 'circle') {
		return distance(circle.center, other.center) - circle.radius - other.radius;
	}
	let minimum = Infinity;
	for (const segment of boundarySegments(other)) {
		minimum = Math.min(minimum, pointToSegmentDistance(circle.center, segment));
	}
	return minimum - circle.radius - strokeAllowance(other);
}

function boundarySegments(boundary: Boundary): Segment2[] {
	if (boundary.kind === 'stroke') return [boundary.segment];
	if (boundary.kind === 'loop') return boundary.segments;
	return [];
}

function strokeAllowance(boundary: Boundary): number {
	return boundary.kind === 'stroke' ? boundary.halfWidth : 0;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
