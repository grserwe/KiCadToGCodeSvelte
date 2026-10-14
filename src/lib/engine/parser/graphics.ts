import type { SExpr } from '../sexpr/types';
import type { EngineWarning, GraphicLayer, Vec2 } from '../model/types';
import type { Dialect } from './dialect';
import { findAllRecursive, findChild, numberAttr } from './sexprHelpers';
import { rotateAbout } from '../geometry/arcs';

/** KiCad's default silkscreen line width, used when a record has none. */
const DEFAULT_LINE_WIDTH = 0.12;

/**
 * A drawing primitive still in KiCad file coordinates (Y-down, absolute mm).
 * Arcs are kept as three points so they transform like everything else; the
 * board parser converts them to center form once the coordinate frame is final.
 */
export type RawGraphic =
	| { kind: 'line'; layer: GraphicLayer; start: Vec2; end: Vec2; width: number }
	| { kind: 'arc'; layer: GraphicLayer; start: Vec2; mid: Vec2; end: Vec2; width: number }
	| {
			kind: 'circle';
			layer: GraphicLayer;
			center: Vec2;
			radius: number;
			width: number;
			filled: boolean;
	  }
	| { kind: 'polygon'; layer: GraphicLayer; points: Vec2[]; width: number; filled: boolean }
	| {
			kind: 'text';
			layer: GraphicLayer;
			text: string;
			position: Vec2;
			rotationDeg: number;
			height: number;
			thickness: number;
	  };

/**
 * Silkscreen (F.SilkS / B.SilkS) and board-edge (Edge.Cuts) drawings: the
 * `fp_*` items of every footprint, placed by the footprint's position and
 * rotation, plus the board-level `gr_*` items.
 */
