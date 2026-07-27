import { parseSExpression } from '../sexpr/tokenizer';
import type { BoardModel, EngineWarning, Pad, Track, Vec2 } from '../model/types';
import { dialectForVersion } from './dialect';
import { BoardParseError } from './errors';
import { computeExtents, type FileExtents } from './extents';
import { extractPads } from './pads';
import { extractTracks } from './tracks';
import { childNumber } from './sexprHelpers';

export interface ParseBoardResult {
	board: BoardModel;
	warnings: EngineWarning[];
}

/**
 * Parse `.kicad_pcb` file contents into a BoardModel.
 *
 * The result is in board-local coordinates: millimeters, Y-up, origin at the
 * board's lower-left corner (KiCad files are Y-down; converted here).
 * Recoverable problems are collected as warnings; only an unusable file
 * throws BoardParseError.
 */
export function parseBoard(fileContents: string): ParseBoardResult {
	let root;
	try {
		root = parseSExpression(fileContents);
	} catch (error) {
		throw new BoardParseError(
			`This file is not a readable KiCad board file: ${(error as Error).message}`
		);
	}

	if (root.name.toLowerCase() !== 'kicad_pcb') {
		throw new BoardParseError(
			`Expected a KiCad PCB file starting with "(kicad_pcb", found "(${root.name}".`
		);
	}

	const fileVersion = childNumber(root, 'version');
	if (fileVersion === undefined) {
		throw new BoardParseError('The file has no KiCad version record.');
	}

	const warnings: EngineWarning[] = [];
	const dialect = dialectForVersion(fileVersion);

	const rawTracks = extractTracks(root, warnings);
	const rawPads = extractPads(root, dialect, warnings);
	const extents = computeExtents(root, rawPads, rawTracks);

	// File coords (Y-down, absolute) → board-local (Y-up, origin lower-left).
	const toLocal = (point: Vec2): Vec2 => ({
		x: point.x - extents.minX,
		y: extents.maxY - point.y
	});

	const tracks: Track[] = rawTracks.map((track) => ({
		start: toLocal(track.start),
		end: toLocal(track.end),
		width: track.width,
		layer: track.layer
	}));

	const pads: Pad[] = rawPads.map((pad) => ({
		...pad,
		position: toLocal(pad.position),
		shape:
			pad.shape.kind === 'polygon'
				? {
						kind: 'polygon',
						// Pad-local points flip Y with the board; rotation stays CCW.
						points: pad.shape.points.map((p) => ({ x: p.x, y: -p.y }))
					}
				: pad.shape
	}));

	return {
		board: {
			width: width(extents),
			height: height(extents),
			fileVersion,
			tracks,
			pads
		},
		warnings
	};
}

const width = (extents: FileExtents): number => extents.maxX - extents.minX;
const height = (extents: FileExtents): number => extents.maxY - extents.minY;
