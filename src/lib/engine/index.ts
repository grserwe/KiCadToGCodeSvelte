/**
 * Public engine API — pure TypeScript, runs in the browser (Web Worker) and
 * in vitest. Pipeline: parseBoard() → buildLayerToolpath() → generateGCode().
 */
export { parseBoard, type ParseBoardResult } from './parser/parseBoard';
export { BoardParseError } from './parser/errors';
export { buildLayerToolpath, type LayerToolpath, type ToolpathOptions } from './toolpath/assemble';
export { generateGCode, type GCodeFile, type GenerateResult } from './gcode/emit';
export {
	defaultSettings,
	effectiveToolDiameterMm,
	type GCodeSettings,
	type XYZeroPosition
} from './gcode/settings';
export type { BoardModel, EngineWarning, LayerId, Pad, PadShape, Track, Vec2 } from './model/types';
export type { PathSegment, LineSeg, ArcSeg } from './toolpath/segments';
