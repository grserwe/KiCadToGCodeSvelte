import { describe, expect, it } from 'vitest';
import type { BoardModel, Pad, Pour, PourConnection, Track } from '../model/types';
import { buildLayerToolpath, type ToolpathOptions } from './assemble';
import { arcSweep, type PathSegment } from './segments';
import { selectLayerPour } from './pour';
import { generateGCode } from '../gcode/emit';
import { defaultSettings } from '../gcode/settings';

const SIG = 1;
const GND = 2;

const OPTIONS: ToolpathOptions = {
	isolationOffset: 0,
	minimumTrackWidth: 0,
	minimumPadDiameter: 0
};

function pour(net: number, overrides: Partial<Pour> = {}): Pour {
	return {
		layer: 'top',
		net,
		netName: net === GND ? 'GND' : `N${net}`,
		clearance: 0.5,
		connection: 'thermal',
		outline: [
			{ x: 0, y: 0 },
			{ x: 30, y: 0 },
			{ x: 30, y: 30 },
			{ x: 0, y: 30 }
		],
		fills: [],
		...overrides
	};
}

function board(tracks: Track[], pads: Pad[], pours: Pour[]): BoardModel {
	return { width: 30, height: 30, fileVersion: 20241229, tracks, pads, pours, graphics: [] };
}

function track(x1: number, y1: number, x2: number, y2: number, net: number, width = 0.5): Track {
	return { start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, width, layer: 'top', net };
}

function circlePad(x: number, y: number, net: number, overrides: Partial<Pad> = {}): Pad {
	return {
		position: { x, y },
		shape: { kind: 'circle', diameter: 2 },
		rotationDeg: 0,
		drill: { diameter: 0.8 },
		layers: 'through',
		isGround: false,
		plated: true,
		source: 'footprint',
		net,
		...overrides
	};
}

const arcsAround = (segments: PathSegment[], x: number, y: number) =>
	segments.filter(
		(segment) => segment.kind === 'arc' && segment.center.x === x && segment.center.y === y
	);
const totalSweep = (segments: PathSegment[]) =>
	segments.reduce((sum, segment) => sum + (segment.kind === 'arc' ? arcSweep(segment) : 0), 0);

/** Half the angle a 0.5 mm track covers where it enters a 1 mm-radius pad. */
const TRACK_HALF_ANGLE = (Math.asin(0.25) * 180) / Math.PI;

