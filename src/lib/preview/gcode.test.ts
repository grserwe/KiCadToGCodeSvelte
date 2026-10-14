import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../engine/parser/parseBoard';
import { generateGCode } from '../engine/gcode/emit';
import { defaultSettings, type GCodeSettings } from '../engine/gcode/settings';
import { interpretGCode } from './gcode';

const sample = readFileSync(
	new URL('../engine/__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);
const { board } = parseBoard(sample);

const mmSettings = (overrides: Partial<GCodeSettings> = {}): GCodeSettings => ({
	...defaultSettings(),
	outputUnits: 'mm',
	isolationDepth: 0.05,
	isolationSafeZ: 2,
	drillDepth: 2.2,
	drillingSafeZ: 2,
	toolDiameterMm: 0.2,
	...overrides
});

const lines = (...program: string[]) => program.join('\n');

describe('interpretGCode on generated programs', () => {
	const result = generateGCode(board, 'Sample', mmSettings(), new Date('2026-07-27T12:00:00Z'));
	const gcodeFiles = result.files.filter((file) => !file.kind.startsWith('silkscreen'));

	it('replays every emitted program without finding problems', () => {
		expect(gcodeFiles.length).toBeGreaterThan(0);
		for (const file of gcodeFiles) {
			const program = interpretGCode(file.content);
			expect(program.issues, file.fileName).toEqual([]);
			expect(program.units).toBe('mm');
			expect(program.stats.spindleRPM).toBe(10000);
			expect(file.machining).toBeDefined();
		}
	});

	it('finds cuts, arcs and plunges in the isolation file within the board', () => {
		const file = result.files.find((f) => f.kind === 'isolation-top')!;
		const program = interpretGCode(file.content);
		const kinds = new Set(program.moves.map((move) => move.kind));
		expect(kinds.has('cut')).toBe(true);
		expect(kinds.has('rapid')).toBe(true);
		expect(kinds.has('plunge')).toBe(true);
		expect(program.moves.some((move) => move.arc !== null)).toBe(true);
		expect(program.stats.cutLength).toBeGreaterThan(0);
		expect(program.stats.minZ).toBeCloseTo(-0.05, 6);
		expect(program.stats.maxZ).toBeCloseTo(2, 6);
		expect(program.stats.feedMinutes).toBeGreaterThan(0);

		const cuts = program.cutBounds!;
		expect(cuts.minX).toBeGreaterThan(-1);
		expect(cuts.maxX).toBeLessThan(board.width + 1);
		expect(cuts.minY).toBeGreaterThan(-1);
		expect(cuts.maxY).toBeLessThan(board.height + 1);
	});

	it('sees one plunge per hole in the drill file at the emitted positions', () => {
		const file = result.files.find((f) => f.kind === 'drill')!;
		const program = interpretGCode(file.content);
		const plunges = program.moves.filter((move) => move.kind === 'plunge');
		expect(plunges).toHaveLength(4);
		expect(plunges.map((p) => p.to.z)).toEqual([-2.2, -2.2, -2.2, -2.2]);
		expect(
			plunges.some((p) => Math.abs(p.to.x - 17.955) < 1e-6 && Math.abs(p.to.y - 4.445) < 1e-6)
		).toBe(true);
		expect(program.stats.plungeCount).toBe(4);
		expect(program.stats.cutLength).toBe(0);
	});

	it('handles inch output and mirrored arcs', () => {
		const inch = generateGCode(board, 'Sample', defaultSettings(), new Date());
		const bottom = inch.files.find((f) => f.kind === 'isolation-bottom')!;
		const program = interpretGCode(bottom.content);
		expect(program.issues).toEqual([]);
		expect(program.units).toBe('inch');
		// Mirrored output flips arc handedness to G03.
		expect(program.moves.some((move) => move.code === 'G03')).toBe(true);
		expect(program.cutBounds!.maxX).toBeLessThan(board.width / 25.4 + 0.05);
	});
});

describe('interpretGCode basics', () => {
	it('tracks modal motion, relative moves and comments', () => {
		const program = interpretGCode(
			lines(
				'G21 G90 (mm)',
				'M03 S8000',
				'G00 Z2',
				'G00 X1 Y1 ; park',
				'G01 Z-0.1 F100',
				'X3',
				'Y3',
				'G91',
				'G01 X-1',
				'M05',
				'M02'
			)
		);
		expect(program.issues).toEqual([]);
		const cuts = program.moves.filter((move) => move.kind === 'cut');
		expect(cuts.map((move) => [move.to.x, move.to.y])).toEqual([
			[3, 1],
			[3, 3],
			[2, 3]
		]);
		expect(program.stats.cutLength).toBeCloseTo(5, 9);
		// Plunge from Z2 to Z-0.1 (2.1) plus 5 of XY cutting, all at F100.
		expect(program.stats.feedMinutes).toBeCloseTo((2.1 + 5) / 100, 9);
	});

	it('draws arcs with the right sweep and bounds', () => {
		const ok = interpretGCode(
			lines('G21 G90', 'M03 S1', 'G00 X1 Y0', 'G01 Z-0.1 F50', 'G03 X0 Y1 I-1 J0', 'M05', 'M02')
		);
		expect(ok.issues).toEqual([]);
		const arc = ok.moves.find((move) => move.arc)!;
		expect(arc.arc!.sweepDeg).toBeCloseTo(90, 6);
		expect(arc.arc!.clockwise).toBe(false);
		expect(arc.lengthXY).toBeCloseTo(Math.PI / 2, 6);
		// A CCW quarter from (1,0) to (0,1) never leaves the unit square.
		expect(ok.cutBounds).toEqual({ minX: 0, maxX: 1, minY: 0, maxY: 1 });
		// Clockwise after the viewer's Y flip is SVG sweep-flag 0; CCW is 1.
		expect(arc.d).toBe('M 1 0 A 1 1 0 0 1 0 1');

		const full = interpretGCode(
			lines('G21 G90', 'M03 S1', 'G00 X1 Y0', 'G01 Z-0.1 F50', 'G02 X1 Y0 I-1 J0', 'M05', 'M02')
		);
		const circle = full.moves.find((move) => move.arc)!;
		expect(circle.arc!.sweepDeg).toBe(360);
		expect(circle.lengthXY).toBeCloseTo(2 * Math.PI, 6);
		expect(full.cutBounds).toEqual({ minX: -1, maxX: 1, minY: -1, maxY: 1 });
	});

	it('flags arcs whose start and end radii disagree', () => {
		const bad = interpretGCode(
			lines('G21 G90', 'M03 S1', 'G00 X1 Y0', 'G01 Z-0.1 F50', 'G02 X0 Y2 I-1 J0', 'M05', 'M02')
		);
		expect(bad.issues.map((issue) => issue.message)).toEqual([
			expect.stringContaining('Arc radii disagree')
		]);
	});

	it('reports machine-safety problems', () => {
		const program = interpretGCode(
			lines('G21 G90', 'G01 Z-0.1', 'G00 X5 Y5', 'G01 X6', 'G00 Z1', 'M05')
		);
		const messages = program.issues.map((issue) => issue.message);
		expect(messages).toContain('Feed move before any feed rate (F) was set — GRBL rejects this');
		expect(messages).toContain('Rapid XY move while the tool is at or below the surface');
		expect(messages).toContain('Cutting with the spindle off');
		expect(messages).toContain('Program has no M02/M30 end');
		expect(messages).toContain('No spindle speed (S) was set');
	});

	it('flags unknown commands and anything after the program end', () => {
		const program = interpretGCode(lines('G21', 'G28', 'M02', 'G00 X1'));
		const messages = program.issues.map((issue) => issue.message);
		expect(messages).toContain('G28 is not understood by this viewer (or by GRBL)');
		expect(messages.some((m) => m.startsWith('Command after the program ended'))).toBe(true);
	});
});
