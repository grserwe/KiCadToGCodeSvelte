import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../parser/parseBoard';
import { generateGCode } from './emit';
import { defaultSettings, effectiveToolDiameterMm, type GCodeSettings } from './settings';
import { validateGCode } from './validator';

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
		for (const file of result.files) {
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
		// The rect pad edge at model x = 18.415 + 0.85 mirrors to 21.59 − 19.265.
		expect(bottom.content).toContain('X2.3250');
		// And the circle pad at model x = 3.635 mirrors to 17.955 (arc around it).
		expect(bottom.content).toContain('X17.1050 Y3.4450');
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
