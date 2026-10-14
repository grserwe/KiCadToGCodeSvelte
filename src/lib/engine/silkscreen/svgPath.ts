import type { Graphic, Vec2 } from '../model/types';
import { angleDeg, normalizeAngle } from '../geometry/primitives';

const identity = (point: Vec2): Vec2 => point;

/**
 * SVG path data for a drawing primitive. `map` carries each model point into
 * the target frame (an isometry: flips, mirrors, and translations), and arc
 * flags are derived from the mapped points, so the same function serves the
 * Y-up preview (identity map inside a flipped group) and the Y-down SVG file.
 * Text has no path and yields an empty string.
 */
export function graphicToSvgPath(graphic: Graphic, map: (point: Vec2) => Vec2 = identity): string {
	switch (graphic.kind) {
		case 'line': {
			const start = map(graphic.start);
			const end = map(graphic.end);
			return `M ${fmt(start)} L ${fmt(end)}`;
		}

		case 'arc': {
			const start = map(pointAt(graphic.center, graphic.radius, graphic.startAngle));
			const mid = map(
				pointAt(graphic.center, graphic.radius, graphic.startAngle + graphic.sweep / 2)
			);
			const end = map(pointAt(graphic.center, graphic.radius, graphic.startAngle + graphic.sweep));
			return `M ${fmt(start)} ${arcTo(map(graphic.center), graphic.radius, start, mid, end)}`;
		}

		case 'circle': {
			const r = round(graphic.radius);
			const east = map({ x: graphic.center.x + graphic.radius, y: graphic.center.y });
			const west = map({ x: graphic.center.x - graphic.radius, y: graphic.center.y });
			return `M ${fmt(east)} A ${r} ${r} 0 1 0 ${fmt(west)} A ${r} ${r} 0 1 0 ${fmt(east)} Z`;
		}

		case 'polygon': {
			const points = graphic.points.map(map);
			if (points.length === 0) return '';
			return (
				`M ${fmt(points[0])}` +
				points
					.slice(1)
					.map((p) => ` L ${fmt(p)}`)
					.join('') +
				' Z'
			);
		}

		case 'text':
			return '';
	}
}

function pointAt(center: Vec2, radius: number, angleDegrees: number): Vec2 {
	const radians = (angleDegrees * Math.PI) / 180;
	return { x: center.x + radius * Math.cos(radians), y: center.y + radius * Math.sin(radians) };
}

/** An `A` command from `start` to `end` through `mid`, all already in the target frame. */
function arcTo(center: Vec2, radius: number, start: Vec2, mid: Vec2, end: Vec2): string {
	// SVG sweep-flag 1 follows the positive-angle direction of the target frame.
	const cross = (mid.x - start.x) * (end.y - start.y) - (mid.y - start.y) * (end.x - start.x);
	const sweepFlag = cross > 0 ? 1 : 0;
	const startAngle = angleDeg(center, start);
	const endAngle = angleDeg(center, end);
	const sweep = sweepFlag
		? normalizeAngle(endAngle - startAngle)
		: normalizeAngle(startAngle - endAngle);
	const largeArc = sweep > 180 ? 1 : 0;
	const r = round(radius);
	return `A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${fmt(end)}`;
}

const round = (value: number): number => Math.round(value * 1e5) / 1e5;
const fmt = (point: Vec2): string => `${round(point.x)} ${round(point.y)}`;
