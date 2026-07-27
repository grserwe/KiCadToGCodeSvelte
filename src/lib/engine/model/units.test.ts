import { describe, expect, it } from 'vitest';
import { convertLength, MM_PER_INCH } from './units';

// Regression guard: the old C# engine (GCodeManager.cs) scaled inch→inch output
// by 25.4. Same-unit conversion must always be the identity.
describe('convertLength', () => {
	it('is the identity for same units', () => {
		expect(convertLength(25.4, 'mm', 'mm')).toBe(25.4);
		expect(convertLength(1, 'inch', 'inch')).toBe(1);
	});

	it('converts mm to inches by dividing by 25.4', () => {
		expect(convertLength(25.4, 'mm', 'inch')).toBe(1);
		expect(convertLength(12.7, 'mm', 'inch')).toBeCloseTo(0.5, 10);
	});

	it('converts inches to mm by multiplying by 25.4', () => {
		expect(convertLength(1, 'inch', 'mm')).toBe(MM_PER_INCH);
		expect(convertLength(0.1, 'inch', 'mm')).toBeCloseTo(2.54, 10);
	});
});
