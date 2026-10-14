import type { BoardModel, EngineWarning, Graphic, GraphicLayer, Vec2 } from '../model/types';
import type { GCodeSettings } from '../gcode/settings';
import type { GCodeFile } from '../gcode/outputFile';
import { graphicToSvgPath } from './svgPath';
import { renderText, strokesToSvgPaths } from './text';
import { selectLaserTargets, type LaserTarget } from './targets';

/**
 * LightBurn assigns imported SVG shapes to its layers by colour; these land
 * on its first palette entries (00 black, 01 blue, 02 red, 03 green) so silk
 * strokes, silk fills, the alignment geometry, and the Print and Cut targets
 * each get their own layer.
 */
export const SILK_STROKE_COLOR = '#000000';
export const SILK_FILL_COLOR = '#0000ff';
export const ALIGNMENT_COLOR = '#ff0000';
export const TARGET_COLOR = '#00e000';

const OUTLINE_STROKE_WIDTH = 0.1;
/** Print and Cut target mark: ring radius, cross arm start/end (mm). */
export const TARGET_RING_RADIUS = 1.25;
export const TARGET_OUTER_RING_RADIUS = 1.75;
export const TARGET_CROSS_INNER = 0.5;
export const TARGET_CROSS_OUTER = 2;

export interface SilkscreenResult {
	files: GCodeFile[];
	warnings: EngineWarning[];
}

/**
 * One SVG per board side that has silkscreen content, sized in millimetres
 * for LightBurn. Silk lines and text are centreline vectors (a laser's spot
 * is about the width of a silk line, so a single pass draws them at the
 * right width). The board outline and the registration holes ride along in a
 * separate colour, and two Print and Cut targets sit on drilled holes so
 * LightBurn can align the burn to the milled board. The bottom side is
 * mirrored left-over-right, matching how the board lies when that face is up.
 */
export function generateSilkscreenFiles(
	board: BoardModel,
	boardName: string,
	settings: GCodeSettings
): SilkscreenResult {
	const files: GCodeFile[] = [];
	const warnings: EngineWarning[] = [];
	if (!settings.silkscreen.enabled) return { files, warnings };

	for (const side of ['top', 'bottom'] as const) {
		const layer: GraphicLayer = side === 'top' ? 'silk-top' : 'silk-bottom';
		const silk = board.graphics.filter((graphic) => graphic.layer === layer);
		if (silk.length === 0) continue;

		const rendered = renderSvg(board, silk, side === 'bottom', settings);
		if (rendered.missingGlyphs > 0) {
			warnings.push({
				code: 'silkscreen-text',
				message: `${rendered.missingGlyphs} character${rendered.missingGlyphs === 1 ? '' : 's'} in the ${side} silkscreen text ${rendered.missingGlyphs === 1 ? 'is' : 'are'} outside the ASCII stroke font and drawn as "?".`
			});
		}

		files.push({
			fileName: `${boardName}-silkscreen-${side}.svg`,
			label:
				side === 'top'
					? 'Top silkscreen (SVG for LightBurn)'
					: 'Bottom silkscreen (SVG for LightBurn, mirrored)',
			kind: side === 'top' ? 'silkscreen-top' : 'silkscreen-bottom',
			content: rendered.content
		});
	}

	return { files, warnings };
}

/** Lines of SVG for one Print and Cut target: a ring (two for the second) and a cross. */
function targetMarkPaths(target: LaserTarget, index: number, map: (point: Vec2) => Vec2): string[] {
	const c = target.position;
	const rings = index === 0 ? [TARGET_RING_RADIUS] : [TARGET_RING_RADIUS, TARGET_OUTER_RING_RADIUS];
	const paths = rings.map((radius) =>
		graphicToSvgPath(
			{ kind: 'circle', layer: 'edge', center: c, radius, width: 0, filled: false },
			map
		)
	);
	for (const [dx, dy] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1]
	]) {
		paths.push(
			graphicToSvgPath(
				{
					kind: 'line',
					layer: 'edge',
					start: { x: c.x + dx * TARGET_CROSS_INNER, y: c.y + dy * TARGET_CROSS_INNER },
					end: { x: c.x + dx * TARGET_CROSS_OUTER, y: c.y + dy * TARGET_CROSS_OUTER },
					width: 0
				},
				map
			)
		);
	}
	return paths.map(
		(d) =>
			`<path d="${d}" fill="none" stroke="${TARGET_COLOR}" stroke-width="${OUTLINE_STROKE_WIDTH}"/>`
	);
}

