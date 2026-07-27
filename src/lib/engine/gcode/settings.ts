import type { Units } from '../model/units';

export type XYZeroPosition = 'lower-left' | 'upper-left' | 'upper-right' | 'lower-right' | 'center';

/**
 * All engraving/drilling settings. Z depths, safe heights, and feed rates are
 * in the OUTPUT units (matching the original app); lengths marked "Mm" are
 * always millimeters.
 */
export interface GCodeSettings {
	outputUnits: Units;
	xyZeroPosition: XYZeroPosition;
	flipX: boolean;
	flipY: boolean;

	/** Engraving tool tip diameter in mm (0 = cut on the copper edge). */
	toolDiameterMm: number;
	/** V-bit tip angle in degrees; null for straight (end-mill style) bits. */
	vBitAngleDeg: number | null;
	/** Number of isolation passes; passes beyond the first step outward. */
	isolationPasses: number;
	/** Stepover between passes as a fraction of the tool diameter (0–1). */
	isolationStepover: number;

	isolationDepth: number;
	isolationSafeZ: number;
	isolationXYSpeed: number;
	isolationPlungeSpeed: number;
	isolationSpindleRPM: number;

	drillDepth: number;
	drillingSafeZ: number;
	drillingPlungeSpeed: number;
	drillingRetractSpeed: number;
	drillingSpindleRPM: number;

	xyRapidSpeed: number;
	useMachineRapids: boolean;

	minimumTrackWidthMm: number;
	minimumViaSizeMm: number;

	/** Mirror the bottom side for flip-over machining (x → width − x). */
	mirrorBottom: boolean;
	/** Which side the board faces up when drilling. */
	drillSide: 'top' | 'bottom';
	registrationHoles: {
		enabled: boolean;
		diameterMm: number;
		/** Distance outside the left/right board edges, in mm. */
		marginMm: number;
	};

	fileExtension: string;
}

/** Defaults carried over from the original app's GCodeSettings.cs. */
export function defaultSettings(): GCodeSettings {
	return {
		outputUnits: 'inch',
		xyZeroPosition: 'lower-left',
		flipX: false,
		flipY: false,

		toolDiameterMm: 0.1,
		vBitAngleDeg: null,
		isolationPasses: 1,
		isolationStepover: 0.5,

		isolationDepth: 0.02,
		isolationSafeZ: 0.25,
		isolationXYSpeed: 20,
		isolationPlungeSpeed: 10,
		isolationSpindleRPM: 10000,

		drillDepth: 0.125,
		drillingSafeZ: 0.25,
		drillingPlungeSpeed: 10,
		drillingRetractSpeed: 30,
		drillingSpindleRPM: 10000,

		xyRapidSpeed: 60,
		useMachineRapids: true,

		minimumTrackWidthMm: 0.1,
		minimumViaSizeMm: 1.5,

		mirrorBottom: true,
		drillSide: 'bottom',
		registrationHoles: {
			enabled: true,
			diameterMm: 3.175,
			marginMm: 5
		},

		fileExtension: '.txt'
	};
}

/**
 * The tool's effective cutting diameter at the configured isolation depth.
 * A V-bit cuts a cone: width = 2 · depth · tan(angle / 2), never less than
 * the tip diameter.
 */
export function effectiveToolDiameterMm(settings: GCodeSettings): number {
	const depthMm =
		settings.outputUnits === 'inch' ? settings.isolationDepth * 25.4 : settings.isolationDepth;
	if (settings.vBitAngleDeg === null) {
		return settings.toolDiameterMm;
	}
	const coneWidth = 2 * depthMm * Math.tan(((settings.vBitAngleDeg / 2) * Math.PI) / 180);
	return Math.max(settings.toolDiameterMm, coneWidth);
}
