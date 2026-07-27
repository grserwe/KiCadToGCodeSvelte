/**
 * Web Worker running the conversion engine off the main thread. The board
 * never leaves the browser — this worker is the whole "backend".
 */
import { parseBoard } from '../engine/parser/parseBoard';
import { generateGCode } from '../engine/gcode/emit';
import type { GCodeSettings } from '../engine/gcode/settings';

export interface EngineRequest {
	id: number;
	fileContents: string;
	boardName: string;
	settings: GCodeSettings;
	generatedAt: number;
}

export interface EngineResponse {
	id: number;
	ok: boolean;
	error?: string;
	board?: import('../engine/model/types').BoardModel;
	warnings?: import('../engine/model/types').EngineWarning[];
	files?: import('../engine/gcode/emit').GCodeFile[];
}

self.onmessage = (event: MessageEvent<EngineRequest>) => {
	const request = event.data;
	try {
		const { board, warnings } = parseBoard(request.fileContents);
		const generation = generateGCode(
			board,
			request.boardName,
			request.settings,
			new Date(request.generatedAt)
		);
		const response: EngineResponse = {
			id: request.id,
			ok: true,
			board,
			warnings: [...warnings, ...generation.warnings],
			files: generation.files
		};
		self.postMessage(response);
	} catch (error) {
		const response: EngineResponse = {
			id: request.id,
			ok: false,
			error: (error as Error).message
		};
		self.postMessage(response);
	}
};
