import type { BoardModel, Vec2 } from '../model/types';
import type { GCodeSettings } from '../gcode/settings';
import { distance } from '../geometry/primitives';

/** Holes at or below this diameter are preferred as targets: easier to centre a laser dot on. */
const SMALL_HOLE_MM = 1.5;

/**
 * A physical feature the laser can be jogged to for LightBurn's two-point
 * "Print and Cut" alignment. The first target is the one LightBurn asks for first.
 */
export interface LaserTarget {
	position: Vec2;
	diameterMm: number;
	source: 'drill' | 'registration';
}

/**
 * Pick the two alignment targets for a silkscreen burn: the two drilled
 * through-holes farthest apart (small holes preferred, since centring the
 * laser's dot on a 0.8 mm hole is more precise than on a 3 mm one). Boards
 * with fewer than two drilled holes fall back to the registration holes.
 * Returns an empty list when nothing usable exists.
 */
export function selectLaserTargets(board: BoardModel, settings: GCodeSettings): LaserTarget[] {
	const drilled: LaserTarget[] = board.pads
		.filter((pad) => pad.drill && pad.drill.diameter > 0 && pad.layers === 'through')
		.map((pad) => ({ position: pad.position, diameterMm: pad.drill!.diameter, source: 'drill' }));

	const small = drilled.filter((hole) => hole.diameterMm <= SMALL_HOLE_MM);
	const pair = farthestPair(small.length >= 2 ? small : drilled);
	if (pair) return pair;

	if (settings.registrationHoles.enabled) {
		const { marginMm, diameterMm } = settings.registrationHoles;
		return [
			{ position: { x: -marginMm, y: board.height / 2 }, diameterMm, source: 'registration' },
			{
				position: { x: board.width + marginMm, y: board.height / 2 },
				diameterMm,
				source: 'registration'
			}
		];
	}
	return [];
}

function farthestPair(holes: LaserTarget[]): LaserTarget[] | null {
	if (holes.length < 2) return null;
	let best: [LaserTarget, LaserTarget] | null = null;
	let bestDistance = -1;
	for (let i = 0; i < holes.length; i++) {
		for (let j = i + 1; j < holes.length; j++) {
			const d = distance(holes[i].position, holes[j].position);
			if (d > bestDistance + 1e-9) {
				bestDistance = d;
				best = [holes[i], holes[j]];
			}
		}
	}
	if (!best || bestDistance <= 0) return null;
	// First target is the left-most (then lowest) hole, so the order is predictable.
	const [a, b] = best;
	const aFirst =
		a.position.x < b.position.x - 1e-9 ||
		(Math.abs(a.position.x - b.position.x) <= 1e-9 && a.position.y <= b.position.y);
	return aFirst ? [a, b] : [b, a];
}
