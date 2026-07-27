<script lang="ts">
	import { browser } from '$app/environment';
	import FileDrop from '$lib/components/FileDrop.svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import BoardPreview from '$lib/components/BoardPreview.svelte';
	import DownloadPanel from '$lib/components/DownloadPanel.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import { defaultSettings } from '$lib/engine/gcode/settings';
	import type { LayerId } from '$lib/engine/model/types';
	import {
		boardNameFromPath,
		extractPcbFromZip,
		type PcbCandidate
	} from '$lib/engine/zip/extractPcb';
	import { buildScene } from '$lib/preview/scene';
	import { loadSettings, saveSettings, clearSettings } from '$lib/settings/storage';
	import { convertBoard, type ConversionResult } from '$lib/worker/engineClient';

	let boardSource = $state<{ name: string; contents: string } | null>(null);
	let result = $state<ConversionResult | null>(null);
	let converting = $state(false);
	let error = $state('');
	let side = $state<LayerId>('top');
	let viewMode = $state<'designed' | 'machined'>('designed');
	let settings = $state(browser ? loadSettings() : defaultSettings());
	let zipCandidates = $state<PcbCandidate[] | null>(null);

	// Persist settings whenever they change, and regenerate the current board.
	let settingsInitialized = false;
	let regenerateTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const snapshot = $state.snapshot(settings);
		if (!settingsInitialized) {
			settingsInitialized = true;
			return;
		}
		saveSettings(snapshot);
		if (boardSource) {
			clearTimeout(regenerateTimer);
			regenerateTimer = setTimeout(() => {
				if (boardSource) convert(boardSource.name, boardSource.contents);
			}, 400);
		}
	});

	function resetSettings() {
		clearSettings();
		settings = defaultSettings();
	}

	const scene = $derived(result ? buildScene(result.board, side, settings) : null);
	const showMirrored = $derived(
		side === 'bottom' && viewMode === 'machined' && settings.mirrorBottom
	);

	async function loadFile(file: File) {
		zipCandidates = null;
		if (file.name.toLowerCase().endsWith('.zip')) {
			try {
				const candidates = extractPcbFromZip(new Uint8Array(await file.arrayBuffer()));
				if (candidates.length === 1) {
					await convert(boardNameFromPath(candidates[0].path), candidates[0].contents);
				} else {
					zipCandidates = candidates;
				}
			} catch (zipError) {
				error = (zipError as Error).message;
			}
			return;
		}
		await convert(file.name.replace(/\.kicad_pcb$/i, ''), await file.text());
	}

	async function chooseCandidate(candidate: PcbCandidate) {
		zipCandidates = null;
		await convert(boardNameFromPath(candidate.path), candidate.contents);
	}

	async function loadSample() {
		const response = await fetch('/samples/TopAndBottomLayer.kicad_pcb');
		await convert('SampleBoard', await response.text());
	}

	async function convert(name: string, contents: string) {
		error = '';
		converting = true;
		boardSource = { name, contents };
		try {
			result = await convertBoard(contents, name, $state.snapshot(settings));
		} catch (conversionError) {
			result = null;
			error = (conversionError as Error).message;
		} finally {
			converting = false;
		}
	}

	function reset() {
		boardSource = null;
		result = null;
		error = '';
		side = 'top';
		zipCandidates = null;
	}
</script>

<svelte:head>
	<title>KiCad to GCode — engrave PCBs on your CNC</title>
</svelte:head>

