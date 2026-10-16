<script lang="ts">
	import type { GCodeProgram, Bounds } from '$lib/preview/gcode';
	import type { BoardScene } from '$lib/preview/scene';
	import { PanZoom } from '$lib/preview/panZoom.svelte';

	/** Affine map from the board model (mm, Y-up) into machine output coordinates. */
	export interface GhostTransform {
		a: number;
		d: number;
		e: number;
		f: number;
	}

	let {
		program,
		units,
		toolDiameter,
		ghost = null
	}: {
		program: GCodeProgram;
		units: 'mm' | 'inch';
		/** Cutting width to draw under each cut, in output units. */
		toolDiameter: number;
		/** The designed copper, drawn under the toolpath for comparison. */
		ghost?: { scene: BoardScene; transform: GhostTransform } | null;
	} = $props();

	const moves = $derived(program.moves);

	// Step-through: how many moves are drawn. Reset to "all" whenever a new
	// program arrives.
	let shown = $state(0);
	let shownFor: GCodeProgram | null = null;
	$effect(() => {
		if (shownFor !== program) {
			shownFor = program;
			shown = program.moves.length;
		}
	});

	let showRapids = $state(true);
	let showGhost = $state(true);

	// The slider value can briefly exceed a newly arrived (shorter) program's
	// length before the effect above resets it, so always clamp.
	const count = $derived(Math.min(shown, moves.length));
	const visible = $derived(moves.slice(0, count));
	const current = $derived(count > 0 && count < moves.length ? moves[count - 1] : null);
	const toolPosition = $derived(count > 0 ? moves[count - 1].to : null);

	const ghostCorners = $derived.by(() => {
		if (!ghost) return null;
		const { a, d, e, f } = ghost.transform;
		const xs = [e, a * ghost.scene.width + e];
		const ys = [f, d * ghost.scene.height + f];
		return {
			minX: Math.min(...xs),
			maxX: Math.max(...xs),
			minY: Math.min(...ys),
			maxY: Math.max(...ys)
		};
	});

	const fullView = $derived.by(() => {
		let bounds: Bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
		const include = (other: Bounds | null) => {
			if (!other) return;
			bounds = {
				minX: Math.min(bounds.minX, other.minX),
				maxX: Math.max(bounds.maxX, other.maxX),
				minY: Math.min(bounds.minY, other.minY),
				maxY: Math.max(bounds.maxY, other.maxY)
			};
		};
		include(program.bounds);
		include(ghostCorners);
		const spanX = Math.max(bounds.maxX - bounds.minX, 1e-3);
		const spanY = Math.max(bounds.maxY - bounds.minY, 1e-3);
		const pad = Math.max(spanX, spanY) * 0.06;
		return {
			x: bounds.minX - pad,
			y: bounds.minY - pad,
			w: spanX + 2 * pad,
			h: spanY + 2 * pad
		};
	});

	const panZoom = new PanZoom();
	let initializedFor = $state('');
	$effect(() => {
		const key = `${fullView.x}|${fullView.y}|${fullView.w}|${fullView.h}`;
		if (initializedFor !== key) {
			initializedFor = key;
			panZoom.reset(fullView, fullView.w / 400, fullView.w * 4);
		}
	});
	const attach = (element: SVGSVGElement) => panZoom.attach(element);

	// Screen-constant sizes expressed in model units for the current zoom.
	const px = $derived(panZoom.unitsPerPixel);

	const fmtLength = (value: number) => (units === 'mm' ? value.toFixed(1) : value.toFixed(2));
	const fmtZ = (value: number) => (units === 'mm' ? value.toFixed(3) : value.toFixed(4));
	const fmtTime = (minutes: number) => {
		if (minutes < 1) return `${Math.round(minutes * 60)} s`;
		if (minutes < 60) return `${minutes.toFixed(1)} min`;
		return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
	};

	function step(delta: number) {
		shown = Math.min(Math.max(count + delta, 0), moves.length);
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			step(event.shiftKey ? 10 : 1);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			step(event.shiftKey ? -10 : -1);
		} else if (event.key === 'Home') {
			event.preventDefault();
			shown = 0;
		} else if (event.key === 'End') {
			event.preventDefault();
			shown = moves.length;
		}
	}
</script>

