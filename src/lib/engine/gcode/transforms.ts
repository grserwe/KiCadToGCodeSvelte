import type { Vec2 } from '../model/types';
import { convertLength } from '../model/units';
import type { GCodeSettings } from './settings';

/**
 * Maps board-local model points (mm, Y-up, origin lower-left) to machine
 * output coordinates. Applied in order: side mirror (flip-over machining) →
 * user FlipX/FlipY → XY-zero translation → unit conversion.
 *
 * `mirrored` is true when an odd number of mirrors applied — arc directions
 * flip (G02 ↔ G03) in that case.
 */
export interface OutputTransform {
	point(model: Vec2): Vec2;
	/** Scale-only conversion for deltas such as arc I/J offsets. */
	delta(model: Vec2): Vec2;
	readonly mirrored: boolean;
}

export function createOutputTransform(
	settings: GCodeSettings,
	boardWidth: number,
	boardHeight: number,
	sideMirror: boolean
): OutputTransform {
	const mirrorCount = [sideMirror, settings.flipX, settings.flipY].filter(Boolean).length;
	const scale = (value: number) => convertLength(value, 'mm', settings.outputUnits);

	const zeroOffset = ((): Vec2 => {
		switch (settings.xyZeroPosition) {
			case 'lower-left':
				return { x: 0, y: 0 };
			case 'upper-left':
				return { x: 0, y: boardHeight };
			case 'upper-right':
				return { x: boardWidth, y: boardHeight };
			case 'lower-right':
				return { x: boardWidth, y: 0 };
			case 'center':
				return { x: boardWidth / 2, y: boardHeight / 2 };
		}
	})();

	const transformPoint = (model: Vec2): Vec2 => {
		let x = model.x;
		let y = model.y;
		if (sideMirror) x = boardWidth - x;
		if (settings.flipX) x = boardWidth - x;
		if (settings.flipY) y = boardHeight - y;
		return { x: scale(x - zeroOffset.x), y: scale(y - zeroOffset.y) };
	};

	return {
		point: transformPoint,
		delta: (model: Vec2): Vec2 => {
			let x = model.x;
			let y = model.y;
			if (sideMirror) x = -x;
			if (settings.flipX) x = -x;
			if (settings.flipY) y = -y;
			return { x: scale(x), y: scale(y) };
		},
		mirrored: mirrorCount % 2 === 1
	};
}
