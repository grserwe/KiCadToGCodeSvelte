import type { PadShape, Vec2 } from '../model/types';
import {
	degToRad,
	distance,
	infiniteLineIntersection,
	normalizeAngle,
	radToDeg,
	type Segment2
} from './primitives';
import { makeArc, type PathSegment } from '../toolpath/segments';

const MINIMUM_SEGMENT_LENGTH = 0.0001;
const TESSELLATION_STEP_DEGREES = 5;

/**
 * One edge of a closed pad outline, traversed start → end. Distances are
 * measured along the edge from its start. Outlines are wound CCW; arc edges
 * with positive sweep travel CCW (increasing angle).
 */
export type OutlineEdge = LineEdge | ArcEdge;

export class LineEdge {
	readonly kind = 'line';

	constructor(
		readonly start: Vec2,
		readonly end: Vec2
	) {}

	get length(): number {
		return distance(this.start, this.end);
	}

	positionAtDistance(along: number): Vec2 {
		const ratio = this.length > 0 ? along / this.length : 0;
		return {
			x: this.start.x + (this.end.x - this.start.x) * ratio,
			y: this.start.y + (this.end.y - this.start.y) * ratio
		};
	}

	createSegment(fromDistance: number, toDistance: number): PathSegment {
		return {
			kind: 'line',
			start: this.positionAtDistance(fromDistance),
			end: this.positionAtDistance(toDistance)
		};
	}

	infiniteLineIntersections(segment: Segment2): Vec2[] {
		const intersection = infiniteLineIntersection({ start: this.start, end: this.end }, segment);
		if (!intersection) return [];

		const { along } = this.distanceToPoint(intersection);
		const closest = this.positionAtDistance(along);
		return distance(intersection, closest) <= 0.0001 ? [intersection] : [];
	}

	distanceToPoint(point: Vec2): { distance: number; along: number } {
		const dx = this.end.x - this.start.x;
		const dy = this.end.y - this.start.y;
		const lengthSquared = dx * dx + dy * dy;
		let ratio = 0;
		if (lengthSquared > 0) {
			ratio = ((point.x - this.start.x) * dx + (point.y - this.start.y) * dy) / lengthSquared;
			ratio = Math.max(0, Math.min(1, ratio));
		}
		const closest = { x: this.start.x + dx * ratio, y: this.start.y + dy * ratio };
		return { distance: distance(point, closest), along: ratio * this.length };
	}

	tessellate(points: Vec2[]): void {
		points.push({ ...this.start });
	}
}

export class ArcEdge {
	readonly kind = 'arc';
	readonly startAngle: number;

	constructor(
		readonly center: Vec2,
		readonly radius: number,
		startAngleDegrees: number,
		/** Positive sweep = CCW (increasing angle). */
		readonly sweep: number
	) {
		this.startAngle = normalizeAngle(startAngleDegrees);
	}

	get length(): number {
		return Math.abs(this.sweep) * (Math.PI / 180) * this.radius;
	}

	get start(): Vec2 {
		return this.positionAtAngle(this.startAngle);
	}

	get end(): Vec2 {
		return this.positionAtAngle(this.startAngle + this.sweep);
	}

	private positionAtAngle(angleDegrees: number): Vec2 {
		const radians = degToRad(angleDegrees);
		return {
			x: this.center.x + this.radius * Math.cos(radians),
			y: this.center.y + this.radius * Math.sin(radians)
		};
	}

	private angleOfPoint(point: Vec2): number {
		return normalizeAngle(radToDeg(Math.atan2(point.y - this.center.y, point.x - this.center.x)));
	}

	/** Degrees into the sweep (from the start, in the sweep direction), if within it. */
	private degreesIntoSweep(angleDegrees: number): number | null {
		const TOLERANCE = 0.01;
		const direction = this.sweep >= 0 ? 1 : -1;
		let into = normalizeAngle(direction * (angleDegrees - this.startAngle));
		if (into >= 360 - TOLERANCE) into = 0;
		return into <= Math.abs(this.sweep) + TOLERANCE ? into : null;
	}

	positionAtDistance(along: number): Vec2 {
		const direction = this.sweep >= 0 ? 1 : -1;
		const degrees = this.radius > 0 ? radToDeg(along / this.radius) : 0;
		return this.positionAtAngle(this.startAngle + direction * degrees);
	}

