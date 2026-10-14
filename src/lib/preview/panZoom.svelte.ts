/**
 * Wheel-zoom and drag-pan for an SVG whose model space is Y-up (the viewBox
 * flips Y). Shared by the board preview and the GCode viewer.
 */

export interface ViewRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export class PanZoom {
	view = $state<ViewRect>({ x: 0, y: 0, w: 1, h: 1 });
	panning = $state(false);

	#full: ViewRect = { x: 0, y: 0, w: 1, h: 1 };
	#minWidth = 0.01;
	#maxWidth = 4;
	#panStart = { x: 0, y: 0, viewX: 0, viewY: 0 };
	#element: SVGSVGElement | undefined;

	/** Bind the SVG element so pointer positions map into the view. */
	attach(element: SVGSVGElement) {
		this.#element = element;
	}

	/** Set the fit-all extent (and zoom limits) and snap the view to it. */
	reset(full: ViewRect, minWidth: number, maxWidth: number) {
		this.#full = { ...full };
		this.#minWidth = minWidth;
		this.#maxWidth = maxWidth;
		this.view = { ...full };
	}

	fit() {
		this.view = { ...this.#full };
	}

	/** SVG viewBox string: Y-up model space shown in Y-down SVG. */
	get viewBox(): string {
		return `${this.view.x} ${-(this.view.y + this.view.h)} ${this.view.w} ${this.view.h}`;
	}

	/** Model-space size of one on-screen pixel (for hairlines and markers). */
	get unitsPerPixel(): number {
		const width = this.#element?.getBoundingClientRect().width || 600;
		return this.view.w / width;
	}

	#point(event: PointerEvent | WheelEvent): { x: number; y: number } {
		const rect = this.#element!.getBoundingClientRect();
		return {
			x: this.view.x + ((event.clientX - rect.left) / rect.width) * this.view.w,
			y: this.view.y + ((event.clientY - rect.top) / rect.height) * this.view.h
		};
	}

	onwheel = (event: WheelEvent) => {
		event.preventDefault();
		const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
		const focus = this.#point(event);
		const newW = Math.min(Math.max(this.view.w * factor, this.#minWidth), this.#maxWidth);
		const scaleChange = newW / this.view.w;
		this.view = {
			x: focus.x - (focus.x - this.view.x) * scaleChange,
			y: focus.y - (focus.y - this.view.y) * scaleChange,
			w: newW,
			h: this.view.h * scaleChange
		};
	};

	onpointerdown = (event: PointerEvent) => {
		this.panning = true;
		this.#panStart = {
			x: event.clientX,
			y: event.clientY,
			viewX: this.view.x,
			viewY: this.view.y
		};
		this.#element!.setPointerCapture(event.pointerId);
	};

	onpointermove = (event: PointerEvent) => {
		if (!this.panning) return;
		const rect = this.#element!.getBoundingClientRect();
		this.view.x =
			this.#panStart.viewX - ((event.clientX - this.#panStart.x) / rect.width) * this.view.w;
		this.view.y =
			this.#panStart.viewY + ((event.clientY - this.#panStart.y) / rect.height) * this.view.h;
	};

	onpointerup = () => {
		this.panning = false;
	};
}