function renderSvg(
	board: BoardModel,
	silk: Graphic[],
	mirrored: boolean,
	settings: GCodeSettings
): { content: string; missingGlyphs: number } {
	let missingGlyphs = 0;
	const registration = settings.registrationHoles.enabled ? settings.registrationHoles : null;
	const holeRadius = registration ? registration.diameterMm / 2 : 0;
	// Canvas: the board, plus the registration holes when they are enabled.
	const minX = registration ? -registration.marginMm - holeRadius : 0;
	const maxX = registration ? board.width + registration.marginMm + holeRadius : board.width;
	const width = maxX - minX;
	const height = board.height;

	// Model (Y-up, origin lower-left) → SVG (Y-down), optionally mirrored
	// about the board's vertical centreline.
	const map = (point: Vec2): Vec2 => ({
		x: (mirrored ? board.width - point.x : point.x) - minX,
		y: board.height - point.y
	});

	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}mm" height="${num(height)}mm" viewBox="0 0 ${num(width)} ${num(height)}">`,
		`  <title>${escapeXml(`${mirrored ? 'Bottom' : 'Top'} silkscreen`)}</title>`,
		'  <!-- Generated by KiCadToGCode. Units: millimetres. -->',
		'  <!-- Black: silkscreen lines and text (cut as Line). Blue: filled silkscreen shapes (cut as Fill). -->',
		'  <!-- Red: board outline and registration holes, for reference only (set the layer to no output). -->',
		'  <!-- Green: Print and Cut targets on two drilled holes — target 1 has one ring, target 2 two rings. -->',
		'  <!-- In LightBurn: Laser Tools > Print and Cut > select target 1, jog the laser to its hole, Set First Target Position; -->',
		'  <!-- repeat for target 2 with Set Second Target Position; then enable Align Output to Targets and set the green layer to no output. -->'
	];

	lines.push('  <g id="silkscreen">');
	for (const graphic of silk) {
		if (graphic.kind === 'text') {
			const { strokes, missingGlyphs: missing } = renderText(graphic);
			missingGlyphs += missing;
			for (const d of strokesToSvgPaths(strokes, map)) {
				lines.push(
					`    <path d="${d}" fill="none" stroke="${SILK_STROKE_COLOR}" stroke-width="${num(graphic.thickness)}" stroke-linecap="round" stroke-linejoin="round"/>`
				);
			}
			continue;
		}
		const d = graphicToSvgPath(graphic, map);
		if (!d) continue;
		const filled = (graphic.kind === 'circle' || graphic.kind === 'polygon') && graphic.filled;
		if (filled) {
			lines.push(`    <path d="${d}" fill="${SILK_FILL_COLOR}" stroke="none"/>`);
		} else {
			lines.push(
				`    <path d="${d}" fill="none" stroke="${SILK_STROKE_COLOR}" stroke-width="${num(graphic.width)}" stroke-linecap="round" stroke-linejoin="round"/>`
			);
		}
	}
	lines.push('  </g>');

	lines.push('  <g id="outline">');
	const edges = board.graphics.filter((graphic) => graphic.layer === 'edge');
	if (edges.length > 0) {
		for (const edge of edges) {
			const d = graphicToSvgPath(edge, map);
			if (d) lines.push(`    ${alignmentPath(d)}`);
		}
	} else {
		// No Edge.Cuts in the file: the board extents are the outline.
		const corners: Vec2[] = [
			{ x: 0, y: 0 },
			{ x: board.width, y: 0 },
			{ x: board.width, y: board.height },
			{ x: 0, y: board.height }
		];
		const d = graphicToSvgPath(
			{
				kind: 'polygon',
				layer: 'edge',
				points: corners,
				width: OUTLINE_STROKE_WIDTH,
				filled: false
			},
			map
		);
		lines.push(`    ${alignmentPath(d)}`);
	}
	lines.push('  </g>');

	if (registration) {
		lines.push('  <g id="registration">');
		for (const hole of [
			{ x: -registration.marginMm, y: board.height / 2 },
			{ x: board.width + registration.marginMm, y: board.height / 2 }
		]) {
			const d = graphicToSvgPath(
				{
					kind: 'circle',
					layer: 'edge',
					center: hole,
					radius: holeRadius,
					width: 0,
					filled: false
				},
				map
			);
			lines.push(`    ${alignmentPath(d)}`);
		}
		lines.push('  </g>');
	}

	const targets = selectLaserTargets(board, settings);
	targets.forEach((target, index) => {
		lines.push(`  <g id="target-${index + 1}">`);
		for (const path of targetMarkPaths(target, index, map)) lines.push(`    ${path}`);
		lines.push('  </g>');
	});

	lines.push('</svg>');
	return { content: lines.join('\n') + '\n', missingGlyphs };
}

function alignmentPath(d: string): string {
	return `<path d="${d}" fill="none" stroke="${ALIGNMENT_COLOR}" stroke-width="${OUTLINE_STROKE_WIDTH}"/>`;
}

const num = (value: number): string => String(Math.round(value * 1e5) / 1e5);

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
