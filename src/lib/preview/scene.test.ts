import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../engine/parser/parseBoard';
import { defaultSettings, type GCodeSettings } from '../engine/gcode/settings';
import { buildScene, drillDiameters, outlineToSvgPath } from './scene';
import { buildPadOutline } from '../engine/geometry/outline';

const sample = readFileSync(
	new URL('../engine/__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);
const { board } = parseBoard(sample);

const settings = (overrides: Partial<GCodeSettings> = {}): GCodeSettings => ({
	...defaultSettings(),
	...overrides
});

describe('buildScene', () => {
	it('builds the top scene with tracks, pads, drills, registration, toolpath', () => {
		const scene = buildScene(board, 'top', settings());
		expect(scene.width).toBeCloseTo(21.59, 4);
		expect(scene.tracks).toHaveLength(1);
		expect(scene.pads).toHaveLength(4); // all through-hole pads show on top
		expect(scene.drills).toHaveLength(4);
		expect(scene.registration).toHaveLength(2);
		expect(scene.toolpath.length).toBeGreaterThan(0);
	});

	it('shows only the bottom track on the bottom side', () => {
		const scene = buildScene(board, 'bottom', settings());
		expect(scene.tracks).toHaveLength(1);
		expect(scene.tracks[0].y1).toBeCloseTo(3.445, 4);
	});

	it('omits registration holes when disabled', () => {
		const scene = buildScene(
			board,
			'top',
			settings({
				registrationHoles: { enabled: false, diameterMm: 3.175, marginMm: 5 }
			})
		);
		expect(scene.registration).toHaveLength(0);
	});

	it('reports distinct drill diameters for the legend', () => {
		const scene = buildScene(board, 'top', settings());
		expect(drillDiameters(scene)).toEqual([0.5]);
	});
});

describe('outlineToSvgPath', () => {
	it('produces a closed path with arcs for an inflated rectangle', () => {
		const edges = buildPadOutline({ kind: 'rect', sizeX: 2, sizeY: 1 }, 0, { x: 5, y: 5 }, 0.3);
		const path = outlineToSvgPath(edges);
		expect(path.startsWith('M ')).toBe(true);
		expect(path.endsWith(' Z')).toBe(true);
		expect(path).toContain(' A 0.3 0.3 ');
	});
});
