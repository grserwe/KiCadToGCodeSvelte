import { describe, expect, it } from 'vitest';
import { bitForHole, groupDrillSizes, normalizeBits, parseBitList } from './drillBits';

describe('bitForHole', () => {
	const bits = [0.9, 1.2];

	it('picks the nearest bit within the allowed difference', () => {
		expect(bitForHole(0.8, bits, 0.15)).toBe(0.9);
		expect(bitForHole(1.0, bits, 0.15)).toBe(0.9);
		expect(bitForHole(1.1, bits, 0.15)).toBe(1.2);
		expect(bitForHole(1.3, bits, 0.15)).toBe(1.2);
	});

	it('takes the larger bit when a hole is exactly halfway', () => {
		expect(bitForHole(1.05, bits, 0.15)).toBe(1.2);
	});

	it('returns null when no bit is close enough', () => {
		expect(bitForHole(3.2, bits, 0.15)).toBeNull();
		expect(bitForHole(0.6, bits, 0.15)).toBeNull();
	});

	it('treats the limit as inclusive despite float error', () => {
		// 1.35 − 1.2 is 0.15000000000000013 in floating point.
		expect(bitForHole(1.35, bits, 0.15)).toBe(1.2);
	});
});

describe('groupDrillSizes', () => {
	it('keeps one group per size when no bits are configured', () => {
		expect(groupDrillSizes([1.0, 0.8, 0.8], [], 0.15)).toEqual([
			{ bitMm: 0.8, holeDiametersMm: [0.8], unmatched: false },
			{ bitMm: 1.0, holeDiametersMm: [1.0], unmatched: false }
		]);
	});

	it('merges close sizes onto the bits and leaves far ones on their own', () => {
		expect(groupDrillSizes([0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 3.2], [1.2, 0.9], 0.15)).toEqual([
			{ bitMm: 0.9, holeDiametersMm: [0.8, 0.9, 1.0], unmatched: false },
			{ bitMm: 1.2, holeDiametersMm: [1.1, 1.2, 1.3], unmatched: false },
			{ bitMm: 3.2, holeDiametersMm: [3.2], unmatched: true }
		]);
	});
});

describe('bit list parsing', () => {
	it('accepts commas, spaces and semicolons, and drops junk', () => {
		expect(parseBitList('1.2, 0.9;  1.2 abc -1 0')).toEqual([0.9, 1.2]);
		expect(parseBitList('')).toEqual([]);
	});

	it('normalizes to ascending unique positive sizes', () => {
		expect(normalizeBits([1.2, 0.9, 0.9, NaN, -0.5])).toEqual([0.9, 1.2]);
	});
});