<div class="relative">
	<svg
		use:attach
		viewBox={panZoom.viewBox}
		class="h-full max-h-[60vh] min-h-64 w-full touch-none rounded-xl border border-slate-200 bg-slate-100 {panZoom.panning
			? 'cursor-grabbing'
			: 'cursor-grab'}"
		preserveAspectRatio="xMidYMid meet"
		onwheel={panZoom.onwheel}
		onpointerdown={panZoom.onpointerdown}
		onpointermove={panZoom.onpointermove}
		onpointerup={panZoom.onpointerup}
		role="img"
		aria-label="GCode toolpath preview"
	>
		<!-- Machine space is Y-up; SVG is Y-down, so flip. -->
		<g transform="scale(1 -1)">
			{#if ghost && showGhost}
				{@const t = ghost.transform}
				<!-- Designed copper, mapped into machine coordinates with the same
				     mirror / zero / unit transform the GCode went through. -->
				<g transform="matrix({t.a} 0 0 {t.d} {t.e} {t.f})" opacity="0.55">
					<rect
						x="0"
						y="0"
						width={ghost.scene.width}
						height={ghost.scene.height}
						fill="#fef3c7"
						stroke="#94a3b8"
						stroke-width={px / Math.abs(t.a)}
					/>
					{#each ghost.scene.tracks as track, index (index)}
						<line
							x1={track.x1}
							y1={track.y1}
							x2={track.x2}
							y2={track.y2}
							stroke="#f59e0b"
							stroke-width={track.width}
							stroke-linecap="round"
						/>
					{/each}
					{#each ghost.scene.pads as pad, index (index)}
						{#if pad.circle}
							<circle cx={pad.circle.cx} cy={pad.circle.cy} r={pad.circle.r} fill="#f59e0b" />
						{:else if pad.path}
							<path d={pad.path} fill="#f59e0b" />
						{/if}
					{/each}
					{#each ghost.scene.outline as path, index (index)}
						<path d={path} fill="none" stroke="#475569" stroke-width={(1.5 * px) / Math.abs(t.a)} />
					{/each}
					{#each ghost.scene.drills as drill, index (index)}
						<circle cx={drill.cx} cy={drill.cy} r={drill.r} fill="#fffbeb" />
					{/each}
					{#each ghost.scene.registration as hole, index (index)}
						<circle
							cx={hole.cx}
							cy={hole.cy}
							r={hole.r}
							fill="none"
							stroke="#dc2626"
							stroke-width={px / Math.abs(t.a)}
							stroke-dasharray="{(3 * px) / Math.abs(t.a)} {(2 * px) / Math.abs(t.a)}"
						/>
					{/each}
				</g>
			{/if}

			<!-- Machine origin -->
			<g stroke="#64748b" stroke-width={px}>
				<line x1={-12 * px} y1="0" x2={12 * px} y2="0" />
				<line x1="0" y1={-12 * px} x2="0" y2={12 * px} />
			</g>
			<circle cx="0" cy="0" r={3 * px} fill="none" stroke="#64748b" stroke-width={px} />

			<!-- Kerf: the width the tool actually removes -->
			{#each visible as move, index (index)}
				{#if move.kind === 'cut' && move.d}
					<path
						d={move.d}
						fill="none"
						stroke="#4ade80"
						stroke-opacity="0.45"
						stroke-width={toolDiameter}
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				{/if}
			{/each}

			<!-- Rapids and air moves -->
			{#if showRapids}
				{#each visible as move, index (index)}
					{#if move.kind === 'rapid' && move.d}
						<path
							d={move.d}
							fill="none"
							stroke="#94a3b8"
							stroke-width={px}
							stroke-dasharray="{4 * px} {3 * px}"
						/>
					{:else if move.kind === 'air' && move.d}
						<path
							d={move.d}
							fill="none"
							stroke="#2563eb"
							stroke-width={px}
							stroke-dasharray="{2 * px} {2 * px}"
						/>
					{/if}
				{/each}
			{/if}

			<!-- Cut centerlines -->
			{#each visible as move, index (index)}
				{#if move.kind === 'cut' && move.d}
					<path d={move.d} fill="none" stroke="#166534" stroke-width={1.2 * px} />
				{/if}
			{/each}

			<!-- Plunges -->
			{#each visible as move, index (index)}
				{#if move.kind === 'plunge'}
					<circle
						cx={move.to.x}
						cy={move.to.y}
						r={Math.max(toolDiameter / 2, 2.5 * px)}
						fill="#f87171"
						fill-opacity="0.6"
						stroke="#b91c1c"
						stroke-width={px}
					/>
				{/if}
			{/each}

			<!-- Current move + tool position while stepping -->
			{#if current?.d}
				<path d={current.d} fill="none" stroke="#2563eb" stroke-width={3 * px} />
			{/if}
			{#if toolPosition && count < moves.length}
				<circle
					cx={toolPosition.x}
					cy={toolPosition.y}
					r={5 * px}
					fill={toolPosition.z <= 0 ? '#2563eb' : 'none'}
					stroke="#2563eb"
					stroke-width={1.5 * px}
				/>
			{/if}
		</g>
	</svg>

	<button
		type="button"
		onclick={() => panZoom.fit()}
		class="absolute top-2 right-2 rounded-lg bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow hover:bg-white"
	>
		Fit
	</button>

	<div
		class="absolute bottom-2 left-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-700 shadow"
	>
		<span class="flex items-center gap-1">
			<span class="inline-block h-1.5 w-4 rounded-sm bg-green-400"></span> Cut (tool width)
		</span>
		<label class="flex cursor-pointer items-center gap-1">
			<input type="checkbox" class="h-3 w-3 rounded" bind:checked={showRapids} />
			<span class="inline-block h-px w-4 border-t border-dashed border-slate-500"></span> Rapid
		</label>
		<span class="flex items-center gap-1">
			<span class="inline-block h-3 w-3 rounded-full border border-red-700 bg-red-400/60"></span> Plunge
		</span>
		{#if ghost}
			<label class="flex cursor-pointer items-center gap-1">
				<input type="checkbox" class="h-3 w-3 rounded" bind:checked={showGhost} />
				<span class="inline-block h-3 w-3 rounded-sm bg-amber-400/60"></span> Designed copper
			</label>
		{/if}
	</div>
</div>

<!-- Step-through -->
<div class="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			onclick={() => (shown = 0)}
			class="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
			title="Start">⏮</button
		>
		<button
			type="button"
			onclick={() => step(-1)}
			class="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
			title="Previous move (←, shift for 10)">◀</button
		>
		<input
			type="range"
			min="0"
			max={moves.length}
			bind:value={shown}
			onkeydown={handleKey}
			class="min-w-40 flex-1 accent-amber-600"
			aria-label="Moves shown"
		/>
		<button
			type="button"
			onclick={() => step(1)}
			class="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
			title="Next move (→, shift for 10)">▶</button
		>
		<button
			type="button"
			onclick={() => (shown = moves.length)}
			class="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
			title="End">⏭</button
		>
		<span class="w-28 text-right text-slate-600 tabular-nums">{count} / {moves.length} moves</span>
	</div>
	{#if current}
		<p class="mt-2 truncate font-mono text-xs text-slate-700">
			<span class="text-slate-400">line {current.line}:</span>
			{current.text}
			<span class="text-slate-400">
				→ X{fmtZ(current.to.x)} Y{fmtZ(current.to.y)} Z{fmtZ(current.to.z)} ({current.kind})
			</span>
		</p>
	{:else if count === 0}
		<p class="mt-2 text-xs text-slate-500">
			Drag the slider or use ← → to step through the program one move at a time.
		</p>
	{/if}
</div>

<!-- Stats -->
<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
	<div>
		<dt class="text-slate-400">Cutting</dt>
		<dd class="font-medium text-slate-800">{fmtLength(program.stats.cutLength)} {units}</dd>
	</div>
	<div>
		<dt class="text-slate-400">Rapid travel</dt>
		<dd class="font-medium text-slate-800">{fmtLength(program.stats.rapidLength)} {units}</dd>
	</div>
	<div>
		<dt class="text-slate-400">Plunges</dt>
		<dd class="font-medium text-slate-800">{program.stats.plungeCount}</dd>
	</div>
	<div>
		<dt class="text-slate-400">Feed time (excl. rapids)</dt>
		<dd class="font-medium text-slate-800">{fmtTime(program.stats.feedMinutes)}</dd>
	</div>
	<div>
		<dt class="text-slate-400">Z range</dt>
		<dd class="font-medium text-slate-800">
			{#if program.stats.minZ !== null && program.stats.maxZ !== null}
				{fmtZ(program.stats.minZ)} to {fmtZ(program.stats.maxZ)} {units}
			{:else}
				—
			{/if}
		</dd>
	</div>
	<div>
		<dt class="text-slate-400">Spindle</dt>
		<dd class="font-medium text-slate-800">
			{program.stats.spindleRPM !== null ? `${program.stats.spindleRPM} rpm` : '—'}
		</dd>
	</div>
	<div>
		<dt class="text-slate-400">Units in file</dt>
		<dd class="font-medium text-slate-800">{program.units ?? 'not declared'}</dd>
	</div>
	<div>
		<dt class="text-slate-400">Cut extent</dt>
		<dd class="font-medium text-slate-800">
			{#if program.cutBounds}
				{fmtLength(program.cutBounds.maxX - program.cutBounds.minX)} × {fmtLength(
					program.cutBounds.maxY - program.cutBounds.minY
				)}
				{units}
			{:else}
				—
			{/if}
		</dd>
	</div>
</dl>

{#if program.issues.length}
	<div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
		<h3 class="text-sm font-bold text-red-900">
			{program.issues.length} problem{program.issues.length === 1 ? '' : 's'} found in this GCode
		</h3>
		<ul class="mt-1 space-y-1 text-sm text-red-800">
			{#each program.issues.slice(0, 20) as issue, index (index)}
				<li>
					<span class="font-mono text-xs text-red-500">line {issue.line}:</span>
					{issue.message}
					{#if issue.text}<code class="ml-1 text-xs text-red-600">{issue.text}</code>{/if}
				</li>
			{/each}
			{#if program.issues.length > 20}
				<li class="text-red-500">…and {program.issues.length - 20} more</li>
			{/if}
		</ul>
	</div>
{:else}
	<p class="mt-4 text-sm text-emerald-700">
		No problems found: no rapids with the tool down, every arc is consistent, and the spindle is on
		for every cut.
	</p>
{/if}
