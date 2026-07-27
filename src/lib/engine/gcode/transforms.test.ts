import { describe, expect, it } from 'vitest';
import { createOutputTransform } from './transforms';
import { defaultSettings, type GCodeSettings } from './settings';

const BOARD_W = 20;
const BOARD_H = 10;

function settings(overrides: Partial<GCodeSettings> = {}): GCodeSettings {
	return { ...defaultSettings(), outputUnits: 'mm', ...overrides };
}

describe('createOutputTransform', () => {
	it('passes points through unchanged for lower-left zero in mm', () => {
		const transform = createOutputTransform(settings(), BOARD_W, BOARD_H, false);
		expect(transform.point({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
		expect(transform.mirrored).toBe(false);
	});

	it.each([
		['lower-left', { x: 5, y: 2 }],
		['upper-left', { x: 5, y: -8 }],
		['upper-right', { x: -15, y: -8 }],
		['lower-right', { x: -15, y: 2 }],
		['center', { x: -5, y: -3 }]
	] as const)('translates the origin for %s zero', (zero, expected) => {
		const transform = createOutputTransform(
			settings({ xyZeroPosition: zero }),
			BOARD_W,
			BOARD_H,
			false
		);
		const result = transform.point({ x: 5, y: 2 });
		expect(result.x).toBeCloseTo(expected.x, 10);
		expect(result.y).toBeCloseTo(expected.y, 10);
	});

	it('mirrors the bottom side about the vertical centerline', () => {
		const transform = createOutputTransform(settings(), BOARD_W, BOARD_H, true);
		// x' = width − x; y unchanged.
		expect(transform.point({ x: 3, y: 4 })).toEqual({ x: 17, y: 4 });
		expect(transform.mirrored).toBe(true);
	});

	it('mirroring twice (side + FlipX) cancels the handedness flip', () => {
		const transform = createOutputTransform(settings({ flipX: true }), BOARD_W, BOARD_H, true);
		expect(transform.point({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
		expect(transform.mirrored).toBe(false);
	});

	it('converts output to inches without the C# same-unit bug', () => {
		const transform = createOutputTransform(
			settings({ outputUnits: 'inch' }),
			BOARD_W,
			BOARD_H,
			false
		);
		expect(transform.point({ x: 25.4, y: 0 }).x).toBeCloseTo(1, 10);
		// Regression pin: mm output must NOT be scaled by 25.4.
		const mmTransform = createOutputTransform(settings(), BOARD_W, BOARD_H, false);
		expect(mmTransform.point({ x: 25.4, y: 0 }).x).toBeCloseTo(25.4, 10);
	});

	it('scales deltas without translating them', () => {
		const transform = createOutputTransform(
			settings({ xyZeroPosition: 'center', outputUnits: 'inch' }),
			BOARD_W,
			BOARD_H,
			false
		);
		expect(transform.delta({ x: 25.4, y: -25.4 })).toEqual({ x: 1, y: -1 });
	});

	it('negates delta components under mirroring', () => {
		const transform = createOutputTransform(settings(), BOARD_W, BOARD_H, true);
		expect(transform.delta({ x: 2, y: 3 })).toEqual({ x: -2, y: 3 });
	});
});
