import { describe, expect, it } from 'vitest';
import { CircularPadGeometry } from './circularPad';
import { createRoute } from '../toolpath/routes';
import { arcSweep } from '../toolpath/segments';

describe('CircularPadGeometry', () => {
	it('produces a full circle when no routes touch', () => {
		const pad = new CircularPadGeometry({ x: 0, y: 0 }, 2, false);
		const arcs = pad.isolationArcs();
		expect(arcs).toHaveLength(1);
		expect(arcSweep(arcs[0])).toBe(360);
		expect(arcs[0].radius).toBe(2);
	});

	it('produces four 45° thermal-relief arcs for ground pads', () => {
		const pad = new CircularPadGeometry({ x: 0, y: 0 }, 2, true);
		const arcs = pad.isolationArcs();
		expect(arcs).toHaveLength(4);
		for (const arc of arcs) {
			expect(arcSweep(arc)).toBeCloseTo(45, 6);
		}
	});

	it('clips an entering track and leaves a gap around its entry angle', () => {
		const pad = new CircularPadGeometry({ x: 0, y: 0 }, 2, false);
		const route = createRoute({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 'top');

		for (const line of [route.line1, route.line2]) {
			expect(pad.lineEnclosed(line)).toBe(false);
			const intersection = pad.segmentBoundaryIntersection(line);
			expect(intersection).not.toBeNull();
			// The line starts inside the pad, so its start gets clipped.
			expect(pad.containsPoint(line.start)).toBe(true);
			line.start = intersection!;
			line.startIntersectsPad = true;
		}
		pad.touchingRoutes.push(route);

		// Clip points: x = sqrt(2² - 0.5²) ≈ 1.93649 at y = ±0.5.
		expect(route.line1.start.x).toBeCloseTo(Math.sqrt(4 - 0.25), 5);
		expect(route.line1.start.y).toBeCloseTo(0.5, 6);

		const arcs = pad.isolationArcs();
		expect(arcs).toHaveLength(1);

		// The keep-arc spans everything except the entry gap around 0°:
		// entry angles ±atan2(0.5, 1.93649) ≈ ±14.478°.
		const entryHalfAngle = (Math.atan2(0.5, Math.sqrt(4 - 0.25)) * 180) / Math.PI;
		expect(arcSweep(arcs[0])).toBeCloseTo(360 - 2 * entryHalfAngle, 3);
		expect(arcs[0].startAngle).toBeCloseTo(360 - entryHalfAngle, 3);
		expect(arcs[0].endAngle).toBeCloseTo(entryHalfAngle, 3);
	});

	it('drops offset lines fully enclosed by the pad', () => {
		const pad = new CircularPadGeometry({ x: 0, y: 0 }, 5, false);
		const route = createRoute({ x: -1, y: 0 }, { x: 1, y: 0 }, 1, 0.5, 'top');
		expect(pad.lineEnclosed(route.line1)).toBe(true);
		expect(pad.lineEnclosed(route.line2)).toBe(true);
	});
});