	createSegment(fromDistance: number, toDistance: number): PathSegment {
		const direction = this.sweep >= 0 ? 1 : -1;
		const fromAngle = normalizeAngle(
			this.startAngle + direction * radToDeg(fromDistance / this.radius)
		);
		const toAngle = normalizeAngle(
			this.startAngle + direction * radToDeg(toDistance / this.radius)
		);
		// Emitted arcs always travel clockwise; cut direction is irrelevant
		// for isolation, so orient the sub-arc to fit.
		return this.sweep < 0
			? makeArc(this.center, this.radius, fromAngle, toAngle)
			: makeArc(this.center, this.radius, toAngle, fromAngle);
	}

	infiniteLineIntersections(segment: Segment2): Vec2[] {
		const dx = segment.end.x - segment.start.x;
		const dy = segment.end.y - segment.start.y;
		const fx = segment.start.x - this.center.x;
		const fy = segment.start.y - this.center.y;

		const a = dx * dx + dy * dy;
		const b = 2 * (fx * dx + fy * dy);
		const c = fx * fx + fy * fy - this.radius * this.radius;
		const det = b * b - 4 * a * c;

		const intersections: Vec2[] = [];
		if (a > 1e-7 && det >= 0) {
			const sqrtDet = Math.sqrt(det);
			for (const t of [(-b + sqrtDet) / (2 * a), (-b - sqrtDet) / (2 * a)]) {
				const point = { x: segment.start.x + t * dx, y: segment.start.y + t * dy };
				if (this.degreesIntoSweep(this.angleOfPoint(point)) !== null) {
					if (!intersections.some((existing) => distance(existing, point) < 0.0001)) {
						intersections.push(point);
					}
				}
			}
		}
		return intersections;
	}

	distanceToPoint(point: Vec2): { distance: number; along: number } {
		const into = this.degreesIntoSweep(this.angleOfPoint(point));
		if (into !== null) {
			return {
				distance: Math.abs(distance(this.center, point) - this.radius),
				along: Math.min(degToRad(into) * this.radius, this.length)
			};
		}
		const toStart = distance(point, this.start);
		const toEnd = distance(point, this.end);
		return toStart <= toEnd
			? { distance: toStart, along: 0 }
			: { distance: toEnd, along: this.length };
	}

	tessellate(points: Vec2[]): void {
		const steps = Math.max(1, Math.ceil(Math.abs(this.sweep) / TESSELLATION_STEP_DEGREES));
		const perStep = this.sweep / steps;
		for (let step = 0; step < steps; step++) {
			points.push(this.positionAtAngle(this.startAngle + perStep * step));
		}
	}
}

/**
 * Build a pad's isolation outline in WORLD coordinates: the copper shape
 * inflated outward by `inflate` (the tool offset), rotated by the pad's
 * rotation, and translated to its position. Outlines are CCW.
 *
 * Inflation is exact for convex shapes: line edges shift along their outward
 * normal, arc edges grow in radius, and gaps at convex corners are closed
 * with arcs of radius `inflate` centered on the original corner.
 */
export function buildPadOutline(
	shape: Exclude<PadShape, { kind: 'circle' }>,
	rotationDeg: number,
	position: Vec2,
	inflate: number
): OutlineEdge[] {
	const local = buildLocalOutline(shape);
	const inflated = inflate > 0 ? inflateLoop(local, inflate) : local;
	return inflated.map((edge) => transformEdge(edge, rotationDeg, position));
}

