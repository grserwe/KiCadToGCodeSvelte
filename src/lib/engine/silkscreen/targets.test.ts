import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../parser/parseBoard';
import { defaultSettings } from '../gcode/settings';
import type { BoardModel, Pad } from '../model/types';
import { selectLaserTargets } from './targets';

const sample = readFileSync(
	new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);
const { board } = parseBoard(sample);

function hole(x: number, y: number, diameter: number): Pad {
	return {
		position: { x, y },
		shape: { kind: 'circle', diameter: diameter + 0.6 },
		rotationDeg: 0,
		drill: { diameter },
		layers: 'through',
		isGround: false,
		plated: true,
		source: 'footprint',
		net: 0
	};
}

function boardWith(pads: Pad[]): BoardModel {
	return { width: 30, height: 20, fileVersion: 20241229, tracks: [], pads, graphics: [] };
}

describe('selectLaserTargets', () => {
	it('picks the two drilled holes farthest apart, left-most first', () => {
		const targets = selectLaserTargets(board, defaultSettings());
		expect(targets).toHaveLength(2);
		expect(targets.every((t) => t.source === 'drill' && t.diameterMm === 0.5)).toBe(true);
		const [first, second] = targets;
		expect(first.position.x).toBeCloseTo(3.635, 6);
		expect(second.position.x).toBeCloseTo(18.415, 6);
		// A diagonal of the 2 × 2 hole pattern (14.78 × 1 mm apart).
		expect(Math.abs(first.position.y - second.position.y)).toBeCloseTo(1, 6);
	});

	it('prefers small holes over large ones when there are at least two', () => {
		const targets = selectLaserTargets(
			boardWith([hole(1, 1, 3), hole(29, 19, 3), hole(5, 5, 0.8), hole(20, 10, 0.8)]),
			defaultSettings()
		);
		expect(targets.map((t) => t.diameterMm)).toEqual([0.8, 0.8]);
		expect(targets[0].position).toEqual({ x: 5, y: 5 });
	});

	it('uses large holes when fewer than two small ones exist', () => {
		const targets = selectLaserTargets(
			boardWith([hole(1, 1, 3), hole(29, 19, 3), hole(5, 5, 0.8)]),
			defaultSettings()
		);
		expect(targets.map((t) => t.position)).toEqual([
			{ x: 1, y: 1 },
			{ x: 29, y: 19 }
		]);
	});

	it('falls back to the registration holes, and to nothing when those are off', () => {
		const settings = defaultSettings();
		const fallback = selectLaserTargets(boardWith([hole(5, 5, 1)]), settings);
		expect(fallback.map((t) => t.source)).toEqual(['registration', 'registration']);
		expect(fallback[0].position).toEqual({ x: -5, y: 10 });
		expect(fallback[1].position).toEqual({ x: 35, y: 10 });

		settings.registrationHoles.enabled = false;
		expect(selectLaserTargets(boardWith([hole(5, 5, 1)]), settings)).toEqual([]);
	});
});
