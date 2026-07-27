/**
 * Board model produced by the parser.
 *
 * Coordinate convention (decided once, here): board-local, millimeters,
 * **Y-up** with the origin at the board's lower-left corner. KiCad files are
 * Y-down; the parser converts at extraction time (`x' = x - minX`,
 * `y' = maxYFile - y`). Angles are degrees, counterclockwise-positive — a
 * KiCad rotation (visually CCW in its Y-down view) maps to CCW here.
 */

export interface Vec2 {
	x: number;
	y: number;
}

/** Copper side. The engine supports two-layer boards only. */
export type LayerId = 'top' | 'bottom';

/** Which copper a pad touches. */
export type PadLayers = LayerId | 'through';

export interface Track {
	start: Vec2;
	end: Vec2;
	width: number;
	layer: LayerId;
}

export type PadShape =
	| { kind: 'circle'; diameter: number }
	| { kind: 'oval'; sizeX: number; sizeY: number }
	| { kind: 'rect'; sizeX: number; sizeY: number }
	| {
			kind: 'roundrect';
			sizeX: number;
			sizeY: number;
			cornerRadiusRatio: number;
			chamferRatio: number;
			chamferTopLeft: boolean;
			chamferTopRight: boolean;
			chamferBottomLeft: boolean;
			chamferBottomRight: boolean;
	  }
	| { kind: 'trapezoid'; sizeX: number; sizeY: number; rectDeltaX: number; rectDeltaY: number }
	/** Custom pad outline; points are pad-local, Y-up, unrotated. */
	| { kind: 'polygon'; points: Vec2[] };

export interface Drill {
	/** Hole diameter to drill (for oval slots, the smaller axis). */
	diameter: number;
	/** Present when the source hole is an oval slot the CNC cannot drill as-is. */
	oval?: { width: number; height: number };
}

export interface Pad {
	/** Board-local center position. */
	position: Vec2;
	shape: PadShape;
	/** Total rotation in degrees, CCW-positive in board-local coordinates. */
	rotationDeg: number;
	drill: Drill | null;
	layers: PadLayers;
	/** Ground-net pads get thermal-relief isolation instead of a full ring. */
	isGround: boolean;
	/** False for np_thru_hole mounting holes: drill, but no copper to isolate. */
	plated: boolean;
	/** 'footprint' pads come from components; 'via' pads from via records. */
	source: 'footprint' | 'via';
	footprint?: string;
	padName?: string;
}

export interface EngineWarning {
	code:
		| 'oval-drill'
		| 'via-drill-missing'
		| 'inner-layer-track'
		| 'curved-track'
		| 'copper-zone'
		| 'custom-pad-primitives'
		| 'blind-buried-via'
		| 'pad-skipped'
		| 'track-skipped'
		| 'drill-offset';
	message: string;
}

export interface BoardModel {
	/** Board extents in mm (from Edge.Cuts when available). */
	width: number;
	height: number;
	/** KiCad file-format version number, e.g. 20241229. */
	fileVersion: number;
	tracks: Track[];
	pads: Pad[];
}