export function extractGraphics(
	root: SExpr,
	dialect: Dialect,
	warnings: EngineWarning[]
): RawGraphic[] {
	const graphics: RawGraphic[] = [];

	for (const footprint of findAllRecursive(root, dialect.footprintNodeName)) {
		const at = findChild(footprint, 'at');
		const footprintX = numberAttr(at, 0);
		const footprintY = numberAttr(at, 1);
		const footprintRotation = numberAttr(at, 2) ?? 0;
		if (footprintX === undefined || footprintY === undefined) continue;

		// Same placement math as pads: KiCad file coordinates are Y-down with
		// CCW-positive (on screen) footprint rotation.
		const radians = (footprintRotation * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		const place = (local: Vec2): Vec2 => ({
			x: footprintX + local.x * cos + local.y * sin,
			y: footprintY - local.x * sin + local.y * cos
		});

		for (const record of footprint.children) {
			const graphic = parseRecord(record, place, footprintRotation, warnings);
			if (graphic) graphics.push(graphic);
		}
	}

	for (const record of root.children) {
		if (!record.name.toLowerCase().startsWith('gr_')) continue;
		const graphic = parseRecord(record, (p) => p, 0, warnings);
		if (graphic) graphics.push(graphic);
	}

	return graphics;
}

function graphicLayer(record: SExpr): GraphicLayer | null {
	const name = findChild(record, 'layer')?.attributes[0];
	if (!name) return null;
	const upper = name.toUpperCase();
	if (upper === 'F.SILKS') return 'silk-top';
	if (upper === 'B.SILKS') return 'silk-bottom';
	if (upper === 'EDGE.CUTS') return 'edge';
	return null;
}

function parseRecord(
	record: SExpr,
	place: (local: Vec2) => Vec2,
	footprintRotation: number,
	warnings: EngineWarning[]
): RawGraphic | null {
	const name = record.name.toLowerCase();
	const shape = name === 'property' ? 'property' : name.replace(/^(fp|gr)_/, '');
	if (shape === name && name !== 'property') return null;

	const layer = graphicLayer(record);
	if (!layer) return null;

	switch (shape) {
		case 'line': {
			const start = childPoint(record, 'start');
			const end = childPoint(record, 'end');
			if (!start || !end) return null;
			return {
				kind: 'line',
				layer,
				start: place(start),
				end: place(end),
				width: lineWidth(record)
			};
		}

		case 'arc':
			return parseArc(record, layer, place, warnings);

		case 'circle': {
			const center = childPoint(record, 'center');
			const end = childPoint(record, 'end');
			if (!center || !end) return null;
			return {
				kind: 'circle',
				layer,
				center: place(center),
				radius: Math.hypot(end.x - center.x, end.y - center.y),
				width: lineWidth(record),
				filled: isFilled(record)
			};
		}

		case 'rect': {
			const start = childPoint(record, 'start');
			const end = childPoint(record, 'end');
			if (!start || !end) return null;
			const corners = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
			return {
				kind: 'polygon',
				layer,
				points: corners.map(place),
				width: lineWidth(record),
				filled: isFilled(record)
			};
		}

		case 'poly': {
			const pts = findChild(record, 'pts');
			if (!pts) return null;
			const points: Vec2[] = [];
			let curvedEdges = 0;
			for (const child of pts.children) {
				const childName = child.name.toLowerCase();
				if (childName === 'xy') {
					const x = numberAttr(child, 0);
					const y = numberAttr(child, 1);
					if (x !== undefined && y !== undefined) points.push({ x, y });
				} else if (childName === 'arc') {
					// KiCad 7+ polygons may carry arc edges; keep their endpoints.
					curvedEdges++;
					for (const pointName of ['start', 'end']) {
						const point = childPoint(child, pointName);
						if (point) points.push(point);
					}
				}
			}
			if (points.length < 2) return null;
			if (curvedEdges > 0) {
				warnings.push({
					code: 'graphic-skipped',
					message: `A polygon on ${describeLayer(layer)} has ${curvedEdges} curved edge${curvedEdges === 1 ? '' : 's'}; they were drawn as straight lines.`
				});
			}
			return {
				kind: 'polygon',
				layer,
				points: points.map(place),
				width: lineWidth(record),
				filled: isFilled(record)
			};
		}

		case 'text':
		case 'property':
			return parseText(record, layer, place, footprintRotation);

		default:
			return null;
	}
}

/**
 * Arcs come in two dialects: modern files store three points on the arc
 * (`start`, `mid`, `end`); KiCad 4/5 files store the center as `start`, the
 * arc's start point as `end`, and a signed `angle` (positive = clockwise on
 * screen, which is a positive rotation in Y-down file coordinates).
 */
function parseArc(
	record: SExpr,
	layer: GraphicLayer,
	place: (local: Vec2) => Vec2,
	warnings: EngineWarning[]
): RawGraphic | null {
	const width = lineWidth(record);
	const mid = childPoint(record, 'mid');
	if (mid) {
		const start = childPoint(record, 'start');
		const end = childPoint(record, 'end');
		if (!start || !end) return null;
		return { kind: 'arc', layer, start: place(start), mid: place(mid), end: place(end), width };
	}

	const center = childPoint(record, 'start');
	const start = childPoint(record, 'end');
	const angle = numberAttr(findChild(record, 'angle'), 0);
	if (!center || !start || angle === undefined) {
		warnings.push({
			code: 'graphic-skipped',
			message: `An arc on ${describeLayer(layer)} has an unreadable shape and was skipped.`
		});
		return null;
	}
	if (Math.abs(angle) >= 360) {
		return {
			kind: 'circle',
			layer,
			center: place(center),
			radius: Math.hypot(start.x - center.x, start.y - center.y),
			width,
			filled: false
		};
	}
	return {
		kind: 'arc',
		layer,
		start: place(start),
		mid: place(rotateAbout(start, center, angle / 2)),
		end: place(rotateAbout(start, center, angle)),
		width
	};
}

/**
 * Reference/value/user text. Modern files store the reference and value as
 * `property` records, older ones as `fp_text reference|value`; board-level
 * text is `gr_text`. Hidden text is dropped.
 */
function parseText(
	record: SExpr,
	layer: GraphicLayer,
	place: (local: Vec2) => Vec2,
	footprintRotation: number
): RawGraphic | null {
	const name = record.name.toLowerCase();
	const isHidden =
		record.attributes.some((a) => a.toLowerCase() === 'hide') ||
		(findChild(record, 'hide')?.attributes[0] ?? 'no').toLowerCase() === 'yes';
	if (isHidden) return null;

	let text: string;
	if (name === 'property') {
		// (property "Reference" "R1" …) — only positioned properties are drawn.
		if (!findChild(record, 'at')) return null;
		text = record.attributes[1] ?? '';
	} else if (name === 'gr_text') {
		text = record.attributes[0] ?? '';
	} else {
		text = record.attributes[1] ?? '';
	}
	if (text.trim() === '') return null;

	const at = findChild(record, 'at');
	const x = numberAttr(at, 0);
	const y = numberAttr(at, 1);
	if (x === undefined || y === undefined) return null;

	const font = findChild(findChild(record, 'effects') ?? record, 'font');
	const size = font ? findChild(font, 'size') : undefined;
	const height = numberAttr(size, 1) ?? numberAttr(size, 0) ?? 1;
	const thickness = numberAttr(font ? findChild(font, 'thickness') : undefined, 0) ?? height * 0.15;

	return {
		kind: 'text',
		layer,
		text,
		position: place({ x, y }),
		// Like pads, KiCad stores a footprint text's TOTAL rotation.
		rotationDeg: numberAttr(at, 2) ?? footprintRotation,
		height,
		thickness
	};
}

function lineWidth(record: SExpr): number {
	const stroke = findChild(record, 'stroke');
	const width = stroke
		? numberAttr(findChild(stroke, 'width'), 0)
		: numberAttr(findChild(record, 'width'), 0);
	return width !== undefined && width > 0 ? width : DEFAULT_LINE_WIDTH;
}

function isFilled(record: SExpr): boolean {
	const fill = (findChild(record, 'fill')?.attributes[0] ?? 'none').toLowerCase();
	return fill === 'solid' || fill === 'yes';
}

function childPoint(record: SExpr, name: string): Vec2 | null {
	const child = findChild(record, name);
	const x = numberAttr(child, 0);
	const y = numberAttr(child, 1);
	return x !== undefined && y !== undefined ? { x, y } : null;
}

function describeLayer(layer: GraphicLayer): string {
	switch (layer) {
		case 'silk-top':
			return 'the top silkscreen';
		case 'silk-bottom':
			return 'the bottom silkscreen';
		case 'edge':
			return 'the board outline';
	}
}
