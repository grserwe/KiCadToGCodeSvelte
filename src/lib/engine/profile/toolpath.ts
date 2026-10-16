import type { BoardModel, EngineWarning } from '../model/types';
import type { OutlineEdge } from '../geometry/outline';
import { boardOutlineLoops, reverseLoop, signedArea, tessellateLoop } from './loops';
import { offsetLoopRight } from './offset';

/** One closed cutter path, in board-local mm. */
export interface ProfileLoop {
	edges: OutlineEdge[];
	/** Total path length in mm. */
	length: number;
	/** True for the board's boundary; false for a hole cut inside it. */
	outer: boolean;
}

export interface ProfileToolpath {
	/** Holes first, so the board stays held while they are cut; boundaries last. */
	loops: ProfileLoop[];
	warnings: EngineWarning[];
}

/**
 * The cutter centreline paths that cut a board free: every closed Edge.Cuts
 * loop offset by the cutter's radius so the tool runs along the outside of
 * the board (and the inside of any cutout), climb milling with the material
 * on its left.
 */
export function buildProfileToolpath(board: BoardModel, toolDiameterMm: number): ProfileToolpath {
	const outline = boardOutlineLoops(board);
	const warnings = [...outline.warnings];
	const loops: ProfileLoop[] = [];
	let tightArcs = 0;

	for (const loop of outline.loops) {
		const offset = offsetLoopRight(loop.edges, toolDiameterMm / 2);
		tightArcs += offset.tightArcs;
		if (offset.edges.length === 0) continue;

		if (!loop.outer) {
			// A hole narrower than the cutter folds inside out when offset inward.
			const area = signedArea(tessellateLoop(offset.edges));
			if (area >= -0.01) {
				warnings.push({
					code: 'outline-tight',
					message: `A cutout inside the board outline is smaller than the ${toolDiameterMm} mm cutter and was skipped.`
				});
				continue;
			}
		}
		loops.push({
			edges: offset.edges,
			length: offset.edges.reduce((sum, edge) => sum + edge.length, 0),
			outer: loop.outer
		});
	}

	if (tightArcs > 0) {
		warnings.push({
			code: 'outline-tight',
			message: `${tightArcs} inside curve${tightArcs === 1 ? '' : 's'} on the board outline ${tightArcs === 1 ? 'is' : 'are'} tighter than the ${toolDiameterMm} mm cutter can follow and will be cut wider.`
		});
	}

	loops.sort((a, b) => Number(a.outer) - Number(b.outer));
	return { loops, warnings };
}

/** Direction-flipped copy of a loop, for mirrored output that must still climb mill. */
export function reverseProfileLoop(loop: ProfileLoop): ProfileLoop {
	return { ...loop, edges: reverseLoop(loop.edges) };
}
