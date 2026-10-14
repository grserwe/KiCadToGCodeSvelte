import { describe, expect, it } from 'vitest';
import { arcThroughPoints, rotateAbout } from './arcs';

describe('arcThroughPoints', () => {
	it('recovers the center, radius, and a CCW sweep from three points', () => {
		// Quarter circle of radius 2 about (1, 1): (3,1) → (1+√2, 1+√2) → (1,3).
		const s = Math.SQRT2;
		const arc = arcThroughPoints({ x: 3, y: 1 }, { x: 1 + s, y: 1 + s }, { x: 1, y: 3 })!;
		expect(arc.center.x).toBeCloseTo(1, 9);
		expect(arc.center.y).toBeCloseTo(1, 9);
		expect(arc.radius).toBeCloseTo(2, 9);
		expect(arc.startAngle).toBeCloseTo(0, 9);
		expect(arc.sweep).toBeCloseTo(90, 9);
	});

	it('reports a negative sweep when the points run clockwise', () => {
		const s = Math.SQRT2;
		const arc = arcThroughPoints({ x: 1, y: 3 }, { x: 1 + s, y: 1 + s }, { x: 3, y: 1 })!;
		expect(arc.startAngle).toBeCloseTo(90, 9);
		expect(arc.sweep).toBeCloseTo(-90, 9);
	});

	it('handles arcs longer than a half turn', () => {
		// 270° CCW about the origin from (1,0) through (-1,0) to (0,-1).
		const arc = arcThroughPoints({ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 })!;
		expect(arc.radius).toBeCloseTo(1, 9);
		expect(arc.sweep).toBeCloseTo(270, 9);
	});

	it('returns null for collinear points', () => {
		expect(arcThroughPoints({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
	});
});

describe('rotateAbout', () => {
	it('rotates counterclockwise in the frame of the points', () => {
		const p = rotateAbout({ x: 2, y: 0 }, { x: 1, y: 0 }, 90);
		expect(p.x).toBeCloseTo(1, 9);
		expect(p.y).toBeCloseTo(1, 9);
	});
});