/** The un-inflated copper outline in pad-local Y-up coordinates, wound CCW. */
function buildLocalOutline(shape: Exclude<PadShape, { kind: 'circle' }>): OutlineEdge[] {
	switch (shape.kind) {
		case 'rect':
			return buildRectangularOutline(
				shape.sizeX,
				shape.sizeY,
				[0, 0, 0, 0],
				[false, false, false, false]
			);

		case 'roundrect': {
			const smallestSide = Math.min(shape.sizeX, shape.sizeY);
			const cornerRadius = Math.max(0, Math.min(0.5, shape.cornerRadiusRatio)) * smallestSide;
			const chamferSize = Math.max(0, Math.min(0.5, shape.chamferRatio)) * smallestSide;
			// Corner order: bottom-right, top-right, top-left, bottom-left.
			const chamfers = [
				shape.chamferBottomRight,
				shape.chamferTopRight,
				shape.chamferTopLeft,
				shape.chamferBottomLeft
			];
			return buildRectangularOutline(
				shape.sizeX,
				shape.sizeY,
				chamfers.map((isChamfer) => (isChamfer ? chamferSize : cornerRadius)),
				chamfers
			);
		}

		case 'oval':
			return buildOvalOutline(shape.sizeX, shape.sizeY);

		case 'trapezoid': {
			const hw = shape.sizeX / 2;
			const hh = shape.sizeY / 2;
			const hdx = shape.rectDeltaX / 2;
			const hdy = shape.rectDeltaY / 2;
			// KiCad's TransformTrapezoidToPolygon corners, converted to Y-up, CCW.
			return polygonEdges([
				{ x: -hw - hdy, y: -hh - hdx },
				{ x: hw + hdy, y: -hh + hdx },
				{ x: hw - hdy, y: hh - hdx },
				{ x: -hw + hdy, y: hh + hdx }
			]);
		}

		case 'polygon':
			return polygonEdges(ensureCounterClockwise(shape.points));
	}
}

/**
 * Rectangle with per-corner treatment, wound CCW starting from the bottom
 * edge. `insets`/`chamfers` are ordered bottom-right, top-right, top-left,
 * bottom-left; a zero inset is a sharp corner, otherwise the corner is an arc
 * (chamfer false) or a straight cut (chamfer true).
 */
function buildRectangularOutline(
	sizeX: number,
	sizeY: number,
	insets: number[],
	chamfers: boolean[]
): OutlineEdge[] {
	const hw = sizeX / 2;
	const hh = sizeY / 2;
	const [br, tr, tl, bl] = insets;
	const edges: OutlineEdge[] = [];

	const addLine = (start: Vec2, end: Vec2) => {
		if (distance(start, end) > MINIMUM_SEGMENT_LENGTH) {
			edges.push(new LineEdge(start, end));
		}
	};
	const addCorner = (inset: number, isChamfer: boolean, corner: number) => {
		if (inset <= 0) return;
		// Corner index: 0 = bottom-right (arc 270→360), 1 = top-right (0→90),
		// 2 = top-left (90→180), 3 = bottom-left (180→270).
		const centers: Vec2[] = [
			{ x: hw - br, y: -hh + br },
			{ x: hw - tr, y: hh - tr },
			{ x: -hw + tl, y: hh - tl },
			{ x: -hw + bl, y: -hh + bl }
		];
		const startAngles = [270, 0, 90, 180];
		if (isChamfer) {
			const arc = new ArcEdge(centers[corner], inset, startAngles[corner], 90);
			addLine(arc.start, arc.end);
		} else {
			edges.push(new ArcEdge(centers[corner], inset, startAngles[corner], 90));
		}
	};

	addLine({ x: -hw + bl, y: -hh }, { x: hw - br, y: -hh }); // bottom, left→right
	addCorner(br, chamfers[0], 0);
	addLine({ x: hw, y: -hh + br }, { x: hw, y: hh - tr }); // right, bottom→top
	addCorner(tr, chamfers[1], 1);
	addLine({ x: hw - tr, y: hh }, { x: -hw + tl, y: hh }); // top, right→left
	addCorner(tl, chamfers[2], 2);
	addLine({ x: -hw, y: hh - tl }, { x: -hw, y: -hh + bl }); // left, top→bottom
	addCorner(bl, chamfers[3], 3);

	return edges;
}

/** Stadium outline, wound CCW. */
function buildOvalOutline(sizeX: number, sizeY: number): OutlineEdge[] {
	const edges: OutlineEdge[] = [];

	if (sizeX >= sizeY) {
		const capRadius = sizeY / 2;
		const capOffset = sizeX / 2 - capRadius;
		edges.push(new LineEdge({ x: -capOffset, y: -capRadius }, { x: capOffset, y: -capRadius }));
		edges.push(new ArcEdge({ x: capOffset, y: 0 }, capRadius, 270, 180));
		edges.push(new LineEdge({ x: capOffset, y: capRadius }, { x: -capOffset, y: capRadius }));
		edges.push(new ArcEdge({ x: -capOffset, y: 0 }, capRadius, 90, 180));
	} else {
		const capRadius = sizeX / 2;
		const capOffset = sizeY / 2 - capRadius;
		edges.push(new LineEdge({ x: capRadius, y: -capOffset }, { x: capRadius, y: capOffset }));
		edges.push(new ArcEdge({ x: 0, y: capOffset }, capRadius, 0, 180));
		edges.push(new LineEdge({ x: -capRadius, y: capOffset }, { x: -capRadius, y: -capOffset }));
		edges.push(new ArcEdge({ x: 0, y: -capOffset }, capRadius, 180, 180));
	}

	return edges;
}

