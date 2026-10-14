/**
 * A small GCode interpreter for the viewer: replays an emitted program the
 * way a GRBL-style controller would and records every tool movement, so the
 * preview shows what the file will actually do rather than what the engine
 * intended. Also reports the machine-safety problems a controller would not
 * catch for you (rapids while the tool is down, arcs whose radii disagree,
 * cutting with the spindle off, …).
 */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export type MoveKind =
	/** G00 with an XY change (tool should be above the work). */
	| 'rapid'
	/** Feed move (G01/G02/G03) with an XY change at or below the surface. */
	| 'cut'
	/** Feed move with an XY change above the surface — cutting air. */
	| 'air'
	/** Z-only move that ends at or below the surface. */
	| 'plunge'
	/** Z-only move that ends above the surface. */
	| 'retract';

export interface GCodeArc {
	center: { x: number; y: number };
	radius: number;
	/** True for G02 (clockwise in the machine's Y-up XY plane). */
	clockwise: boolean;
	/** Degrees swept; 360 for a full circle. */
	sweepDeg: number;
}

export interface GCodeMove {
	/** 1-based source line. */
	line: number;
	text: string;
	code: 'G00' | 'G01' | 'G02' | 'G03';
	kind: MoveKind;
	from: Vec3;
	to: Vec3;
	/** Feed rate in effect, in units/min; null when none has been set. */
	feed: number | null;
	arc: GCodeArc | null;
	/** SVG path `d` in machine XY coordinates (Y-up); null for Z-only moves. */
	d: string | null;
	/** Distance travelled in the XY plane. */
	lengthXY: number;
	/** Distance travelled in 3D (lengthXY plus any Z change for straight moves). */
	length: number;
}

export interface GCodeIssue {
	line: number;
	text: string;
	message: string;
}

export interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export interface GCodeStats {
	cutLength: number;
	rapidLength: number;
	airLength: number;
	plungeCount: number;
	/** Minutes spent in feed moves (rapids without a feed rate are excluded). */
	feedMinutes: number;
	/** Deepest Z reached; null when the program never moved Z. */
	minZ: number | null;
	/** Highest Z reached; null when the program never moved Z. */
	maxZ: number | null;
	spindleRPM: number | null;
}

export interface GCodeProgram {
	moves: GCodeMove[];
	issues: GCodeIssue[];
	/** Units declared by G20/G21; null when the program never declares them. */
	units: 'mm' | 'inch' | null;
	/** Extent of cutting moves and plunges, or null when nothing cuts. */
	cutBounds: Bounds | null;
	/** Extent of every XY movement, or null when nothing moves. */
	bounds: Bounds | null;
	stats: GCodeStats;
}

const SUPPORTED_G = new Set([0, 1, 2, 3, 4, 17, 20, 21, 90, 91, 94]);
const SUPPORTED_M = new Set([0, 1, 2, 3, 4, 5, 8, 9, 30]);
const ARC_RADIUS_TOLERANCE = 0.002;
const EPSILON = 1e-7;

interface Word {
	letter: string;
	value: number;
}

/** Strip `( … )` and `; …` comments and split a line into letter/number words. */
function tokenize(raw: string): Word[] {
	const withoutComments = raw.replace(/\([^)]*\)/g, ' ').replace(/;.*$/, '');
	const words: Word[] = [];
	const pattern = /([A-Za-z])\s*([-+]?\d*\.?\d+)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(withoutComments)) !== null) {
		words.push({ letter: match[1].toUpperCase(), value: Number(match[2]) });
	}
	return words;
}

function round(value: number): number {
	return Math.round(value * 1e5) / 1e5;
}

function normalizeSweep(degrees: number): number {
	let sweep = degrees % 360;
	if (sweep < 0) sweep += 360;
	return sweep;
}

/** SVG path for an arc in Y-up machine space (callers flip Y when drawing). */
function arcPath(from: Vec3, to: Vec3, arc: GCodeArc): string {
	const r = round(arc.radius);
	// After the caller's Y flip, a clockwise machine arc is SVG sweep-flag 0.
	const sweepFlag = arc.clockwise ? 0 : 1;
	if (arc.sweepDeg >= 360 - 1e-6) {
		const opposite = {
			x: 2 * arc.center.x - from.x,
			y: 2 * arc.center.y - from.y
		};
		return (
			`M ${round(from.x)} ${round(from.y)} ` +
			`A ${r} ${r} 0 1 ${sweepFlag} ${round(opposite.x)} ${round(opposite.y)} ` +
			`A ${r} ${r} 0 1 ${sweepFlag} ${round(from.x)} ${round(from.y)}`
		);
	}
	const largeArc = arc.sweepDeg > 180 ? 1 : 0;
	return `M ${round(from.x)} ${round(from.y)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${round(to.x)} ${round(to.y)}`;
}

function extendBounds(bounds: Bounds | null, x: number, y: number): Bounds {
	if (!bounds) return { minX: x, maxX: x, minY: y, maxY: y };
	return {
		minX: Math.min(bounds.minX, x),
		maxX: Math.max(bounds.maxX, x),
		minY: Math.min(bounds.minY, y),
		maxY: Math.max(bounds.maxY, y)
	};
}

