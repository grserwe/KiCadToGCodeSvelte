import type { BoardModel, LayerId } from '../engine/model/types';
import { buildPadOutline, type OutlineEdge } from '../engine/geometry/outline';
import { buildLayerToolpath } from '../engine/toolpath/assemble';
import { effectiveToolDiameterMm, type GCodeSettings } from '../engine/gcode/settings';
import { segmentToSvgPath } from './svgPath';
import { graphicToSvgPath } from '../engine/silkscreen/svgPath';
import { renderText, strokesToSvgPaths } from '../engine/silkscreen/text';
import { selectLaserTargets } from '../engine/silkscreen/targets';

export interface SceneTrack {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	width: number;
}

export interface ScenePad {
	/** SVG path for outline shapes, or null when the pad is a plain circle. */
	path: string | null;
	circle: { cx: number; cy: number; r: number } | null;
}

export interface SceneGraphic {
	/** SVG path in model space (Y-up mm). */
	d: string;
	width: number;
	filled: boolean;
}

/** A Print and Cut target: index 0 draws one ring, index 1 two. */
export interface SceneTarget {
	cx: number;
	cy: number;
	index: number;
}

export interface SceneDrill {
	cx: number;
	cy: number;
	r: number;
	diameterMm: number;
}

/** Everything needed to render one side of the board, in model space (Y-up mm). */
export interface BoardScene {
	width: number;
	height: number;
	tracks: SceneTrack[];
	pads: ScenePad[];
	drills: SceneDrill[];
	registration: SceneDrill[];
	/** Isolation toolpath (first pass) as SVG path strings. */
	toolpath: string[];
	/** Silkscreen drawings for this side (text is not rendered yet). */
	silkscreen: SceneGraphic[];
	/** Edge.Cuts board outline, when the file has one. */
	outline: string[];
	/** Laser alignment targets (when the silkscreen SVG is enabled). */
	laserTargets: SceneTarget[];
}

/** Build the renderable scene for one side directly from the geometry model. */
export function buildScene(board: BoardModel, layer: LayerId, settings: GCodeSettings): BoardScene {
	// The board arrives with minimum widths already applied (clearance-capped
	// by the widening pass), so widths and sizes are used as-is.
	const tracks: SceneTrack[] = board.tracks
		.filter((track) => track.layer === layer)
		.map((track) => ({
			x1: track.start.x,
			y1: track.start.y,
			x2: track.end.x,
			y2: track.end.y,
			width: track.width
		}));

	const pads: ScenePad[] = board.pads
		.filter((pad) => pad.plated && (pad.layers === layer || pad.layers === 'through'))
		.map((pad) => {
			if (pad.shape.kind === 'circle') {
				return {
					path: null,
					circle: {
						cx: pad.position.x,
						cy: pad.position.y,
						r: pad.shape.diameter / 2
					}
				};
			}
			const edges = buildPadOutline(pad.shape, pad.rotationDeg, pad.position, 0);
			return { path: outlineToSvgPath(edges), circle: null };
		});

	const drills: SceneDrill[] = board.pads
		.filter((pad) => pad.drill && pad.drill.diameter > 0 && pad.layers === 'through')
		.map((pad) => ({
			cx: pad.position.x,
			cy: pad.position.y,
			r: pad.drill!.diameter / 2,
			diameterMm: pad.drill!.diameter
		}));

	const registration: SceneDrill[] = settings.registrationHoles.enabled
		? [
				{ x: -settings.registrationHoles.marginMm, y: board.height / 2 },
				{ x: board.width + settings.registrationHoles.marginMm, y: board.height / 2 }
			].map((position) => ({
				cx: position.x,
				cy: position.y,
				r: settings.registrationHoles.diameterMm / 2,
				diameterMm: settings.registrationHoles.diameterMm
			}))
		: [];

	const toolpath = buildLayerToolpath(board, layer, {
		isolationOffset: effectiveToolDiameterMm(settings) / 2,
		minimumTrackWidth: 0,
		minimumPadDiameter: 0
	}).segments.map(segmentToSvgPath);

	const silkLayer = layer === 'top' ? 'silk-top' : 'silk-bottom';
	const silkscreen: SceneGraphic[] = [];
	for (const graphic of board.graphics) {
		if (graphic.layer !== silkLayer) continue;
		if (graphic.kind === 'text') {
			for (const d of strokesToSvgPaths(renderText(graphic).strokes, (p) => p)) {
				silkscreen.push({ d, width: graphic.thickness, filled: false });
			}
			continue;
		}
		const d = graphicToSvgPath(graphic);
		if (!d) continue;
		silkscreen.push({
			d,
			width: graphic.width,
			filled: (graphic.kind === 'circle' || graphic.kind === 'polygon') && graphic.filled
		});
	}

	const laserTargets: SceneTarget[] = settings.silkscreen.enabled
		? selectLaserTargets(board, settings).map((target, index) => ({
				cx: target.position.x,
				cy: target.position.y,
				index
			}))
		: [];

	const outline = board.graphics
		.filter((graphic) => graphic.layer === 'edge')
		.map((graphic) => graphicToSvgPath(graphic))
		.filter((d) => d !== '');

	return {
		width: board.width,
		height: board.height,
		tracks,
		pads,
		drills,
		registration,
		toolpath,
		silkscreen,
		outline,
		laserTargets
	};
}

/** A closed pad outline as a single SVG path (Y-up model coordinates). */
export function outlineToSvgPath(edges: OutlineEdge[]): string {
	if (edges.length === 0) return '';
	const round = (value: number) => Math.round(value * 1e5) / 1e5;
	let d = `M ${round(edges[0].start.x)} ${round(edges[0].start.y)}`;

	for (const edge of edges) {
		if (edge.kind === 'line') {
			d += ` L ${round(edge.end.x)} ${round(edge.end.y)}`;
		} else {
			const largeArc = Math.abs(edge.sweep) > 180 ? 1 : 0;
			// SVG sweep-flag 1 follows the positive-angle (CCW in Y-up) direction.
			const sweepFlag = edge.sweep >= 0 ? 1 : 0;
			d += ` A ${round(edge.radius)} ${round(edge.radius)} 0 ${largeArc} ${sweepFlag} ${round(edge.end.x)} ${round(edge.end.y)}`;
		}
	}
	return d + ' Z';
}

/** Distinct drill diameters, for the legend's color keying. */
export function drillDiameters(scene: BoardScene): number[] {
	return [...new Set(scene.drills.map((drill) => drill.diameterMm))].sort((a, b) => a - b);
}