function polygonEdges(points: Vec2[]): OutlineEdge[] {
	const edges: OutlineEdge[] = [];
	for (let index = 0; index < points.length; index++) {
		const start = points[index];
		const end = points[(index + 1) % points.length];
		if (distance(start, end) > MINIMUM_SEGMENT_LENGTH) {
			edges.push(new LineEdge(start, end));
		}
	}
	return edges;
}

function ensureCounterClockwise(points: Vec2[]): Vec2[] {
	let doubleArea = 0;
	for (let index = 0; index < points.length; index++) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		doubleArea += current.x * next.y - next.x * current.y;
	}
	return doubleArea >= 0 ? points : [...points].reverse();
}

/**
 * Offset a CCW loop outward by `amount`: lines shift along their outward
 * (right-hand) normal, CCW arcs grow in radius, and corner gaps are closed
 * with arcs centered on the original vertices. Exact for convex loops;
 * reflex corners of unusual custom pads get a straight closing edge instead.
 */
function inflateLoop(edges: OutlineEdge[], amount: number): OutlineEdge[] {
	interface OffsetPiece {
		edge: OutlineEdge;
		originalStart: Vec2;
		originalEnd: Vec2;
	}

	const pieces: OffsetPiece[] = edges.map((edge) => {
		if (edge.kind === 'line') {
			const dx = edge.end.x - edge.start.x;
			const dy = edge.end.y - edge.start.y;
			const length = Math.hypot(dx, dy);
			const normal = { x: dy / length, y: -dx / length }; // outward for CCW
			return {
				edge: new LineEdge(
					{ x: edge.start.x + normal.x * amount, y: edge.start.y + normal.y * amount },
					{ x: edge.end.x + normal.x * amount, y: edge.end.y + normal.y * amount }
				),
				originalStart: edge.start,
				originalEnd: edge.end
			};
		}
		return {
			edge: new ArcEdge(edge.center, edge.radius + amount, edge.startAngle, edge.sweep),
			originalStart: edge.start,
			originalEnd: edge.end
		};
	});

	const result: OutlineEdge[] = [];
	for (let index = 0; index < pieces.length; index++) {
		const piece = pieces[index];
		const next = pieces[(index + 1) % pieces.length];
		result.push(piece.edge);

		const gapStart = piece.edge.end;
		const gapEnd = next.edge.start;
		if (distance(gapStart, gapEnd) <= MINIMUM_SEGMENT_LENGTH) continue;

		// The two offset edges pulled apart at the shared original corner —
		// close the gap with an arc around that corner.
		const corner = piece.originalEnd;
		const startAngle = normalizeAngle(
			radToDeg(Math.atan2(gapStart.y - corner.y, gapStart.x - corner.x))
		);
		const endAngle = normalizeAngle(radToDeg(Math.atan2(gapEnd.y - corner.y, gapEnd.x - corner.x)));
		const sweep = normalizeAngle(endAngle - startAngle);
		if (sweep <= 180) {
			result.push(new ArcEdge(corner, amount, startAngle, sweep));
		} else {
			// Reflex corner (non-convex outline): fall back to a straight join.
			result.push(new LineEdge({ ...gapStart }, { ...gapEnd }));
		}
	}
	return result;
}

function transformEdge(edge: OutlineEdge, rotationDeg: number, position: Vec2): OutlineEdge {
	const radians = degToRad(rotationDeg);
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const transform = (point: Vec2): Vec2 => ({
		x: position.x + point.x * cos - point.y * sin,
		y: position.y + point.x * sin + point.y * cos
	});

	if (edge.kind === 'line') {
		return new LineEdge(transform(edge.start), transform(edge.end));
	}
	return new ArcEdge(
		transform(edge.center),
		edge.radius,
		edge.startAngle + rotationDeg,
		edge.sweep
	);
}