/** Grow bounds to cover an arc's full extent, not just its endpoints. */
function extendBoundsForArc(bounds: Bounds | null, from: Vec3, to: Vec3, arc: GCodeArc): Bounds {
	let result = extendBounds(extendBounds(bounds, from.x, from.y), to.x, to.y);
	const startAngle = (Math.atan2(from.y - arc.center.y, from.x - arc.center.x) * 180) / Math.PI;
	for (const quadrant of [0, 90, 180, 270]) {
		// Angular distance from the start to this axis crossing, in travel direction.
		const delta = arc.clockwise
			? normalizeSweep(startAngle - quadrant)
			: normalizeSweep(quadrant - startAngle);
		if (delta > 0 && delta < arc.sweepDeg) {
			const radians = (quadrant * Math.PI) / 180;
			result = extendBounds(
				result,
				arc.center.x + arc.radius * Math.cos(radians),
				arc.center.y + arc.radius * Math.sin(radians)
			);
		}
	}
	return result;
}

/** Replay a GCode program and collect its moves, issues and statistics. */
export function interpretGCode(content: string): GCodeProgram {
	const moves: GCodeMove[] = [];
	const issues: GCodeIssue[] = [];

	let units: 'mm' | 'inch' | null = null;
	let absolute = true;
	let motion: 0 | 1 | 2 | 3 = 0;
	let feed: number | null = null;
	let spindleOn = false;
	let ended = false;
	let zKnown = false;
	let position: Vec3 = { x: 0, y: 0, z: 0 };

	let cutBounds: Bounds | null = null;
	let bounds: Bounds | null = null;
	const stats: GCodeStats = {
		cutLength: 0,
		rapidLength: 0,
		airLength: 0,
		plungeCount: 0,
		feedMinutes: 0,
		minZ: null,
		maxZ: null,
		spindleRPM: null
	};

	const lines = content.split(/\r?\n/);
	lines.forEach((raw, index) => {
		const lineNumber = index + 1;
		const text = raw.trim();
		const words = tokenize(raw);
		if (words.length === 0) return;
		const report = (message: string) => issues.push({ line: lineNumber, text, message });

		if (ended) {
			report('Command after the program ended (M02/M30) — a controller will ignore it');
			return;
		}

		let hasMotionWords = false;
		let motionThisLine: 0 | 1 | 2 | 3 | null = null;
		let x: number | null = null;
		let y: number | null = null;
		let z: number | null = null;
		let i: number | null = null;
		let j: number | null = null;
		let r: number | null = null;

		for (const word of words) {
			switch (word.letter) {
				case 'G': {
					const code = Math.round(word.value);
					if (!SUPPORTED_G.has(code)) {
						report(`G${code} is not understood by this viewer (or by GRBL)`);
						break;
					}
					if (code <= 3) {
						motionThisLine = code as 0 | 1 | 2 | 3;
						motion = motionThisLine;
					} else if (code === 20) units = 'inch';
					else if (code === 21) units = 'mm';
					else if (code === 90) absolute = true;
					else if (code === 91) absolute = false;
					break;
				}
				case 'M': {
					const code = Math.round(word.value);
					if (!SUPPORTED_M.has(code)) {
						report(`M${code} is not understood by this viewer (or by GRBL)`);
					} else if (code === 3 || code === 4) spindleOn = true;
					else if (code === 5) spindleOn = false;
					else if (code === 2 || code === 30) ended = true;
					break;
				}
				case 'F':
					feed = word.value;
					break;
				case 'S':
					stats.spindleRPM = word.value;
					break;
				case 'X':
					x = word.value;
					hasMotionWords = true;
					break;
				case 'Y':
					y = word.value;
					hasMotionWords = true;
					break;
				case 'Z':
					z = word.value;
					hasMotionWords = true;
					break;
				case 'I':
					i = word.value;
					break;
				case 'J':
					j = word.value;
					break;
				case 'R':
					r = word.value;
					break;
				case 'K':
					report('K (XZ/YZ plane arcs) is not supported');
					break;
				case 'P':
				case 'N':
				case 'T':
					break;
				default:
					report(`Unexpected word ${word.letter}${word.value}`);
			}
		}

		if (ended && spindleOn) {
			report('Program ends with the spindle still running');
		}
		if (!hasMotionWords) return;

		const code = motionThisLine ?? motion;
		const from = position;
		const to: Vec3 = absolute
			? { x: x ?? from.x, y: y ?? from.y, z: z ?? from.z }
			: { x: from.x + (x ?? 0), y: from.y + (y ?? 0), z: from.z + (z ?? 0) };
		if (z !== null) zKnown = true;

		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const dz = to.z - from.z;
		const movesXY = Math.abs(dx) > EPSILON || Math.abs(dy) > EPSILON;
		const movesZ = Math.abs(dz) > EPSILON;
		// Until the program says where Z is, assume the tool is parked above the work.
		const toolDownBefore = zKnown && from.z <= 0;
		const toolDownAfter = zKnown && to.z <= 0;

		let arc: GCodeArc | null = null;
		let lengthXY = Math.hypot(dx, dy);
		let d: string | null = null;

		if (code === 2 || code === 3) {
			if (r !== null) {
				report('R-format arcs are not supported by this viewer; use I/J offsets');
			} else if (i === null && j === null) {
				report('Arc move without I/J center offsets');
			} else {
				const center = { x: from.x + (i ?? 0), y: from.y + (j ?? 0) };
				const startRadius = Math.hypot(from.x - center.x, from.y - center.y);
				const endRadius = Math.hypot(to.x - center.x, to.y - center.y);
				if (Math.abs(startRadius - endRadius) > ARC_RADIUS_TOLERANCE) {
					report(
						`Arc radii disagree: start ${startRadius.toFixed(4)}, end ${endRadius.toFixed(4)} — the controller will reject or distort this arc`
					);
				}
				const clockwise = code === 2;
				let sweepDeg: number;
				if (!movesXY) {
					sweepDeg = 360;
				} else {
					const startAngle = (Math.atan2(from.y - center.y, from.x - center.x) * 180) / Math.PI;
					const endAngle = (Math.atan2(to.y - center.y, to.x - center.x) * 180) / Math.PI;
					sweepDeg = clockwise
						? normalizeSweep(startAngle - endAngle)
						: normalizeSweep(endAngle - startAngle);
					if (sweepDeg < 1e-6) sweepDeg = 360;
				}
				arc = { center, radius: startRadius, clockwise, sweepDeg };
				lengthXY = (startRadius * sweepDeg * Math.PI) / 180;
				d = arcPath(from, to, arc);
			}
		}

		if (!arc && movesXY) {
			d = `M ${round(from.x)} ${round(from.y)} L ${round(to.x)} ${round(to.y)}`;
		}

		const isRapid = code === 0;
		let kind: MoveKind;
		if (movesXY || arc) {
			if (isRapid) kind = 'rapid';
			else kind = toolDownAfter || toolDownBefore ? 'cut' : 'air';
		} else if (movesZ) {
			kind = toolDownAfter && dz < 0 ? 'plunge' : 'retract';
		} else {
			// Nothing actually moved (a repeated position).
			return;
		}

		if (isRapid && (toolDownBefore || toolDownAfter) && (movesXY || arc)) {
			report('Rapid XY move while the tool is at or below the surface');
		}
		if (isRapid && kind === 'plunge') {
			report('Rapid plunge into the work (G00 below Z0)');
		}
		if ((kind === 'cut' || kind === 'plunge') && !spindleOn) {
			report('Cutting with the spindle off');
		}
		if (!isRapid && feed === null) {
			report('Feed move before any feed rate (F) was set — GRBL rejects this');
		}
		if ((kind === 'cut' || kind === 'air') && movesZ && !arc) {
			report('Combined XY and Z move (ramp) — check this is intended');
		}

		const length = arc ? lengthXY : Math.hypot(dx, dy, dz);
		const move: GCodeMove = {
			line: lineNumber,
			text,
			code: `G0${code}` as GCodeMove['code'],
			kind,
			from,
			to,
			feed,
			arc,
			d,
			lengthXY,
			length
		};
		moves.push(move);

		if (kind === 'cut') stats.cutLength += lengthXY;
		else if (kind === 'rapid') stats.rapidLength += lengthXY;
		else if (kind === 'air') stats.airLength += lengthXY;
		if (kind === 'plunge') stats.plungeCount++;
		if (!isRapid && feed) stats.feedMinutes += length / feed;
		if (zKnown) {
			stats.minZ = stats.minZ === null ? to.z : Math.min(stats.minZ, to.z);
			stats.maxZ = stats.maxZ === null ? to.z : Math.max(stats.maxZ, to.z);
		}

		if (movesXY || arc) {
			bounds = arc
				? extendBoundsForArc(bounds, from, to, arc)
				: extendBounds(extendBounds(bounds, from.x, from.y), to.x, to.y);
		}
		if (kind === 'cut') {
			cutBounds = arc
				? extendBoundsForArc(cutBounds, from, to, arc)
				: extendBounds(extendBounds(cutBounds, from.x, from.y), to.x, to.y);
		} else if (kind === 'plunge') {
			cutBounds = extendBounds(cutBounds, to.x, to.y);
		}

		position = to;
	});

	if (!ended) {
		issues.push({ line: lines.length, text: '', message: 'Program has no M02/M30 end' });
	}
	if (units === null) {
		issues.push({
			line: 1,
			text: '',
			message: 'Program never declares units (G20/G21) — the machine will use its last setting'
		});
	}
	if (
		stats.spindleRPM === null &&
		moves.some((move) => move.kind === 'cut' || move.kind === 'plunge')
	) {
		issues.push({ line: 1, text: '', message: 'No spindle speed (S) was set' });
	}

	return { moves, issues, units, cutBounds, bounds, stats };
}
