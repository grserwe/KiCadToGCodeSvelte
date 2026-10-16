import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../parser/parseBoard';
import { generateGCode, tabCenters } from './emit';
import { ArcEdge, LineEdge, type OutlineEdge } from '../geometry/outline';
import { defaultSettings, effectiveToolDiameterMm, type GCodeSettings } from './settings';
import { validateGCode } from './validator';
import { interpretGCode } from '../../preview/gcode';

const sample = readFileSync(
	new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);
const { board } = parseBoard(sample);
const GENERATED_AT = new Date('2026-07-27T12:00:00Z');

function mmSettings(overrides: Partial<GCodeSettings> = {}): GCodeSettings {
	return {
		...defaultSettings(),
		outputUnits: 'mm',
		isolationDepth: 0.05,
		isolationSafeZ: 2,
		drillDepth: 2.2,
		drillingSafeZ: 2,
		toolDiameterMm: 0.2,
		...overrides
	};
}

describe('generateGCode', () => {
	const result = generateGCode(board, 'Sample', mmSettings(), GENERATED_AT);

	it('emits top and bottom isolation, registration, and one drill file per size', () => {
		const kinds = result.files.map((f) => f.kind);
		expect(kinds).toContain('isolation-top');
		expect(kinds).toContain('isolation-bottom');
		expect(kinds).toContain('registration');
		// All four pads drill 0.5mm → exactly one drill file.
		expect(result.files.filter((f) => f.kind === 'drill')).toHaveLength(1);
		expect(result.files.find((f) => f.kind === 'drill')!.fileName).toBe('Sample-drill-0.5mm.txt');
	});

	it('produces GRBL-safe wrapped programs', () => {
		const gcodeFiles = result.files.filter((f) => !f.kind.startsWith('silkscreen'));
		expect(gcodeFiles.length).toBeGreaterThan(0);
		for (const file of gcodeFiles) {
			expect(file.content).toContain('G21 (Use Millimeters)');
			expect(file.content).toContain('G90 (Set Absolute Coordinates)');
			expect(file.content).toContain('M03 S');
			expect(file.content).toContain('M05 (Stop Spindle)');
			expect(file.content.trimEnd().endsWith('M02 (End Program)')).toBe(true);
		}
	});

	it('passes the machine-safety validator for isolation files', () => {
		for (const kind of ['isolation-top', 'isolation-bottom'] as const) {
			const file = result.files.find((f) => f.kind === kind)!;
			const issues = validateGCode(file.content, {
				cutDepth: 0.05,
				safeZ: 2,
				bounds: { minX: -1, maxX: board.width + 1, minY: -1, maxY: board.height + 1 }
			});
			expect(issues).toEqual([]);
		}
	});

	it('drills all four holes at pad positions, mirrored for bottom drilling', () => {
		const drill = result.files.find((f) => f.kind === 'drill')!;
		const drillMoves = drill.content
			.split('\n')
			.filter((l) => l.startsWith('G00 X') && !l.startsWith('G00 X0.0000 Y0.0000'));
		expect(drillMoves).toHaveLength(4);

		// Drill side is bottom by default → x is mirrored: x' = width − x.
		// J1 pad 1 model position (3.635, 4.445) → (17.955, 4.445).
		expect(drill.content).toContain('X17.9550 Y4.4450');
		expect(drill.content).toContain('X3.1750 Y4.4450'); // J2 pad 1 mirrored
	});

	it('mirrors bottom isolation about the vertical centerline', () => {
		const top = result.files.find((f) => f.kind === 'isolation-top')!;
		const bottom = result.files.find((f) => f.kind === 'isolation-bottom')!;

		// Top track offset lines run at y = 4.445 ± (0.125 + toolRadius 0.1).
		expect(top.content).toContain('Y4.6700');
		// Bottom track (model y=3.445) offset lines at 3.445 ± 0.225; x mirrored.
		expect(bottom.content).toContain('Y3.6700');
		// Pads keep their designed 0.85 size (widening is clearance-blocked at
		// this tool width): rect isolation edge at 18.415 + 0.425 + 0.1 mirrors
		// to 21.59 − 18.94 = 2.65.
		expect(bottom.content).toContain('X2.6500');
		// The offset line clipped onto the circle pad's isolation boundary:
		// model x = 3.635 + sqrt(0.525² − 0.225²) mirrors to 17.4807.
		expect(bottom.content).toContain('X17.4807 Y3.6700');
		// And the blocked widening is reported.
		expect(result.warnings.some((w) => w.code === 'clearance')).toBe(true);
	});

	it('emits registration holes outside the board on the horizontal centerline', () => {
		const registration = result.files.find((f) => f.kind === 'registration')!;
		expect(registration.content).toContain(`X-5.0000 Y${(board.height / 2).toFixed(4)}`);
		expect(registration.content).toContain(
			`X${(board.width + 5).toFixed(4)} Y${(board.height / 2).toFixed(4)}`
		);
	});

	it('emits multiple passes with growing offsets', () => {
		const multi = generateGCode(
			board,
			'Sample',
			mmSettings({ isolationPasses: 2, isolationStepover: 0.5 }),
			GENERATED_AT
		);
		const top = multi.files.find((f) => f.kind === 'isolation-top')!;
		expect(top.content).toContain('( Pass 1: offset 0.100 mm )');
		expect(top.content).toContain('( Pass 2: offset 0.200 mm )');
	});

	it('respects inch output units', () => {
		const inches = generateGCode(
			board,
			'Sample',
			mmSettings({ outputUnits: 'inch', isolationDepth: 0.002, drillDepth: 0.09 }),
			GENERATED_AT
		);
		const top = inches.files.find((f) => f.kind === 'isolation-top')!;
		expect(top.content).toContain('G20 (Use Inches)');
		// Track y 4.67mm → 0.1839".
		expect(top.content).toContain('Y0.1839');
	});

	it('can drill from the top unmirrored', () => {
		const topDrill = generateGCode(board, 'Sample', mmSettings({ drillSide: 'top' }), GENERATED_AT);
		const drill = topDrill.files.find((f) => f.kind === 'drill')!;
		expect(drill.content).toContain('X3.6350 Y4.4450');
	});

	it('honors V-bit effective width', () => {
		const settings = mmSettings({ vBitAngleDeg: 60, isolationDepth: 0.2, toolDiameterMm: 0.1 });
		// width = 2 · 0.2 · tan(30°) ≈ 0.2309.
		expect(effectiveToolDiameterMm(settings)).toBeCloseTo(0.23094, 4);
	});
});