<div class="min-h-screen bg-slate-50">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
			<a href="/" class="flex items-center gap-2" onclick={reset}>
				<img src="/favicon.svg" alt="" class="h-8 w-8" />
				<span class="text-lg font-bold tracking-tight text-slate-900">KiCad to GCode</span>
			</a>
			{#if boardSource}
				<button
					type="button"
					onclick={reset}
					class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
				>
					Start over
				</button>
			{/if}
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 py-8">
		{#if !boardSource}
			<!-- Landing -->
			<section class="mx-auto max-w-2xl text-center">
				<h1 class="text-4xl font-extrabold tracking-tight text-slate-900">
					Turn your KiCad design into CNC GCode
				</h1>
				<p class="mx-auto mt-3 max-w-xl text-lg text-slate-600">
					Upload a PCB design and get ready-to-run GCode for engraving the copper traces and
					drilling every hole — for both sides of the board.
				</p>
				<div class="mt-8">
					<FileDrop onfile={loadFile} onsample={loadSample} />
				</div>
				{#if zipCandidates}
					<div
						class="mx-auto mt-4 max-w-md rounded-xl border border-slate-200 bg-white p-4 text-left"
					>
						<p class="mb-2 text-sm font-semibold text-slate-800">
							This project contains several boards — pick one:
						</p>
						<ul class="space-y-1">
							{#each zipCandidates as candidate (candidate.path)}
								<li>
									<button
										type="button"
										class="w-full truncate rounded-lg px-3 py-1.5 text-left font-mono text-sm text-amber-700 hover:bg-amber-50"
										onclick={() => chooseCandidate(candidate)}
									>
										{candidate.path}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if error}
					<p class="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
				{/if}
				<p class="mt-6 text-sm text-slate-500">
					Everything runs in your browser — your design never leaves your computer.
				</p>

				<div class="mx-auto mt-10 max-w-xl space-y-2 text-left">
					<details class="rounded-xl border border-slate-200 bg-white px-4 py-3">
						<summary class="cursor-pointer text-sm font-semibold text-slate-800">
							What is isolation routing?
						</summary>
						<p class="mt-2 text-sm text-slate-600">
							Instead of etching away unwanted copper with chemicals, a CNC machine engraves a thin
							groove around every trace and pad, electrically isolating them from the rest of the
							copper. This tool generates those engraving paths from your KiCad design, offset by
							your tool's cutting width so traces keep their designed size.
						</p>
					</details>
					<details class="rounded-xl border border-slate-200 bg-white px-4 py-3">
						<summary class="cursor-pointer text-sm font-semibold text-slate-800">
							What do I need?
						</summary>
						<p class="mt-2 text-sm text-slate-600">
							A CNC router or engraver that accepts standard GCode (GRBL and similar), a copper-clad
							board, a fine engraving bit or V-bit, and drill bits matching your design's hole
							sizes. For double-sided boards, two alignment pins let you flip the board accurately
							using the generated registration holes.
						</p>
					</details>
					<details class="rounded-xl border border-slate-200 bg-white px-4 py-3">
						<summary class="cursor-pointer text-sm font-semibold text-slate-800">
							What isn't supported yet?
						</summary>
						<p class="mt-2 text-sm text-slate-600">
							Copper zones (filled pours), curved traces, inner layers of 4+ layer boards, and board
							outline cut-out GCode. You'll get a clear warning whenever your design uses something
							the generator has to skip or approximate.
						</p>
					</details>
				</div>
			</section>
		{:else}
			<div class="mb-6">
				<Stepper current={converting ? 2 : result ? 3 : 2} />
			</div>

			{#if converting}
				<p class="py-16 text-center text-lg text-slate-600">Generating toolpaths…</p>
			{:else if error}
				<section class="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-6">
					<h2 class="font-bold text-red-800">Could not process this board</h2>
					<p class="mt-2 text-sm text-red-700">{error}</p>
					<div class="mt-4">
						<FileDrop onfile={loadFile} onsample={loadSample} compact />
					</div>
				</section>
			{:else if result && scene}
				<div class="grid gap-6 lg:grid-cols-[1fr_minmax(280px,360px)]">
					<section>
						<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
							<div class="flex rounded-lg border border-slate-300 bg-white p-0.5" role="tablist">
								{#each [{ id: 'top', label: 'Top side' }, { id: 'bottom', label: 'Bottom side' }] as tab (tab.id)}
									<button
										type="button"
										role="tab"
										aria-selected={side === tab.id}
										onclick={() => (side = tab.id as LayerId)}
										class="rounded-md px-4 py-1.5 text-sm font-semibold transition-colors
											{side === tab.id ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100'}"
									>
										{tab.label}
									</button>
								{/each}
							</div>
							{#if side === 'bottom' && settings.mirrorBottom}
								<label class="flex items-center gap-2 text-sm text-slate-600">
									<input
										type="checkbox"
										class="rounded"
										checked={viewMode === 'machined'}
										onchange={(event) =>
											(viewMode = (event.target as HTMLInputElement).checked
												? 'machined'
												: 'designed')}
									/>
									Show as machined (mirrored)
								</label>
							{/if}
							<p class="text-sm text-slate-500">
								{boardSource.name} — {scene.width.toFixed(1)} × {scene.height.toFixed(1)} mm
							</p>
						</div>
						<BoardPreview {scene} mirrored={showMirrored} />
						{#if result.warnings.length}
							<div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
								<h3 class="text-sm font-bold text-amber-900">Heads up</h3>
								<ul class="mt-1 list-inside list-disc space-y-1 text-sm text-amber-800">
									{#each result.warnings as warning, index (index)}
										<li>{warning.message}</li>
									{/each}
								</ul>
							</div>
						{/if}
					</section>

					<aside class="space-y-6">
						<DownloadPanel files={result.files} boardName={boardSource.name} />
						<SettingsPanel bind:settings onreset={resetSettings} />
						<section
							class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm"
						>
							<h2 class="mb-2 text-lg font-bold text-slate-900">Machining order</h2>
							<ol class="list-inside list-decimal space-y-1">
								<li>Drill the registration holes and pin the blank.</li>
								<li>Engrave the top side, then drill all holes.</li>
								<li>Flip the board left-over-right onto the pins.</li>
								<li>Engrave the bottom side.</li>
							</ol>
						</section>
					</aside>
				</div>
			{/if}
		{/if}
	</main>

	<footer
		class="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-1 px-4 py-8 text-xs text-slate-400"
	>
		<span>KiCadToGCode — free PCB isolation engraving, in your browser.</span>
		<a
			href="https://github.com/grserwe/KiCadToGCodeSvelte"
			target="_blank"
			rel="noopener"
			class="underline hover:text-slate-600">Source on GitHub</a
		>
		<a
			href="mailto:KiCadToGCode@outlook.com?subject=KiCadToGCode%20feedback"
			class="underline hover:text-slate-600">Send feedback</a
		>
	</footer>
</div>
