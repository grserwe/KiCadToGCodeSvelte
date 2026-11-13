import type { Units } from '../model/units';
import { effectiveToolDiameterMm, type GCodeSettings } from './settings';

export type IsolationToolKind = 'vbit' | 'endmill';

/**
 * A bit in the user's tool library and the isolation settings it runs with.
 * Lengths and feeds are stored in millimeters so a tool keeps its values when
 * the output units change.
 */
export interface IsolationTool {
	id: string;
	name: string;
	kind: IsolationToolKind;
	/** Flat tip width of a V-bit, or the end mill's diameter. */
	tipDiameterMm: number;
	/** Included angle of a V-bit; ignored for end mills. */
	angleDeg: number;
	depthMm: number;
	xySpeedMmPerMin: number;
	plungeSpeedMmPerMin: number;
	spindleRPM: number;
	passes: number;
	stepover: number;
}

/** The fields a tool sets, in the output units the settings panel shows. */
export interface IsolationToolCut {
	depth: number;
	xySpeed: number;
	plungeSpeed: number;
	spindleRPM: number;
	passes: number;
	stepover: number;
}

/** Below this cut width, a second pass is recommended for an easier-to-solder gap. */
const NARROW_CUT_MM = 0.3;

/**
 * Recommended isolation settings for a bit, in the given output units.
 *
 * - Depth: 0.003″ / 0.075 mm clears 1 oz copper (0.035 mm) with margin for an
 *   uneven bed without widening a V-bit's cut much.
 * - Feed: small end mills snap easily, so their feed scales with diameter
 *   (0.2 mm → 250 mm/min, about 10 in/min); V-bits have a stout shank behind
 *   the tip and run at 400 mm/min. Plunge is a quarter of the feed.
 * - Passes: two at 50% stepover when one pass cuts narrower than 0.3 mm.
 *
 * The spindle speed is not tool-specific here; the caller passes the current one.
 */
export function recommendIsolationCut(
	kind: IsolationToolKind,
	tipDiameterMm: number,
	angleDeg: number,
	units: Units,
	spindleRPM: number
): IsolationToolCut {
	const inch = units === 'inch';
	const depth = inch ? 0.003 : 0.075;
	const xyMm =
		kind === 'vbit' ? 400 : Math.min(500, Math.max(150, Math.round(tipDiameterMm * 1250)));
	const xySpeed = inch ? Math.round(xyMm / 25.4) : xyMm;
	const plungeSpeed = inch ? Math.max(1, Math.round(xySpeed / 4)) : Math.round(xyMm / 4);
	const width = cutWidthMm(kind, tipDiameterMm, angleDeg, inch ? depth * 25.4 : depth);
	return {
		depth,
		xySpeed,
		plungeSpeed,
		spindleRPM,
		passes: width < NARROW_CUT_MM ? 2 : 1,
		stepover: 0.5
	};
}

/** Width of the cut a bit makes at a depth (mm), as the engine models it. */
export function cutWidthMm(
	kind: IsolationToolKind,
	tipDiameterMm: number,
	angleDeg: number,
	depthMm: number
): number {
	return effectiveToolDiameterMm({
		outputUnits: 'mm',
		isolationDepth: depthMm,
		toolDiameterMm: tipDiameterMm,
		vBitAngleDeg: kind === 'vbit' ? angleDeg : null
	} as GCodeSettings);
}

/** Convert a cut in output units to a tool's stored millimeter values. */
export function cutToMm(
	cut: IsolationToolCut,
	units: Units
): Pick<
	IsolationTool,
	'depthMm' | 'xySpeedMmPerMin' | 'plungeSpeedMmPerMin' | 'spindleRPM' | 'passes' | 'stepover'
> {
	const k = units === 'inch' ? 25.4 : 1;
	return {
		depthMm: cut.depth * k,
		xySpeedMmPerMin: cut.xySpeed * k,
		plungeSpeedMmPerMin: cut.plungeSpeed * k,
		spindleRPM: cut.spindleRPM,
		passes: cut.passes,
		stepover: cut.stepover
	};
}

/** A tool's cut in output units, rounded to what the panel shows. */
export function cutFromTool(tool: IsolationTool, units: Units): IsolationToolCut {
	const inch = units === 'inch';
	const k = inch ? 25.4 : 1;
	return {
		depth: round(tool.depthMm / k, inch ? 4 : 3),
		xySpeed: round(tool.xySpeedMmPerMin / k, 1),
		plungeSpeed: round(tool.plungeSpeedMmPerMin / k, 1),
		spindleRPM: tool.spindleRPM,
		passes: tool.passes,
		stepover: tool.stepover
	};
}

