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
	/** KiCad net number; 0 = unconnected. Features on the same net may touch. */
	net: number;
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
	/** KiCad net number; 0 = unconnected. Features on the same net may touch. */
	net: number;
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
		| 'drill-offset'
		| 'width-capped'
		| 'clearance'
		| 'graphic-skipped'
		| 'silkscreen-text'
		| 'outline-open'
		| 'outline-tight';
	message: string;
}

/** Non-copper drawing layers the engine keeps: silkscreen and the board edge. */
export type GraphicLayer = 'silk-top' | 'silk-bottom' | 'edge';

export interface TextJustify {
	horizontal: 'left' | 'center' | 'right';
	vertical: 'top' | 'center' | 'bottom';
}

/**
 * A drawing primitive from a silkscreen or Edge.Cuts layer, in board-local
 * Y-up coordinates. Widths are stroke widths in mm. Arc sweeps are
 * CCW-positive. Text is laid out with KiCad's stroke font when rendered.
 */
export type Graphic =
	| { kind: 'line'; layer: GraphicLayer; start: Vec2; end: Vec2; width: number }
	| {
			kind: 'arc';
			layer: GraphicLayer;
			center: Vec2;
			radius: number;
			/** Degrees, 0° = +X, CCW-positive. */
			startAngle: number;
			/** Degrees swept from startAngle; positive = CCW. */
			sweep: number;
			width: number;
	  }
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
			/** Lines separated by '\n'; ${REFERENCE}/${VALUE} already substituted. */
			text: string;
			/** Anchor point the justification is relative to. */
			position: Vec2;
			/** Degrees, CCW-positive (absolute, not relative to the footprint). */
			rotationDeg: number;
			/** Glyph width (x) and height (y) in mm — KiCad's `(size height width)`. */
			size: Vec2;
			/** Stroke thickness in mm. */
			thickness: number;
			justify: TextJustify;
			/** Mirrored about the anchor (back-side text). */
			mirrored: boolean;
			italic: boolean;
	  };

export interface BoardModel {
	/** Board extents in mm (from Edge.Cuts when available). */
	width: number;
	height: number;
	/** KiCad file-format version number, e.g. 20241229. */
	fileVersion: number;
	tracks: Track[];
	pads: Pad[];
	/** Silkscreen and board-edge drawings (not machined; used for the laser SVG). */
	graphics: Graphic[];
}
