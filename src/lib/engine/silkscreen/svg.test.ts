import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../parser/parseBoard';
import { defaultSettings, type GCodeSettings } from '../gcode/settings';
import { generateGCode } from '../gcode/emit';
import {
	ALIGNMENT_COLOR,
	SILK_FILL_COLOR,
	SILK_STROKE_COLOR,
	generateSilkscreenFiles
} from './svg';
import { graphicToSvgPath } from './svgPath';

const sample = readFileSync(
	new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);
const { board } = parseBoard(sample);

function settingsWith(overrides: Partial<GCodeSettings> = {}): GCodeSettings {
	return { ...defaultSettings(), ...overrides };
}

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('generateSilkscreenFiles', () => {
	const { files, warnings } = generateSilkscreenFiles(board, 'Sample', settingsWith());
	const svg = files[0]?.content ?? '';

	it('emits one SVG for the top side only, since the sample has no bottom silk', () => {
		expect(files.map((f) => f.kind)).toEqual(['silkscreen-top']);
		expect(files[0].fileName).toBe('Sample-silkscreen-top.svg');
	});

	it('sizes the canvas in millimetres around the board and registration holes', () => {
		// Board 21.59 × 8.255 mm; registration holes 5 mm out, 3.175 mm diameter.
		const width = 21.59 + 2 * (5 + 3.175 / 2);
		expect(svg).toContain(`width="${Math.round(width * 1e5) / 1e5}mm"`);
		expect(svg).toContain('height="8.255mm"');
		expect(svg).toContain(`viewBox="0 0 ${Math.round(width * 1e5) / 1e5} 8.255"`);
		expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
	});

	it('draws the 16 silk lines as black centreline strokes with their widths', () => {
		expect(countOf(svg, `stroke="${SILK_STROKE_COLOR}"`)).toBe(16);
		expect(countOf(svg, 'stroke-width="0.12"')).toBe(16);
		expect(svg).not.toContain(SILK_FILL_COLOR);
	});

	it('adds the outline and both registration holes in the alignment colour', () => {
		// 4 Edge.Cuts lines + 2 holes.
		expect(countOf(svg, `stroke="${ALIGNMENT_COLOR}"`)).toBe(6);
		// Left hole: centre at x = 0 (canvas edge + radius), y = board height / 2.
		expect(svg).toContain('M 3.175 4.1275 A 1.5875 1.5875 0 1 0 0 4.1275');
	});

	it('flips Y so the top-left of the board is at the top of the SVG', () => {
		// J2's silk line at model y = 5.13 lands at 8.255 − 5.13 = 3.125 from the
		// top, shifted right by the registration margin (6.5875).
		expect(svg).toContain('M 24.3075 3.125 L 25.0025 3.125');
	});

	it('warns that reference designators were left out', () => {
		expect(warnings).toHaveLength(1);
		expect(warnings[0].code).toBe('silkscreen-text');
		expect(warnings[0].message).toContain('2 text items on the top silkscreen');
	});

	it('emits nothing when disabled', () => {
		const result = generateSilkscreenFiles(
			board,
			'Sample',
			settingsWith({ silkscreen: { enabled: false } })
		);
		expect(result.files).toEqual([]);
		expect(result.warnings).toEqual([]);
	});

	it('omits the registration holes when they are disabled', () => {
		const result = generateSilkscreenFiles(
			board,
			'Sample',
			settingsWith({
				registrationHoles: { ...defaultSettings().registrationHoles, enabled: false }
			})
		);
		const content = result.files[0].content;
		expect(content).toContain('width="21.59mm"');
		expect(countOf(content, `stroke="${ALIGNMENT_COLOR}"`)).toBe(4);
	});

	it('mirrors the bottom side left-over-right and falls back to the extents outline', () => {
		const mirroredBoard = {
			...board,
			graphics: [
				{
					kind: 'line' as const,
					layer: 'silk-bottom' as const,
					start: { x: 1, y: 1 },
					end: { x: 5, y: 1 },
					width: 0.2
				},
				{
					kind: 'circle' as const,
					layer: 'silk-bottom' as const,
					center: { x: 2, y: 2 },
					radius: 0.5,
					width: 0.1,
					filled: true
				}
			]
		};
		const result = generateSilkscreenFiles(
			mirroredBoard,
			'Sample',
			settingsWith({
				registrationHoles: { ...defaultSettings().registrationHoles, enabled: false }
			})
		);
		expect(result.files.map((f) => f.kind)).toEqual(['silkscreen-bottom']);
		const content = result.files[0].content;
		// x → 21.59 − x; y → 8.255 − y.
		expect(content).toContain('M 20.59 7.255 L 16.59 7.255');
		expect(content).toContain(`fill="${SILK_FILL_COLOR}"`);
		// No Edge.Cuts graphics → the board rectangle is the outline.
		expect(content).toContain('M 21.59 8.255 L 0 8.255 L 0 0 L 21.59 0 Z');
	});

	it('is included in the full generation output', () => {
		const result = generateGCode(board, 'Sample', settingsWith(), new Date());
		expect(result.files.some((f) => f.kind === 'silkscreen-top')).toBe(true);
		expect(result.warnings.some((w) => w.code === 'silkscreen-text')).toBe(true);
	});
});

describe('graphicToSvgPath', () => {
	const flipY = (p: { x: number; y: number }) => ({ x: p.x, y: 10 - p.y });

	it('keeps a CCW arc counterclockwise in a Y-up frame (sweep-flag 1)', () => {
		const d = graphicToSvgPath({
			kind: 'arc',
			layer: 'silk-top',
			center: { x: 0, y: 0 },
			radius: 1,
			startAngle: 0,
			sweep: 90,
			width: 0.1
		});
		expect(d).toBe('M 1 0 A 1 1 0 0 1 0 1');
	});

	it('flips the sweep flag when the frame flips Y, and marks large arcs', () => {
		const d = graphicToSvgPath(
			{
				kind: 'arc',
				layer: 'silk-top',
				center: { x: 0, y: 0 },
				radius: 1,
				startAngle: 0,
				sweep: 270,
				width: 0.1
			},
			flipY
		);
		expect(d).toBe('M 1 10 A 1 1 0 1 0 0 11');
	});

	it('renders circles as two half arcs and polygons closed', () => {
		expect(
			graphicToSvgPath({
				kind: 'circle',
				layer: 'edge',
				center: { x: 2, y: 3 },
				radius: 1,
				width: 0.1,
				filled: false
			})
		).toBe('M 3 3 A 1 1 0 1 0 1 3 A 1 1 0 1 0 3 3 Z');
		expect(
			graphicToSvgPath({
				kind: 'polygon',
				layer: 'edge',
				points: [
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
					{ x: 0, y: 1 }
				],
				width: 0.1,
				filled: false
			})
		).toBe('M 0 0 L 1 0 L 0 1 Z');
	});

	it('has no path for text', () => {
		expect(
			graphicToSvgPath({
				kind: 'text',
				layer: 'silk-top',
				text: 'R1',
				position: { x: 0, y: 0 },
				rotationDeg: 0,
				height: 1,
				thickness: 0.15
			})
		).toBe('');
	});
});
