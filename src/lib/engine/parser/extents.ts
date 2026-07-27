import type { SExpr } from '../sexpr/types';
import type { Vec2 } from '../model/types';
import { findAllRecursive, findChild, numberAttr } from './sexprHelpers';
import type { RawPad } from './pads';
import type { RawTrack } from './tracks';
import { BoardParseError } from './errors';

/** Board bounding box in KiCad file coordinates (Y-down, absolute mm). */
export interface FileExtents {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * Board extents, tried in order (mirrors the C# VersionParser.GetArea):
 * 1. `(general (area x1 y1 x2 y2))` — written by legacy KiCad versions.
 * 2. Edge.Cuts graphics (gr_line / gr_rect / gr_arc / gr_circle).
 * 3. Bounding box of all copper content, as a last resort.
 */
export function computeExtents(root: SExpr, pads: RawPad[], tracks: RawTrack[]): FileExtents {
	return (
		extentsFromGeneralArea(root) ?? extentsFromEdgeCuts(root) ?? extentsFromContent(pads, tracks)
	);
}

function extentsFromGeneralArea(root: SExpr): FileExtents | null {
	const general = findChild(root, 'general');
	const area = general ? findChild(general, 'area') : undefined;
	if (!area) return null;

	const x1 = numberAttr(area, 0);
	const y1 = numberAttr(area, 1);
	const x2 = numberAttr(area, 2);
	const y2 = numberAttr(area, 3);
	if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
		return null;
	}

	return {
		minX: Math.min(x1, x2),
		minY: Math.min(y1, y2),
		maxX: Math.max(x1, x2),
		maxY: Math.max(y1, y2)
	};
}

function extentsFromEdgeCuts(root: SExpr): FileExtents | null {
	const box = new BoundsAccumulator();

	for (const name of ['gr_line', 'gr_rect', 'gr_arc', 'gr_circle']) {
		for (const record of findAllRecursive(root, name)) {
			const layer = findChild(record, 'layer')?.attributes[0] ?? '';
			if (!layer.includes('Edge.Cuts')) continue;

			if (name === 'gr_circle') {
				const center = childPoint(record, 'center');
				const end = childPoint(record, 'end');
				if (center && end) {
					const radius = Math.hypot(end.x - center.x, end.y - center.y);
					box.add({ x: center.x - radius, y: center.y - radius });
					box.add({ x: center.x + radius, y: center.y + radius });
				}
				continue;
			}

			for (const pointName of ['start', 'mid', 'end']) {
				const point = childPoint(record, pointName);
				if (point) box.add(point);
			}
		}
	}

	return box.result();
}

function extentsFromContent(pads: RawPad[], tracks: RawTrack[]): FileExtents {
	const box = new BoundsAccumulator();

	for (const pad of pads) {
		const { halfWidth, halfHeight } = padHalfExtents(pad);
		box.add({ x: pad.position.x - halfWidth, y: pad.position.y - halfHeight });
		box.add({ x: pad.position.x + halfWidth, y: pad.position.y + halfHeight });
	}
	for (const track of tracks) {
		const half = track.width / 2;
		for (const point of [track.start, track.end]) {
			box.add({ x: point.x - half, y: point.y - half });
			box.add({ x: point.x + half, y: point.y + half });
		}
	}

	const result = box.result();
	if (!result) {
		throw new BoardParseError(
			'The board has no outline, pads, or tracks — there is nothing to machine.'
		);
	}
	return result;
}

/** Conservative rotated-AABB half extents of a pad's shape. */
function padHalfExtents(pad: RawPad): { halfWidth: number; halfHeight: number } {
	const shape = pad.shape;
	if (shape.kind === 'circle') {
		return { halfWidth: shape.diameter / 2, halfHeight: shape.diameter / 2 };
	}

	const radians = (pad.rotationDeg * Math.PI) / 180;
	const cos = Math.abs(Math.cos(radians));
	const sin = Math.abs(Math.sin(radians));

	if (shape.kind === 'polygon') {
		let halfWidth = 0;
		let halfHeight = 0;
		for (const point of shape.points) {
			halfWidth = Math.max(halfWidth, Math.abs(point.x) * cos + Math.abs(point.y) * sin);
			halfHeight = Math.max(halfHeight, Math.abs(point.x) * sin + Math.abs(point.y) * cos);
		}
		return { halfWidth, halfHeight };
	}

	const halfX = shape.sizeX / 2;
	const halfY = shape.sizeY / 2;
	return {
		halfWidth: halfX * cos + halfY * sin,
		halfHeight: halfX * sin + halfY * cos
	};
}

function childPoint(record: SExpr, name: string): Vec2 | null {
	const child = findChild(record, name);
	const x = numberAttr(child, 0);
	const y = numberAttr(child, 1);
	return x !== undefined && y !== undefined ? { x, y } : null;
}

class BoundsAccumulator {
	private minX = Infinity;
	private minY = Infinity;
	private maxX = -Infinity;
	private maxY = -Infinity;

	add(point: Vec2): void {
		this.minX = Math.min(this.minX, point.x);
		this.minY = Math.min(this.minY, point.y);
		this.maxX = Math.max(this.maxX, point.x);
		this.maxY = Math.max(this.maxY, point.y);
	}

	result(): FileExtents | null {
		if (this.minX === Infinity) return null;
		return { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY };
	}
}
