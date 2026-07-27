import { describe, expect, it } from 'vitest';
import { createRoute } from '../toolpath/routes';
import { collectJunctions, completeJunction } from './junctions';

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6);

describe('route offset lines', () => {
	it('offsets a horizontal track into left (line1) and right (line2) parallels', () => {
		const route = createRoute({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 'top');

		close(route.line1.start.y, 0.5);
		close(route.line1.end.y, 0.5);
		close(route.line2.start.y, -0.5);
		close(route.line2.end.y, -0.5);
		close(route.line1.start.x, 0);
		close(route.line1.end.x, 10);
	});

	it('honors a wider offset distance for tool-radius compensation', () => {
		const route = createRoute({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.65, 'top');
		close(route.line1.start.y, 0.65);
		close(route.line2.start.y, -0.65);
	});
});

describe('junction trimming', () => {
	it('miters an L-junction inside and outside', () => {
		const a = createRoute({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 'top');
		const b = createRoute({ x: 10, y: 0 }, { x: 10, y: 10 }, 1, 0.5, 'top');

		const junctions = collectJunctions([a, b]);
		expect(junctions).toHaveLength(3);
		for (const junction of junctions) {
			completeJunction(junction);
		}

		// Inner corner: a.line1 (y=0.5) meets b.line1 (x=9.5) at (9.5, 0.5).
		close(a.line1.end.x, 9.5);
		close(a.line1.end.y, 0.5);
		close(b.line1.start.x, 9.5);
		close(b.line1.start.y, 0.5);

		// Outer corner: a.line2 (y=-0.5) meets b.line2 (x=10.5) at (10.5, -0.5).
		close(a.line2.end.x, 10.5);
		close(a.line2.end.y, -0.5);
		close(b.line2.start.x, 10.5);
		close(b.line2.start.y, -0.5);

		// Far ends are untouched.
		close(a.line1.start.x, 0);
		close(b.line1.end.y, 10);
	});

	it('joins collinear continuations without gaps', () => {
		const a = createRoute({ x: 0, y: 0 }, { x: 5, y: 0 }, 1, 0.5, 'top');
		const b = createRoute({ x: 5, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 'top');

		for (const junction of collectJunctions([a, b])) {
			completeJunction(junction);
		}

		close(a.line1.end.x, b.line1.start.x);
		close(a.line1.end.y, b.line1.start.y);
		close(a.line2.end.x, b.line2.start.x);
	});

	it('miters a 45° bend', () => {
		const a = createRoute({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 'top');
		const b = createRoute({ x: 10, y: 0 }, { x: 17.071, y: 7.071 }, 1, 0.5, 'top');

		for (const junction of collectJunctions([a, b])) {
			completeJunction(junction);
		}

		// The four trimmed endpoints meet pairwise.
		close(a.line1.end.x, b.line1.start.x);
		close(a.line1.end.y, b.line1.start.y);
		close(a.line2.end.x, b.line2.start.x);
		close(a.line2.end.y, b.line2.start.y);

		// The bend turns upward: the inner miter (line1, top side) pulls back
		// before the junction, the outer miter (line2) extends past it.
		expect(a.line1.end.x).toBeLessThan(10);
		expect(a.line2.end.x).toBeGreaterThan(10);
	});
});
