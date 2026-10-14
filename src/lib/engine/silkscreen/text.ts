import type { Graphic, Vec2 } from '../model/types';
import { NEWSTROKE_ASCII } from './newstroke';

export type TextGraphic = Extract<Graphic, { kind: 'text' }>;

/**
 * KiCad's stroke-font text layout, reproduced from STROKE_FONT /
 * FONT::getLinePositions (common/font/*.cpp) and verified against
 * kicad-cli's SVG export. All constants below are KiCad's.
 */
const STROKE_FONT_SCALE = 1 / 21;
const FONT_OFFSET = -8;
const ITALIC_TILT = 1 / 8;
/** First line's share of the text height ("a fudge to match 6.0 positioning"). */
const FIRST_LINE_HEIGHT = 1.17;
/** Interline pitch for the stroke font (METRICS default × the stroke font's legacy factor). */
const INTERLINE = 1.68 * 0.9583;
const REPLACEMENT_INDEX = '?'.charCodeAt(0) - 0x20;

interface Glyph {
	/** Advance width in font units (1 = text height). */
	width: number;
	/** Polylines in font units, Y-down like KiCad, baseline near y = 0. */
	strokes: Vec2[][];
}

const glyphCache: (Glyph | undefined)[] = [];

function glyphAt(index: number): Glyph {
	let glyph = glyphCache[index];
	if (!glyph) {
		glyph = decodeGlyph(NEWSTROKE_ASCII[index]);
		glyphCache[index] = glyph;
	}
	return glyph;
}

/** Decode a Hershey-format glyph string exactly as STROKE_FONT::loadNewStrokeFont does. */
export function decodeGlyph(encoded: string): Glyph {
	const R = 'R'.charCodeAt(0);
	const startX = (encoded.charCodeAt(0) - R) * STROKE_FONT_SCALE;
	const endX = (encoded.charCodeAt(1) - R) * STROKE_FONT_SCALE;
	const strokes: Vec2[][] = [];
	let current: Vec2[] = [];

	for (let i = 2; i + 1 < encoded.length; i += 2) {
		if (encoded[i] === ' ' && encoded[i + 1] === 'R') {
			if (current.length) strokes.push(current);
			current = [];
			continue;
		}
		current.push({
			x: (encoded.charCodeAt(i) - R) * STROKE_FONT_SCALE - startX,
			y: (encoded.charCodeAt(i + 1) - R + FONT_OFFSET) * STROKE_FONT_SCALE
		});
	}
	if (current.length) strokes.push(current);

	return { width: endX - startX, strokes };
}

export interface RenderedText {
	/** Polylines in board-local Y-up millimetres. */
	strokes: Vec2[][];
	/** Characters outside the ASCII font, drawn as '?'. */
	missingGlyphs: number;
}

/** Lay out and place a text item, returning its strokes in board coordinates. */
export function renderText(text: TextGraphic): RenderedText {
	const { size, thickness } = text;
	const lines = text.text.split('\n');
	const spaceWidth = glyphAt(0).width;
	let missingGlyphs = 0;

	const interline = size.y * INTERLINE;
	const height = size.y * FIRST_LINE_HEIGHT + (lines.length - 1) * interline;

	// Block offset (KiCad's `offset` in getLinePositions), Y-down local frame.
	const offset: Vec2 = { x: thickness / 1.52, y: size.y - thickness * 0.052 };
	if (text.justify.vertical === 'center') offset.y -= height / 2;
	else if (text.justify.vertical === 'bottom') offset.y -= height;

	const tilt = text.italic ? ITALIC_TILT : 0;
	const radians = (text.rotationDeg * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const mirrorX = text.mirrored ? -1 : 1;

	// Local Y-down (KiCad) → board Y-up, rotated CCW about the anchor.
	const toBoard = (local: Vec2): Vec2 => {
		const x = local.x * mirrorX;
		const y = -local.y;
		return {
			x: text.position.x + x * cos - y * sin,
			y: text.position.y + x * sin + y * cos
		};
	};

	const strokes: Vec2[][] = [];

	lines.forEach((line, lineIndex) => {
		const glyphs = [...line].map((character) => {
			if (character === ' ') return null;
			const code = character.codePointAt(0) ?? 0;
			let index = code - 0x20;
			if (index < 0 || index >= NEWSTROKE_ASCII.length) {
				missingGlyphs++;
				index = REPLACEMENT_INDEX;
			}
			return glyphAt(index);
		});

		const lineWidth = glyphs.reduce(
			(sum, glyph) => sum + (glyph ? glyph.width : spaceWidth) * size.x,
			0
		);

		const lineOffset: Vec2 = { x: offset.x, y: offset.y + lineIndex * interline };
		if (text.justify.horizontal === 'center') lineOffset.x = -lineWidth / 2;
		else if (text.justify.horizontal === 'right') lineOffset.x = -(lineWidth + offset.x);

		let cursorX = lineOffset.x;
		for (const glyph of glyphs) {
			if (!glyph) {
				cursorX += spaceWidth * size.x;
				continue;
			}
			for (const stroke of glyph.strokes) {
				strokes.push(
					stroke.map((point) => {
						const x = point.x * size.x - point.y * size.y * tilt + cursorX;
						const y = point.y * size.y + lineOffset.y;
						return toBoard({ x, y });
					})
				);
			}
			cursorX += glyph.width * size.x;
		}
	});

	return { strokes, missingGlyphs };
}

/**
 * Rendered strokes as SVG path strings (one per stroke), with `map` carrying
 * board points into the target frame.
 */
export function strokesToSvgPaths(strokes: Vec2[][], map: (point: Vec2) => Vec2): string[] {
	return strokes.map((stroke) => {
		const points = stroke.map(map);
		return (
			`M ${fmt(points[0])}` +
			points
				.slice(1)
				.map((p) => ` L ${fmt(p)}`)
				.join('')
		);
	});
}

const round = (value: number): number => Math.round(value * 1e5) / 1e5;
const fmt = (point: Vec2): string => `${round(point.x)} ${round(point.y)}`;
