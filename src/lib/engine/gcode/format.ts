/** Fixed-point formatting: 4 decimals for coordinates, 1 for feed rates. */
export const coord = (value: number): string => (Object.is(value, -0) ? 0 : value).toFixed(4);
export const feed = (value: number): string => value.toFixed(1);

export const rapidZ = (z: number): string => `G00 Z${coord(z)}`;
export const rapidXY = (x: number, y: number, feedRate?: number): string =>
	`G00 X${coord(x)} Y${coord(y)}${feedRate !== undefined ? ` F${feed(feedRate)}` : ''}`;
export const moveZ = (z: number, feedRate: number): string => `G01 Z${coord(z)} F${feed(feedRate)}`;
export const moveXY = (x: number, y: number, feedRate?: number): string =>
	`G01 X${coord(x)} Y${coord(y)}${feedRate !== undefined ? ` F${feed(feedRate)}` : ''}`;

export const useUnits = (units: 'mm' | 'inch'): string =>
	units === 'inch' ? 'G20 (Use Inches)' : 'G21 (Use Millimeters)';
export const absoluteCoordinates = 'G90 (Set Absolute Coordinates)';
export const xyPlane = 'G17 (XY Plane Selection)';
export const startSpindle = (rpm: number): string => `M03 S${rpm} (Start Spindle)`;
export const stopSpindle = 'M05 (Stop Spindle)';
export const pause = 'G04 P1 (Pause)';
export const endProgram = 'M02 (End Program)';

export const arcMove = (
	clockwise: boolean,
	endX: number,
	endY: number,
	iOffset: number,
	jOffset: number
): string =>
	`${clockwise ? 'G02' : 'G03'} X${coord(endX)} Y${coord(endY)} I${coord(iOffset)} J${coord(jOffset)}`;
