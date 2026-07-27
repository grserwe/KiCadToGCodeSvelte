import type { BoardModel, EngineWarning } from '../engine/model/types';
import type { GCodeFile } from '../engine/gcode/emit';
import type { GCodeSettings } from '../engine/gcode/settings';
import type { EngineRequest, EngineResponse } from './engine.worker';

export interface ConversionResult {
	board: BoardModel;
	warnings: EngineWarning[];
	files: GCodeFile[];
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
	number,
	{ resolve: (result: ConversionResult) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event: MessageEvent<EngineResponse>) => {
			const response = event.data;
			const handlers = pending.get(response.id);
			if (!handlers) return;
			pending.delete(response.id);
			if (response.ok) {
				handlers.resolve({
					board: response.board!,
					warnings: response.warnings ?? [],
					files: response.files ?? []
				});
			} else {
				handlers.reject(new Error(response.error ?? 'Conversion failed'));
			}
		};
	}
	return worker;
}

/** Parse a board and generate all GCode files, off the main thread. */
export function convertBoard(
	fileContents: string,
	boardName: string,
	settings: GCodeSettings
): Promise<ConversionResult> {
	return new Promise((resolve, reject) => {
		const request: EngineRequest = {
			id: nextId++,
			fileContents,
			boardName,
			settings,
			generatedAt: Date.now()
		};
		pending.set(request.id, { resolve, reject });
		getWorker().postMessage(request);
	});
}
