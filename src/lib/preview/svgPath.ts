import type { PathSegment } from '../engine/toolpath/segments';
import { arcPoint, arcSweep } from '../engine/toolpath/segments';

/**
 * Convert a toolpath segment to an SVG path `d` string. The board model is
 * Y-up while SVG is Y-down, so callers should wrap the drawing in a
 * `scale(1,-1)` transform; this function emits raw board coordinates.
 */
export function segmentToSvgPath(segment: PathSegment): string {
	if (segment.kind === 'line') {
		return `M ${round(segment.start.x)} ${round(segment.start.y)} L ${round(segment.end.x)} ${round(segment.end.y)}`;
	}

	const sweep = arcSweep(segment);
	const start = arcPoint(segment, segment.startAngle);
	if (sweep >= 360) {
		// Full circle: two half-circle arcs.
		const opposite = arcPoint(segment, segment.startAngle + 180);
		const r = round(segment.radius);
		return (
			`M ${round(start.x)} ${round(start.y)} ` +
			`A ${r} ${r} 0 1 0 ${round(opposite.x)} ${round(opposite.y)} ` +
			`A ${r} ${r} 0 1 0 ${round(start.x)} ${round(start.y)}`
		);
	}

	const end = arcPoint(segment, segment.endAngle);
	const r = round(segment.radius);
	const largeArc = sweep > 180 ? 1 : 0;
	// Toolpath arcs travel clockwise (decreasing angle) in Y-up coordinates,
	// which is sweep-flag 0 in SVG's Y-down space… but callers flip Y, so the
	// visual direction flips back: use sweep-flag 0 for CW-in-model.
	return `M ${round(start.x)} ${round(start.y)} A ${r} ${r} 0 ${largeArc} 0 ${round(end.x)} ${round(end.y)}`;
}

const round = (value: number): number => Math.round(value * 1e5) / 1e5;
