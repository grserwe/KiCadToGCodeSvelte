import type { LayerId } from '../model/types';

/** One downloadable output: a GCode program or the silkscreen SVG. */
export interface GCodeFile {
	fileName: string;
	/** Human-readable purpose shown in the download list. */
	label: string;
	kind:
		| 'isolation-top'
		| 'isolation-bottom'
		| 'drill'
		| 'registration'
		| 'silkscreen-top'
		| 'silkscreen-bottom';
	drillDiameterMm?: number;
	/**
	 * For GCode programs: which board face is up when this file runs, and
	 * whether the output was mirrored for flip-over machining. Lets the viewer
	 * draw the designed copper under the toolpath in machine coordinates.
	 */
	machining?: {
		facing: LayerId;
		sideMirror: boolean;
	};
	content: string;
}
