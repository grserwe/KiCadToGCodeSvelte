import type { SExpr } from '../sexpr/types';
import type { EngineWarning, LayerId, Vec2 } from '../model/types';
import { findAllRecursive, findChild, numberAttr } from './sexprHelpers';

/** A track still in KiCad file coordinates (Y-down, absolute mm). */
export interface RawTrack {
	start: Vec2;
	end: Vec2;
	width: number;
	layer: LayerId;
}

function copperLayer(layerName: string | undefined): LayerId | 'inner' | 'none' {
	if (!layerName) return 'none';
	const upper = layerName.toUpperCase();
	if (upper.includes('F.CU')) return 'top';
	if (upper.includes('B.CU')) return 'bottom';
	if (/\bIN\d+\.CU/i.test(layerName)) return 'inner';
	return 'none';
}

export function extractTracks(root: SExpr, warnings: EngineWarning[]): RawTrack[] {
	const tracks: RawTrack[] = [];

	for (const segment of findAllRecursive(root, 'segment')) {
		const layerName = findChild(segment, 'layer')?.attributes[0];
		const layer = copperLayer(layerName);
		if (layer === 'inner') {
			warnings.push({
				code: 'inner-layer-track',
				message: `A track on inner layer "${layerName}" was skipped — only two-layer boards are supported.`
			});
			continue;
		}
		if (layer === 'none') {
			continue;
		}

		const start = findChild(segment, 'start');
		const end = findChild(segment, 'end');
		const startX = numberAttr(start, 0);
		const startY = numberAttr(start, 1);
		const endX = numberAttr(end, 0);
		const endY = numberAttr(end, 1);
		const width = numberAttr(findChild(segment, 'width'), 0);

		if (
			startX === undefined ||
			startY === undefined ||
			endX === undefined ||
			endY === undefined ||
			width === undefined
		) {
			warnings.push({
				code: 'track-skipped',
				message: `A track on ${layer === 'top' ? 'the top' : 'the bottom'} layer is missing its position or width and was skipped.`
			});
			continue;
		}

		tracks.push({
			start: { x: startX, y: startY },
			end: { x: endX, y: endY },
			width,
			layer
		});
	}

	// Curved (arc) tracks and copper zones are not supported in v1 — surface
	// them as warnings so the user knows the output is incomplete.
	const copperArcs = findAllRecursive(root, 'arc').filter(
		(arc) => copperLayer(findChild(arc, 'layer')?.attributes[0]) !== 'none'
	);
	if (copperArcs.length > 0) {
		warnings.push({
			code: 'curved-track',
			message: `${copperArcs.length} curved track${copperArcs.length === 1 ? '' : 's'} (arc) ignored — curved traces are not supported yet.`
		});
	}

	const copperZones = findAllRecursive(root, 'zone').filter((zone) => {
		const layerNames = [
			...(findChild(zone, 'layer')?.attributes ?? []),
			...(findChild(zone, 'layers')?.attributes ?? [])
		];
		return layerNames.some((name) => name.toUpperCase().includes('.CU') || name.includes('*'));
	});
	if (copperZones.length > 0) {
		warnings.push({
			code: 'copper-zone',
			message: `${copperZones.length} copper zone${copperZones.length === 1 ? '' : 's'} (filled pour) ignored — zones are not supported yet.`
		});
	}

	return tracks;
}