/** Copy a library tool's bit and cut into the settings. */
export function applyIsolationTool(settings: GCodeSettings, tool: IsolationTool): void {
	const cut = cutFromTool(tool, settings.outputUnits);
	settings.isolationToolId = tool.id;
	settings.toolDiameterMm = tool.tipDiameterMm;
	settings.vBitAngleDeg = tool.kind === 'vbit' ? tool.angleDeg : null;
	settings.isolationDepth = cut.depth;
	settings.isolationXYSpeed = cut.xySpeed;
	settings.isolationPlungeSpeed = cut.plungeSpeed;
	settings.isolationSpindleRPM = cut.spindleRPM;
	settings.isolationPasses = cut.passes;
	settings.isolationStepover = cut.stepover;
}

/** Whether the settings still hold exactly what applying the tool would set. */
export function settingsMatchTool(settings: GCodeSettings, tool: IsolationTool): boolean {
	const cut = cutFromTool(tool, settings.outputUnits);
	const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
	return (
		close(settings.toolDiameterMm, tool.tipDiameterMm) &&
		settings.vBitAngleDeg === (tool.kind === 'vbit' ? tool.angleDeg : null) &&
		close(settings.isolationDepth, cut.depth) &&
		close(settings.isolationXYSpeed, cut.xySpeed) &&
		close(settings.isolationPlungeSpeed, cut.plungeSpeed) &&
		settings.isolationSpindleRPM === cut.spindleRPM &&
		settings.isolationPasses === cut.passes &&
		close(settings.isolationStepover, cut.stepover)
	);
}

/** Capture the current settings into an existing tool (keeping its id and name). */
export function toolFromSettings(
	settings: GCodeSettings,
	base: Pick<IsolationTool, 'id' | 'name'>
): IsolationTool {
	return {
		...base,
		kind: settings.vBitAngleDeg === null ? 'endmill' : 'vbit',
		tipDiameterMm: settings.toolDiameterMm,
		angleDeg: settings.vBitAngleDeg ?? 30,
		...cutToMm(
			{
				depth: settings.isolationDepth,
				xySpeed: settings.isolationXYSpeed,
				plungeSpeed: settings.isolationPlungeSpeed,
				spindleRPM: settings.isolationSpindleRPM,
				passes: settings.isolationPasses,
				stepover: settings.isolationStepover
			},
			settings.outputUnits
		)
	};
}

/** A default name such as "30° V-bit, 0.2 mm tip" or "0.2 mm end mill". */
export function defaultToolName(
	kind: IsolationToolKind,
	tipDiameterMm: number,
	angleDeg: number
): string {
	return kind === 'vbit'
		? `${angleDeg}° V-bit, ${tipDiameterMm} mm tip`
		: `${tipDiameterMm} mm end mill`;
}

const DEFAULT_VBIT_ANGLES = [30, 45, 60, 90];
const DEFAULT_TIP_SIZES_MM = [0.1, 0.2, 0.3];

/**
 * The starter library: V-bits at 30/45/60/90° and end mills, each with
 * 0.1/0.2/0.3 mm tips, on their recommended settings. Ids are fixed so a
 * restore can tell which defaults are missing.
 */
export function defaultIsolationTools(units: Units, spindleRPM: number): IsolationTool[] {
	const make = (kind: IsolationToolKind, tip: number, angle: number): IsolationTool => ({
		id: kind === 'vbit' ? `default-vbit-${angle}-${tip}` : `default-endmill-${tip}`,
		name: defaultToolName(kind, tip, angle),
		kind,
		tipDiameterMm: tip,
		angleDeg: angle,
		...cutToMm(recommendIsolationCut(kind, tip, angle, units, spindleRPM), units)
	});
	return [
		...DEFAULT_VBIT_ANGLES.flatMap((angle) =>
			DEFAULT_TIP_SIZES_MM.map((tip) => make('vbit', tip, angle))
		),
		...DEFAULT_TIP_SIZES_MM.map((tip) => make('endmill', tip, 30))
	];
}

/** Add back any default tools missing from the library, keeping the user's own. */
export function restoreDefaultTools(
	tools: IsolationTool[],
	units: Units,
	spindleRPM: number
): IsolationTool[] {
	const have = new Set(tools.map((t) => t.id));
	return [...tools, ...defaultIsolationTools(units, spindleRPM).filter((t) => !have.has(t.id))];
}

function round(value: number, places: number): number {
	const f = 10 ** places;
	return Math.round(value * f) / f;
}
