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

	it('keeps the outside of a wide-track corner whose inner lines miss the pad', () => {
		// ShowerLight: 1.27 mm tracks turn 90° on a 0.85 mm-radius pad. Only
		// each track's outer line reaches the circle; the inner lines meet
		// each other outside it, so each route has a single contact.
		const pad = new CircularPadGeometry({ x: 0, y: 0 }, 0.85, false);
		const up = createRoute({ x: 0, y: 5 }, { x: 0, y: 0 }, 1.27, 0.735, 'bottom');
		const left = createRoute({ x: 0, y: 0 }, { x: -5, y: 0 }, 1.27, 0.735, 'bottom');
		const reach = Math.sqrt(0.85 ** 2 - 0.735 ** 2);
		// Outer lines clipped at the pad: up's right line, left's lower line.
		up.line1.end = { x: 0.735, y: reach };
		up.line1.endIntersectsPad = true;
		left.line1.start = { x: -reach, y: -0.735 };
		left.line1.startIntersectsPad = true;
		// Inner lines trimmed to their shared corner, outside the circle.
		up.line2.end = { x: -0.735, y: 0.735 };
		left.line2.start = { x: -0.735, y: 0.735 };
		pad.touchingRoutes.push(up, left);

		const arcs = pad.isolationArcs();
		expect(arcs).toHaveLength(1);
		// Clockwise from the up track's outer contact, round the bottom-right,
		// to the left track's — not through the inside corner at 135°.
		const contactAngle = (Math.atan2(reach, 0.735) * 180) / Math.PI;
		expect(arcs[0].startAngle).toBeCloseTo(contactAngle, 3);
		expect(arcs[0].endAngle).toBeCloseTo(270 - contactAngle, 3);
		expect(arcSweep(arcs[0])).toBeCloseTo(90 + 2 * contactAngle, 3);
	});

	it('drops offset lines fully enclosed by the pad', () => {
		const pad = new CircularPadGeometry({ x: 0, y: 0 }, 5, false);
		const route = createRoute({ x: -1, y: 0 }, { x: 1, y: 0 }, 1, 0.5, 'top');
		expect(pad.lineEnclosed(route.line1)).toBe(true);
		expect(pad.lineEnclosed(route.line2)).toBe(true);
	});
});
