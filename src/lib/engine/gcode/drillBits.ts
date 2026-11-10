/**
 * Map hole sizes onto the drill bits the user owns, so near-identical sizes
 * (0.8 / 0.9 / 1.0 mm) share one drill file and one tool change.
 */

/** One drill file's worth of holes: the bit it runs and the sizes it covers. */
export interface DrillGroup {
	/** The bit diameter this file drills with, in mm. */
	bitMm: number;
	/** The designed hole diameters assigned to this bit, ascending. */
	holeDiametersMm: number[];
	/** True when no configured bit was close enough and the hole keeps its own size. */
	unmatched: boolean;
}

/** Compare in whole microns so 1.05 sits exactly halfway between 0.9 and 1.2. */
function microns(mm: number): number {
	return Math.round(mm * 1000);
}

/** The usable bits: positive, finite, de-duplicated, ascending. */
export function normalizeBits(bitsMm: readonly number[]): number[] {
	const unique = new Map<number, number>();
	for (const bit of bitsMm) {
		if (Number.isFinite(bit) && bit > 0) unique.set(microns(bit), bit);
	}
	return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, bit]) => bit);
}

/**
 * The closest bit to a hole within `maxDifferenceMm`, or null when none is.
 * A hole exactly halfway between two bits takes the larger one, so a lead
 * still fits.
 */
export function bitForHole(
	holeMm: number,
	bitsMm: readonly number[],
	maxDifferenceMm: number
): number | null {
	const hole = microns(holeMm);
	const limit = microns(Math.max(0, maxDifferenceMm));
	let best: number | null = null;
	let bestDifference = Infinity;
	for (const bit of normalizeBits(bitsMm)) {
		const difference = Math.abs(microns(bit) - hole);
		if (difference > limit) continue;
		if (
			difference < bestDifference ||
			(difference === bestDifference && best !== null && bit > best)
		) {
			best = bit;
			bestDifference = difference;
		}
	}
	return best;
}

/**
 * Group hole diameters into drill files. With no bits configured every size
 * is its own file (the original behaviour); with bits, each size joins its
 * nearest bit, and sizes no bit is close enough to stay on their own.
 */
export function groupDrillSizes(
	holeDiametersMm: readonly number[],
	bitsMm: readonly number[],
	maxDifferenceMm: number
): DrillGroup[] {
	const sizes = [...new Set(holeDiametersMm)].sort((a, b) => a - b);
	const bits = normalizeBits(bitsMm);
	const groups = new Map<number, DrillGroup>();

	for (const size of sizes) {
		const bit = bitForHole(size, bits, maxDifferenceMm);
		const key = microns(bit ?? size);
		const group = groups.get(key) ?? {
			bitMm: bit ?? size,
			holeDiametersMm: [],
			unmatched: bit === null && bits.length > 0
		};
		group.holeDiametersMm.push(size);
		groups.set(key, group);
	}

	return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, group]) => group);
}

/** Parse "0.9, 1.2 1.5" (commas, spaces or semicolons) into bit sizes. */
export function parseBitList(text: string): number[] {
	return normalizeBits(
		text
			.split(/[\s,;]+/)
			.filter((part) => part.length > 0)
			.map(Number)
	);
}