describe('copper pours in the isolation toolpath', () => {
	it('cuts nothing along a pour-net track, but still isolates other nets', () => {
		const { segments } = buildLayerToolpath(
			board([track(5, 5, 25, 5, GND), track(5, 20, 25, 20, SIG)], [], [pour(GND)]),
			'top',
			OPTIONS
		);
		expect(segments).toHaveLength(2);
		for (const segment of segments) {
			expect(segment.kind === 'line' && Math.abs(segment.start.y - 20)).toBeCloseTo(0.25, 6);
		}
	});

	it('isolates the pour net as usual on a layer without a pour', () => {
		const { segments } = buildLayerToolpath(
			board([track(5, 5, 25, 5, GND)], [], [pour(GND, { layer: 'bottom' })]),
			'top',
			OPTIONS
		);
		expect(segments).toHaveLength(2);
	});

	it('gives pour pads thermal spokes plus a gap where their track enters', () => {
		const { segments } = buildLayerToolpath(
			board([track(10, 10, 20, 20, GND)], [circlePad(10, 10, GND)], [pour(GND)]),
			'top',
			OPTIONS
		);
		// Spokes at 0/90/180/270° leave four 45° arcs; the track at 45°
		// splits the first one into two pieces.
		const arcs = arcsAround(segments, 10, 10);
		expect(arcs).toHaveLength(5);
		expect(totalSweep(arcs)).toBeCloseTo(180 - 2 * TRACK_HALF_ANGLE, 3);
		expect(segments).toHaveLength(5);
	});

	it('cuts nothing round pads joined solidly, and always joins vias solidly', () => {
		const pads = [
			circlePad(10, 10, GND, { zoneConnection: 'solid' }),
			circlePad(20, 10, GND, { source: 'via' })
		];
		const { segments } = buildLayerToolpath(board([], pads, [pour(GND)]), 'top', OPTIONS);
		expect(segments).toEqual([]);
	});

	it('takes the zone’s connection unless the pad overrides it', () => {
		const sweepFor = (zone: PourConnection, pad?: PourConnection) =>
			totalSweep(
				buildLayerToolpath(
					board(
						[],
						[circlePad(10, 10, GND, { zoneConnection: pad })],
						[pour(GND, { connection: zone })]
					),
					'top',
					OPTIONS
				).segments
			);
		expect(sweepFor('thermal')).toBeCloseTo(180, 6);
		expect(sweepFor('solid')).toBe(0);
		expect(sweepFor('none')).toBe(360);
		expect(sweepFor('solid', 'thermal')).toBeCloseTo(180, 6);
		expect(sweepFor('thermal', 'none')).toBe(360);
	});

	it('gives thermal-thru-hole zones spokes on through-hole pads and solid surface pads', () => {
		const { segments } = buildLayerToolpath(
			board(
				[],
				[circlePad(10, 10, GND), circlePad(20, 10, GND, { layers: 'top', drill: null })],
				[pour(GND, { connection: 'thermal-thru-hole' })]
			),
			'top',
			OPTIONS
		);
		expect(arcsAround(segments, 10, 10)).toHaveLength(4);
		expect(arcsAround(segments, 20, 10)).toHaveLength(0);
	});

	it('rings an unconnected pour pad except where its own track enters', () => {
		const { segments } = buildLayerToolpath(
			board(
				[track(10, 10, 20, 10, GND)],
				[circlePad(10, 10, GND, { zoneConnection: 'none' })],
				[pour(GND)]
			),
			'top',
			OPTIONS
		);
		expect(segments).toHaveLength(1);
		expect(totalSweep(segments)).toBeCloseTo(360 - 2 * TRACK_HALF_ANGLE, 3);
	});

	it('never joins a pad on another net to the pour, even a ground-named one', () => {
		const pads = [circlePad(10, 10, 3, { isGround: true })];
		const withPour = buildLayerToolpath(board([], pads, [pour(GND)]), 'top', OPTIONS);
		expect(totalSweep(withPour.segments)).toBe(360);

		// Without a pour the legacy thermal relief for ground-named pads stays.
		const withoutPour = buildLayerToolpath(board([], pads, []), 'top', OPTIONS);
		expect(arcsAround(withoutPour.segments, 10, 10)).toHaveLength(4);
	});

	it('does not open another net’s pad where a pour track passes close by', () => {
		// The GND track's lower edge comes within 0.1 mm of the SIG pad's
		// isolation circle: it must not leave a gap in that pad's ring.
		const { segments } = buildLayerToolpath(
			board([track(5, 11.3, 25, 11.3, GND, 0.4)], [circlePad(10, 10, SIG)], [pour(GND)]),
			'top',
			{ ...OPTIONS, isolationOffset: 0.2 }
		);
		expect(segments).toHaveLength(1);
		expect(totalSweep(segments)).toBe(360);
	});

	it('keeps the largest net’s pour when zones on several nets share a layer', () => {
		const small = pour(3, {
			netName: '+5V',
			outline: [
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 5, y: 5 }
			]
		});
		const model = board([track(5, 5, 25, 5, GND), track(5, 20, 25, 20, 3)], [], [small, pour(GND)]);

		const selected = selectLayerPour(model, 'top')!;
		expect(selected.net).toBe(GND);
		expect(selected.ignored).toEqual([small]);

		const { segments, warnings } = buildLayerToolpath(model, 'top', OPTIONS);
		expect(segments).toHaveLength(2); // only the +5V track is isolated
		expect(warnings).toHaveLength(1);
		expect(warnings[0].message).toContain('+5V');
	});
});

describe('copper pours in the G-code', () => {
	const model = board([track(5, 5, 25, 5, GND)], [], [pour(GND, { clearance: 0.3 })]);

	it('notes the pour in the isolation header', () => {
		const { files } = generateGCode(model, 'pour', defaultSettings(), new Date(0));
		const top = files.find((file) => file.kind === 'isolation-top')!;
		expect(top.content).toContain('( Copper pour: GND - left uncut, all uncut copper is GND )');
		const bottom = files.find((file) => file.kind === 'isolation-bottom')!;
		expect(bottom.content).not.toContain('Copper pour');
	});

	it('warns when the isolation cut is wider than the pour clearance', () => {
		const settings = defaultSettings();
		expect(
			generateGCode(model, 'pour', settings, new Date(0)).warnings.some(
				(warning) => warning.code === 'pour-clearance'
			)
		).toBe(false);

		// 0.2 mm bit, three passes at 50 % stepover: a 0.4 mm-wide cut.
		const wide = { ...settings, toolDiameterMm: 0.2, isolationPasses: 3, isolationStepover: 0.5 };
		const warnings = generateGCode(model, 'pour', wide, new Date(0)).warnings.filter(
			(warning) => warning.code === 'pour-clearance'
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].message).toContain('0.40 mm wide');
	});
});
