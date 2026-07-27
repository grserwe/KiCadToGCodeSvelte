export const MM_PER_INCH = 25.4;

export type Units = 'mm' | 'inch';

/**
 * Convert a length between millimeters and inches.
 *
 * KiCad board files are always millimeters; GCode output may be either.
 */
export function convertLength(value: number, from: Units, to: Units): number {
	if (from === to) return value;
	return from === 'mm' ? value / MM_PER_INCH : value * MM_PER_INCH;
}
