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
	content: string;
}
