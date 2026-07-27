import type { SExpr } from '../sexpr/types';
import type { Drill, EngineWarning, PadLayers, PadShape, Vec2 } from '../model/types';
import type { Dialect } from './dialect';
import { findAllRecursive, findChild, numberAttr } from './sexprHelpers';

/** Default via drill when a legacy file omits it (KiCad's own default). */
const DEFAULT_VIA_DRILL = 0.6;

/** A pad still in KiCad file coordinates (Y-down, absolute mm). */
export interface RawPad {
	position: Vec2;
	shape: PadShape;
	/** Pad-local polygon points are Y-down here; converted with the board. */
	rotationDeg: number;
	drill: Drill | null;
	layers: PadLayers;
	isGround: boolean;
	plated: boolean;
	source: 'footprint' | 'via';
	net: number;
	footprint?: string;
	padName?: string;
}

export function extractPads(root: SExpr, dialect: Dialect, warnings: EngineWarning[]): RawPad[] {
	const pads: RawPad[] = [];

	for (const footprint of findAllRecursive(root, dialect.footprintNodeName)) {
		const footprintName = footprint.attributes[0] ?? 'Unknown';
		const at = findChild(footprint, 'at');
		const footprintX = numberAttr(at, 0);
		const footprintY = numberAttr(at, 1);
		const footprintRotation = numberAttr(at, 2) ?? 0;

		if (footprintX === undefined || footprintY === undefined) {
			warnings.push({
				code: 'pad-skipped',
				message: `Footprint "${footprintName}" has no position — its pads were skipped.`
			});
			continue;
		}

		for (const padRecord of footprint.children) {
			if (padRecord.name.toLowerCase() !== 'pad') continue;
			const pad = parseFootprintPad(
				padRecord,
				footprintName,
				{ x: footprintX, y: footprintY },
				footprintRotation,
				dialect,
				warnings
			);
			if (pad) pads.push(pad);
		}
	}

	pads.push(...extractVias(root, warnings));

	return pads;
}

