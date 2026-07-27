<script lang="ts">
	import type { BoardScene } from '$lib/preview/scene';
	import { drillDiameters } from '$lib/preview/scene';

	let {
		scene,
		mirrored = false
	}: {
		scene: BoardScene;
		/** Render as machined (bottom side flipped left-right). */
		mirrored?: boolean;
	} = $props();

	const DRILL_COLORS = ['#0f172a', '#1d4ed8', '#7c3aed', '#0e7490', '#be123c', '#4d7c0f'];

	const margin = $derived(Math.max(scene.registration.length ? 10 : 2, 2));
	const fullView = $derived({
		x: -margin,
		y: -2,
		w: scene.width + 2 * margin,
		h: scene.height + 4
	});

	let view = $state({ x: 0, y: 0, w: 0, h: 0 });
	let initializedFor = $state('');

	$effect(() => {
		const key = `${scene.width}x${scene.height}x${margin}`;
		if (initializedFor !== key) {
			initializedFor = key;
			view = { ...fullView };
		}
	});

	const diameters = $derived(drillDiameters(scene));
	const drillColor = (diameter: number) =>
		DRILL_COLORS[diameters.indexOf(diameter) % DRILL_COLORS.length];

	let svgElement: SVGSVGElement;
	let panning = $state(false);
	let panStart = { x: 0, y: 0, viewX: 0, viewY: 0 };

	function svgPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
		const rect = svgElement.getBoundingClientRect();
		return {
			x: view.x + ((event.clientX - rect.left) / rect.width) * view.w,
			y: view.y + ((event.clientY - rect.top) / rect.height) * view.h
		};
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();
		const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
		const focus = svgPoint(event);
		const newW = Math.min(Math.max(view.w * factor, scene.width / 50), fullView.w * 4);
		const scaleChange = newW / view.w;
		view = {
			x: focus.x - (focus.x - view.x) * scaleChange,
			y: focus.y - (focus.y - view.y) * scaleChange,
			w: newW,
			h: view.h * scaleChange
		};
	}

	function handlePointerDown(event: PointerEvent) {
		panning = true;
		panStart = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
		svgElement.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!panning) return;
		const rect = svgElement.getBoundingClientRect();
		view.x = panStart.viewX - ((event.clientX - panStart.x) / rect.width) * view.w;
		view.y = panStart.viewY + ((event.clientY - panStart.y) / rect.height) * view.h;
	}

	function fit() {
		view = { ...fullView };
	}
</script>

<div class="relative">
	<svg
		bind:this={svgElement}
		viewBox="{view.x} {-(view.y + view.h)} {view.w} {view.h}"
		class="h-full max-h-[60vh] min-h-64 w-full touch-none rounded-xl border border-slate-200 bg-amber-50/60 {panning
			? 'cursor-grabbing'
			: 'cursor-grab'}"
		preserveAspectRatio="xMidYMid meet"
		onwheel={handleWheel}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={() => (panning = false)}
		role="img"
		aria-label="Board preview"
	>
		<!-- Model space is Y-up; SVG is Y-down, so flip. Optionally mirror X
		     to show the bottom side as it sits on the machine. -->
		<g transform="scale(1 -1) {mirrored ? `translate(${scene.width} 0) scale(-1 1)` : ''}">
			<rect
				x="0"
				y="0"
				width={scene.width}
				height={scene.height}
				fill="#fef3c7"
				stroke="#94a3b8"
				stroke-width="0.08"
			/>

			{#each scene.tracks as track, index (index)}
				<line
					x1={track.x1}
					y1={track.y1}
					x2={track.x2}
					y2={track.y2}
					stroke="#d97706"
					stroke-width={track.width}
					stroke-linecap="round"
				/>
			{/each}

			{#each scene.pads as pad, index (index)}
				{#if pad.circle}
					<circle cx={pad.circle.cx} cy={pad.circle.cy} r={pad.circle.r} fill="#d97706" />
				{:else if pad.path}
					<path d={pad.path} fill="#d97706" />
				{/if}
			{/each}

			{#each scene.toolpath as path, index (index)}
				<path d={path} fill="none" stroke="#166534" stroke-width="0.07" />
			{/each}

			{#each scene.drills as drill, index (index)}
				<circle
					cx={drill.cx}
					cy={drill.cy}
					r={drill.r}
					fill="#fffbeb"
					stroke={drillColor(drill.diameterMm)}
					stroke-width="0.1"
				/>
			{/each}

			{#each scene.registration as hole, index (index)}
				<circle
					cx={hole.cx}
					cy={hole.cy}
					r={hole.r}
					fill="none"
					stroke="#dc2626"
					stroke-width="0.12"
					stroke-dasharray="0.3 0.2"
				/>
			{/each}
		</g>
	</svg>

	<button
		type="button"
		onclick={fit}
		class="absolute top-2 right-2 rounded-lg bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow hover:bg-white"
	>
		Fit board
	</button>

	<div
		class="absolute bottom-2 left-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-700 shadow"
	>
		<span class="flex items-center gap-1">
			<span class="inline-block h-3 w-3 rounded-sm bg-amber-600"></span> Copper
		</span>
		<span class="flex items-center gap-1">
			<span class="inline-block h-0.5 w-4 bg-green-800"></span> Engraving path
		</span>
		{#each diameters as diameter (diameter)}
			<span class="flex items-center gap-1">
				<span
					class="inline-block h-3 w-3 rounded-full border-2 bg-white"
					style="border-color: {drillColor(diameter)}"
				></span>
				{diameter} mm drill
			</span>
		{/each}
		{#if scene.registration.length}
			<span class="flex items-center gap-1">
				<span class="inline-block h-3 w-3 rounded-full border-2 border-dashed border-red-600"
				></span> Registration
			</span>
		{/if}
	</div>
</div>