describe('profile cutout', () => {
	const profileSettings = (overrides: Partial<GCodeSettings['profile']> = {}) =>
		mmSettings({
			profile: {
				...defaultSettings().profile,
				toolDiameterMm: 1,
				depth: 1.8,
				depthPerPass: 0.6,
				safeZ: 3,
				xySpeed: 200,
				plungeSpeed: 60,
				tabCount: 4,
				tabWidthMm: 3,
				tabHeightMm: 0.8,
				...overrides
			}
		});
	const result = generateGCode(board, 'Sample', profileSettings(), GENERATED_AT);
	const file = result.files.find((f) => f.kind === 'profile')!;
	const program = interpretGCode(file.content);

	it('emits one mirrored, bottom-up profile program with the cutter recorded', () => {
		expect(file.fileName).toBe('Sample-profile.txt');
		expect(file.toolDiameterMm).toBe(1);
		expect(file.machining).toEqual({ facing: 'bottom', sideMirror: true });
		expect(file.content).toContain('( Tool: 1 mm end mill )');
		expect(file.content).toContain('( Depth: 1.8 mm in 3 passes of 0.6 mm )');
	});

	it('replays cleanly: no rapids with the tool down, consistent arcs, feeds set', () => {
		expect(program.issues).toEqual([]);
		expect(program.stats.minZ).toBeCloseTo(-1.8, 6);
		expect(program.stats.spindleRPM).toBe(10000);
	});

	it('runs the cutter half a diameter outside the board edge', () => {
		// 21.59 × 8.255 board, 1 mm cutter: the centreline box grows by 0.5 mm.
		expect(program.cutBounds!.minX).toBeCloseTo(-0.5, 4);
		expect(program.cutBounds!.maxX).toBeCloseTo(board.width + 0.5, 4);
		expect(program.cutBounds!.minY).toBeCloseTo(-0.5, 4);
		expect(program.cutBounds!.maxY).toBeCloseTo(board.height + 0.5, 4);
		// Rounded corners, not sharp ones: four arcs per pass, never split by a
		// tab (tabs sit on the straight edges).
		expect(program.moves.filter((move) => move.arc).length).toBe(3 * 4);
	});

	it('spreads tabs over the straight edges, clear of the corners', () => {
		const square: OutlineEdge[] = [
			new LineEdge({ x: 0, y: 0 }, { x: 20, y: 0 }),
			new ArcEdge({ x: 20, y: 1 }, 1, 270, 90),
			new LineEdge({ x: 21, y: 1 }, { x: 21, y: 9 }),
			new ArcEdge({ x: 20, y: 9 }, 1, 0, 90),
			new LineEdge({ x: 20, y: 10 }, { x: 0, y: 10 }),
			new ArcEdge({ x: 0, y: 9 }, 1, 90, 90),
			new LineEdge({ x: -1, y: 9 }, { x: -1, y: 1 }),
			new ArcEdge({ x: 0, y: 1 }, 1, 180, 90)
		];
		// Straight length 56, four tabs → every 14 starting at 7: the second
		// and fourth land near the start of the short sides and are nudged in.
		const quarter = Math.PI / 2;
		const expectCenters = (actual: number[], expected: number[]) => {
			expect(actual).toHaveLength(expected.length);
			actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 9));
		};
		expectCenters(tabCenters(square, 4, 3), [
			7,
			20 + quarter + 1.5,
			20 + quarter + 8 + quarter + 7,
			20 + quarter + 8 + quarter + 20 + quarter + 1.5
		]);
		expect(tabCenters(square, 0, 3)).toEqual([]);
		// A round board has no straight edges: tabs spread around the circle.
		const circle: OutlineEdge[] = [
			new ArcEdge({ x: 0, y: 0 }, 10, 0, 180),
			new ArcEdge({ x: 0, y: 0 }, 10, 180, 180)
		];
		expectCenters(tabCenters(circle, 2, 3), [Math.PI * 5, Math.PI * 15]);
	});

	it('lifts over four tabs on the passes below the tab top only', () => {
		// Tab top at −(1.8 − 0.8) = −1.0: passes at −0.6 run straight through,
		// passes at −1.2 and −1.8 lift to −1.0 across each of the four tabs.
		const tabLifts = program.moves.filter(
			(move) => move.kind === 'retract' && Math.abs(move.to.z + 1) < 1e-9
		);
		expect(tabLifts).toHaveLength(8);
		const firstPassCuts = program.moves.filter(
			(move) => move.kind === 'cut' && Math.abs(move.to.z + 0.6) < 1e-9
		);
		expect(firstPassCuts.length).toBeGreaterThan(0);
	});

	it('climb mills: counter-clockwise around the outside in machine coordinates', () => {
		// The bottom side is mirrored, so the loop is reversed to keep the
		// material on the cutter's left: every arc comes out G03.
		expect(program.moves.filter((move) => move.arc).every((move) => !move.arc!.clockwise)).toBe(
			true
		);
		const topCut = generateGCode(board, 'Sample', profileSettings({ side: 'top' }), GENERATED_AT);
		const topProgram = interpretGCode(topCut.files.find((f) => f.kind === 'profile')!.content);
		expect(topProgram.issues).toEqual([]);
		expect(topProgram.moves.filter((move) => move.arc).every((move) => !move.arc!.clockwise)).toBe(
			true
		);
	});

	it('can run without tabs and can be switched off', () => {
		const noTabs = generateGCode(board, 'Sample', profileSettings({ tabCount: 0 }), GENERATED_AT);
		const content = noTabs.files.find((f) => f.kind === 'profile')!.content;
		expect(content).toContain('( Tabs: none');
		expect(interpretGCode(content).stats.plungeCount).toBe(3);

		const off = generateGCode(board, 'Sample', profileSettings({ enabled: false }), GENERATED_AT);
		expect(off.files.some((f) => f.kind === 'profile')).toBe(false);
	});
});