function parseFootprintPad(
	padRecord: SExpr,
	footprintName: string,
	footprintPosition: Vec2,
	footprintRotation: number,
	dialect: Dialect,
	warnings: EngineWarning[]
): RawPad | null {
	const padName = padRecord.attributes[0] ?? 'Unknown';
	const padType = (padRecord.attributes[1] ?? '').toLowerCase();
	const shapeName = (padRecord.attributes[2] ?? '').toLowerCase();
	const describe = `Pad "${padName}" of "${footprintName}"`;

	const at = findChild(padRecord, 'at');
	const offsetX = numberAttr(at, 0);
	const offsetY = numberAttr(at, 1);
	// KiCad stores the pad's TOTAL rotation (footprint + local) on the pad.
	const rotationDeg = numberAttr(at, 2) ?? footprintRotation;

	const size = findChild(padRecord, 'size');
	const sizeX = numberAttr(size, 0);
	const sizeY = numberAttr(size, 1) ?? sizeX;

	if (
		offsetX === undefined ||
		offsetY === undefined ||
		sizeX === undefined ||
		sizeY === undefined
	) {
		warnings.push({
			code: 'pad-skipped',
			message: `${describe} has no position or size and was skipped.`
		});
		return null;
	}

	// Pad world position: rotate the pad's local offset by the FOOTPRINT's
	// rotation. KiCad file coordinates are Y-down with CCW-positive angles,
	// hence the sign layout. (Equivalent to the C# VersionParser math.)
	const radians = (footprintRotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const position: Vec2 = {
		x: footprintPosition.x + offsetX * cos + offsetY * sin,
		y: footprintPosition.y - offsetX * sin + offsetY * cos
	};

	const layers = padLayers(padRecord, padType);
	const drill = parseDrill(padRecord, padType, describe, warnings);
	const shape = parseShape(padRecord, shapeName, sizeX, sizeY, describe, warnings);
	if (!shape) return null;

	return {
		position,
		shape,
		rotationDeg,
		drill,
		layers,
		isGround: dialect.isPadGround(padRecord),
		plated: padType !== 'np_thru_hole',
		source: 'footprint',
		net: numberAttr(findChild(padRecord, 'net'), 0) ?? 0,
		footprint: footprintName,
		padName
	};
}

/**
 * Which copper a pad touches. Through-hole pads are flagged by their type;
 * surface pads record copper in a `layers` child (`*.Cu` is the wildcard for
 * every copper layer). Mirrors the C# GetPadLayer.
 */
function padLayers(padRecord: SExpr, padType: string): PadLayers {
	if (padType === 'thru_hole' || padType === 'np_thru_hole') {
		return 'through';
	}
	const layersRecord = findChild(padRecord, 'layers');
	if (layersRecord) {
		const upper = layersRecord.attributes.map((a) => a.toUpperCase());
		const onTop = upper.some((a) => a.includes('F.CU'));
		const onBottom = upper.some((a) => a.includes('B.CU'));
		if (upper.some((a) => a.includes('*.CU')) || (onTop && onBottom)) {
			return 'through';
		}
		if (onTop) return 'top';
		if (onBottom) return 'bottom';
	}
	return padRecord.attributes.some((a) => a.toUpperCase().includes('F.CU')) ? 'top' : 'bottom';
}

function parseDrill(
	padRecord: SExpr,
	padType: string,
	describe: string,
	warnings: EngineWarning[]
): Drill | null {
	const drillRecord = findChild(padRecord, 'drill');
	if (!drillRecord) {
		return null;
	}

	if (findChild(drillRecord, 'offset')) {
		warnings.push({
			code: 'drill-offset',
			message: `${describe} has an offset drill hole; the offset is ignored and the hole is drilled at the pad center.`
		});
	}

	if ((drillRecord.attributes[0] ?? '').toLowerCase() === 'oval') {
		const width = numberAttr(drillRecord, 1);
		const height = numberAttr(drillRecord, 2) ?? width;
		if (width === undefined || height === undefined) {
			warnings.push({
				code: 'pad-skipped',
				message: `${describe} has an oval drill with no size; the hole was skipped.`
			});
			return null;
		}
		const diameter = Math.min(width, height);
		warnings.push({
			code: 'oval-drill',
			message: `${describe} has an oval (slot) hole ${width} × ${height} mm. It will be drilled as a single ${diameter} mm hole — elongate it by hand if needed.`
		});
		return { diameter, oval: { width, height } };
	}

	const diameter = numberAttr(drillRecord, 0);
	if (diameter === undefined) {
		if (padType === 'thru_hole' || padType === 'np_thru_hole') {
			warnings.push({
				code: 'pad-skipped',
				message: `${describe} has an unreadable drill size; the hole was skipped.`
			});
		}
		return null;
	}
	return { diameter };
}

function parseShape(
	padRecord: SExpr,
	shapeName: string,
	sizeX: number,
	sizeY: number,
	describe: string,
	warnings: EngineWarning[]
): PadShape | null {
	switch (shapeName) {
		case 'circle':
			return { kind: 'circle', diameter: sizeX };

		case 'oval':
			if (Math.abs(sizeX - sizeY) < 0.0001) {
				return { kind: 'circle', diameter: sizeX };
			}
			return { kind: 'oval', sizeX, sizeY };

		case 'rect':
			return { kind: 'rect', sizeX, sizeY };

		case 'roundrect': {
			const chamferRecord = findChild(padRecord, 'chamfer');
			const corners = (chamferRecord?.attributes ?? []).map((a) => a.toLowerCase());
			return {
				kind: 'roundrect',
				sizeX,
				sizeY,
				cornerRadiusRatio: numberAttr(findChild(padRecord, 'roundrect_rratio'), 0) ?? 0.25,
				chamferRatio: numberAttr(findChild(padRecord, 'chamfer_ratio'), 0) ?? 0,
				chamferTopLeft: corners.includes('top_left'),
				chamferTopRight: corners.includes('top_right'),
				chamferBottomLeft: corners.includes('bottom_left'),
				chamferBottomRight: corners.includes('bottom_right')
			};
		}

		case 'trapezoid': {
			const rectDelta = findChild(padRecord, 'rect_delta');
			return {
				kind: 'trapezoid',
				sizeX,
				sizeY,
				rectDeltaX: numberAttr(rectDelta, 0) ?? 0,
				rectDeltaY: numberAttr(rectDelta, 1) ?? 0
			};
		}

		case 'custom': {
			const points = customPadPolygonPoints(padRecord);
			if (points) {
				return { kind: 'polygon', points };
			}
			warnings.push({
				code: 'custom-pad-primitives',
				message: `${describe} is a custom pad whose primitives are not a single polygon; it was approximated by a ${Math.max(sizeX, sizeY)} mm circle.`
			});
			return { kind: 'circle', diameter: Math.max(sizeX, sizeY) };
		}

		default:
			warnings.push({
				code: 'pad-skipped',
				message: `${describe} has unrecognized shape "${shapeName}" and was skipped.`
			});
			return null;
	}
}

/**
 * Outline points of a custom pad's single gr_poly primitive, in pad-local
 * coordinates (still Y-down here; flipped with the rest of the board).
 * Hexagonal pads arrive this way — KiCad has no native hexagon shape.
 */
function customPadPolygonPoints(padRecord: SExpr): Vec2[] | null {
	const primitives = findChild(padRecord, 'primitives');
	if (!primitives) return null;

	const polygons = primitives.children.filter((c) => c.name.toLowerCase() === 'gr_poly');
	if (polygons.length !== 1) return null;

	const pts = findChild(polygons[0], 'pts');
	if (!pts) return null;

	const points: Vec2[] = [];
	for (const xy of pts.children) {
		if (xy.name.toLowerCase() !== 'xy') continue;
		const x = numberAttr(xy, 0);
		const y = numberAttr(xy, 1);
		if (x !== undefined && y !== undefined) {
			points.push({ x, y });
		}
	}
	return points.length >= 3 ? points : null;
}

function extractVias(root: SExpr, warnings: EngineWarning[]): RawPad[] {
	const vias: RawPad[] = [];

	for (const via of findAllRecursive(root, 'via')) {
		const at = findChild(via, 'at');
		const x = numberAttr(at, 0);
		const y = numberAttr(at, 1);
		const size = numberAttr(findChild(via, 'size'), 0);

		if (x === undefined || y === undefined || size === undefined) {
			warnings.push({
				code: 'pad-skipped',
				message: 'A via has no position or size and was skipped.'
			});
			continue;
		}

		let drillDiameter = numberAttr(findChild(via, 'drill'), 0);
		if (drillDiameter === undefined) {
			drillDiameter = DEFAULT_VIA_DRILL;
			warnings.push({
				code: 'via-drill-missing',
				message: `The via at (${x}, ${y}) has no drill size; the KiCad default of ${DEFAULT_VIA_DRILL} mm was used.`
			});
		}

		const layersRecord = findChild(via, 'layers');
		if (layersRecord) {
			const upper = layersRecord.attributes.map((a) => a.toUpperCase());
			const spansBoard =
				upper.some((a) => a.includes('*.CU')) ||
				(upper.some((a) => a.includes('F.CU')) && upper.some((a) => a.includes('B.CU')));
			if (!spansBoard) {
				warnings.push({
					code: 'blind-buried-via',
					message: `The via at (${x}, ${y}) is blind/buried; it will be drilled through the whole board.`
				});
			}
		}

		vias.push({
			position: { x, y },
			shape: { kind: 'circle', diameter: size },
			rotationDeg: 0,
			drill: { diameter: drillDiameter },
			layers: 'through',
			isGround: false,
			plated: true,
			source: 'via',
			net: numberAttr(findChild(via, 'net'), 0) ?? 0
		});
	}

	return vias;
}
