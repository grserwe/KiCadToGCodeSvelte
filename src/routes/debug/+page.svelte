<script lang="ts">
	import { dev } from '$app/environment';
	import { parseBoard } from '$lib/engine/parser/parseBoard';
	import { buildLayerToolpath } from '$lib/engine/toolpath/assemble';
	import { segmentToSvgPath } from '$lib/preview/svgPath';
	import type { BoardModel, LayerId } from '$lib/engine/model/types';

	// Dev-only visual scratchpad for the geometry engine: drop a .kicad_pcb
	// and eyeball the raw toolpath segments. Replaced by the real preview UI.
	let board = $state<BoardModel | null>(null);
	let error = $state('');
	let layer = $state<LayerId>('top');
	let isolationOffset = $state(0.1);

	const toolpath = $derived(
		board
			? buildLayerToolpath(board, layer, {
					isolationOffset,
					minimumTrackWidth: 0.1,
					minimumPadDiameter: 1.5
				})
			: null
	);

	async function fileSelected(event: Event) {
		error = '';
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			board = parseBoard(await file.text()).board;
		} catch (parseError) {
			board = null;
			error = (parseError as Error).message;
		}
	}

	async function loadSample() {
		error = '';
		try {
			const response = await fetch('/samples/TopAndBottomLayer.kicad_pcb');
			board = parseBoard(await response.text()).board;
		} catch (parseError) {
			board = null;
			error = (parseError as Error).message;
		}
	}
</script>

<svelte:head>
	<title>Toolpath debug</title>
</svelte:head>

{#if !dev}
	<p class="p-8">Not available.</p>
{:else}
	<main class="flex min-h-screen flex-col gap-4 p-6">
		<h1 class="text-xl font-bold">Toolpath debug</h1>
		<div class="flex items-center gap-4">
			<input type="file" accept=".kicad_pcb" onchange={fileSelected} />
			<button
				type="button"
				onclick={loadSample}
				class="rounded bg-slate-700 px-3 py-1 text-white hover:bg-slate-600"
			>
				Load sample
			</button>
			<label class="flex items-center gap-2">
				Layer
				<select bind:value={layer} class="rounded border px-2 py-1">
					<option value="top">Top</option>
					<option value="bottom">Bottom</option>
				</select>
			</label>
			<label class="flex items-center gap-2">
				Tool offset (mm)
				<input
					type="number"
					step="0.05"
					min="0"
					bind:value={isolationOffset}
					class="w-24 rounded border px-2 py-1"
				/>
			</label>
		</div>
		{#if error}
			<p class="text-red-600">{error}</p>
		{/if}
		{#if board && toolpath}
			<p class="text-sm text-slate-600">
				Board {board.width.toFixed(2)} × {board.height.toFixed(2)} mm —
				{toolpath.segments.length} segments
			</p>
			<svg
				viewBox="-1 -1 {board.width + 2} {board.height + 2}"
				class="max-h-[70vh] w-full border bg-white"
				preserveAspectRatio="xMidYMid meet"
			>
				<g transform="translate(0 {board.height}) scale(1 -1)">
					<rect
						x="0"
						y="0"
						width={board.width}
						height={board.height}
						fill="none"
						stroke="#94a3b8"
						stroke-width="0.05"
					/>
					{#each toolpath.segments as segment, index (index)}
						<path d={segmentToSvgPath(segment)} fill="none" stroke="#c2410c" stroke-width="0.06" />
					{/each}
				</g>
			</svg>
		{/if}
	</main>
{/if}
