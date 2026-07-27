/**
 * Test helper: parses emitted GCode and checks machine-safety invariants.
 * Not part of the public engine API.
 */

export interface ValidationIssue {
	line: number;
	text: string;
	problem: string;
}

export interface ValidationOptions {
	cutDepth: number;
	safeZ: number;
	/** Inclusive coordinate bounds in output units. */
	bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export function validateGCode(content: string, options: ValidationOptions): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const lines = content.split('\n');
	let z = Infinity; // unknown until first Z move
	let x = 0;
	let y = 0;

	const value = (line: string, axis: string): number | null => {
		const match = line.match(new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`));
		return match ? Number(match[1]) : null;
	};

	lines.forEach((raw, index) => {
		const line = raw.trim();
		if (!line || line.startsWith('(')) return;
		const lineNumber = index + 1;

		const newX = value(line, 'X');
		const newY = value(line, 'Y');
		const newZ = value(line, 'Z');

		if (line.startsWith('G00')) {
			// Rapids must never happen at or below the surface.
			if (newX !== null || newY !== null) {
				if (z <= 0) {
					issues.push({ line: lineNumber, text: line, problem: 'XY rapid while tool is down' });
				}
			}
		} else if (line.startsWith('G01')) {
			if ((newX !== null || newY !== null) && newZ === null) {
				if (Math.abs(z - -options.cutDepth) > 1e-6) {
					issues.push({
						line: lineNumber,
						text: line,
						problem: `cutting move at Z=${z} (expected ${-options.cutDepth})`
					});
				}
			}
		} else if (line.startsWith('G02') || line.startsWith('G03')) {
			if (Math.abs(z - -options.cutDepth) > 1e-6) {
				issues.push({ line: lineNumber, text: line, problem: `arc move at Z=${z}` });
			}
			const i = value(line, 'I');
			const j = value(line, 'J');
			if (i !== null && j !== null && newX !== null && newY !== null) {
				const centerX = x + i;
				const centerY = y + j;
				const startRadius = Math.hypot(x - centerX, y - centerY);
				const endRadius = Math.hypot(newX - centerX, newY - centerY);
				if (Math.abs(startRadius - endRadius) > 0.001) {
					issues.push({
						line: lineNumber,
						text: line,
						problem: `arc radii differ: start ${startRadius.toFixed(4)}, end ${endRadius.toFixed(4)}`
					});
				}
			}
		}

		if (newX !== null || newY !== null) {
			const checkX = newX ?? x;
			const checkY = newY ?? y;
			const { minX, maxX, minY, maxY } = options.bounds;
			if (checkX < minX || checkX > maxX || checkY < minY || checkY > maxY) {
				issues.push({ line: lineNumber, text: line, problem: 'coordinate out of bounds' });
			}
		}

		if (newX !== null) x = newX;
		if (newY !== null) y = newY;
		if (newZ !== null) z = newZ;
	});

	return issues;
}
