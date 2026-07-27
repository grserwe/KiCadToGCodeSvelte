import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../parser/parseBoard';
import { buildLayerToolpath } from './assemble';
import { segmentEnd, segmentStart } from './segments';

const sample = readFileSync(
	new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);

const OPTIONS = { isolationOffset: 0, minimumTrackWidth: 0.1, minimumPadDiameter: 1.5 };

describe('sample board toolpath', () => {
	const { board } = parseBoard(sample);

	it('builds the top layer: track lines, entered rect pads, untouched circles', () => {
		const { segments } = buildLayerToolpath(board, 'top', OPTIONS);

		const lines = segments.filter((s) => s.kind === 'line');
		const arcs = segments.filter((s) => s.kind === 'arc');

		// 2 clipped track offset lines + 2 rect pads (5 segments each: 4
		// edges with the entry gap splitting one) + 2 untouched circle pads.
		expect(lines).toHaveLength(2 + 5 + 5);
		expect(arcs).toHaveLength(2);
	});

	it('builds the bottom layer: track into the circle pads, full rect outlines', () => {
		const { segments } = buildLayerToolpath(board, 'bottom', OPTIONS);

		const lines = segments.filter((s) => s.kind === 'line');
		const arcs = segments.filter((s) => s.kind === 'arc');

		// 2 track lines + 2 rect outlines (4 edges each), and 2 circle pads
		// with an entry gap each.
		expect(lines).toHaveLength(2 + 8);
		expect(arcs).toHaveLength(2);
	});

	it('keeps every cut within the board bounds (with tool margin)', () => {
		for (const layer of ['top', 'bottom'] as const) {
			const { segments } = buildLayerToolpath(board, layer, OPTIONS);
			for (const segment of segments) {
				for (const point of [segmentStart(segment), segmentEnd(segment)]) {
					expect(point.x).toBeGreaterThan(-1);
					expect(point.x).toBeLessThan(board.width + 1);
					expect(point.y).toBeGreaterThan(-1);
					expect(point.y).toBeLessThan(board.height + 1);
				}
			}
		}
	});

	it('produces more cutting when the tool offset grows', () => {
		const tight = buildLayerToolpath(board, 'top', OPTIONS);
		const offset = buildLayerToolpath(board, 'top', { ...OPTIONS, isolationOffset: 0.15 });
		// Inflated rect pads gain corner arcs, so the offset run has more
		// segments, never fewer.
		expect(offset.segments.length).toBeGreaterThanOrEqual(tight.segments.length);
		const radiusOf = (segments: typeof tight.segments): number => {
			const fullCircle = segments.find(
				(s) => s.kind === 'arc' && s.startAngle === 0 && s.endAngle === 360
			);
			return fullCircle && fullCircle.kind === 'arc' ? fullCircle.radius : 0;
		};
		expect(radiusOf(offset.segments)).toBeCloseTo(radiusOf(tight.segments) + 0.15, 6);
	});
});
