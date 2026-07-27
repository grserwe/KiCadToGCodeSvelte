<script lang="ts">
	import type { GCodeSettings } from '$lib/engine/gcode/settings';
	import { effectiveToolDiameterMm } from '$lib/engine/gcode/settings';

	let {
		settings = $bindable(),
		onreset
	}: {
		settings: GCodeSettings;
		onreset: () => void;
	} = $props();

	// Depths, safe heights, and feed rates follow the output units.
	const unit = $derived(settings.outputUnits === 'inch' ? 'in' : 'mm');
	const feedUnit = $derived(settings.outputUnits === 'inch' ? 'in/min' : 'mm/min');

	let open = $state({
		tool: true,
		isolation: false,
		drilling: false,
		output: false,
		doubleSided: false
	});

	const vBitEnabled = $derived(settings.vBitAngleDeg !== null);
</script>

{#snippet numberField(
	label: string,
	unitLabel: string,
	get: () => number,
	set: (value: number) => void,
	step = 0.01,
	min = 0
)}
	<label class="flex items-center justify-between gap-2 py-1">
		<span class="text-sm text-slate-600">{label}</span>
		<span class="flex items-center gap-1">
			<input
				type="number"
				{step}
				{min}
				value={get()}
				onchange={(event) => {
					const value = Number((event.target as HTMLInputElement).value);
					if (Number.isFinite(value)) set(value);
				}}
				class="w-24 rounded-md border-slate-300 px-2 py-1 text-right text-sm"
			/>
			<span class="w-12 text-xs text-slate-400">{unitLabel}</span>
		</span>
	</label>
{/snippet}

{#snippet group(
	id: 'tool' | 'isolation' | 'drilling' | 'output' | 'doubleSided',
	title: string,
	body: import('svelte').Snippet
)}
	<div class="border-b border-slate-100 last:border-b-0">
		<button
			type="button"
			class="flex w-full items-center justify-between py-2 text-left font-semibold text-slate-800"
			onclick={() => (open[id] = !open[id])}
			aria-expanded={open[id]}
		>
			{title}
			<span class="text-slate-400">{open[id] ? '−' : '+'}</span>
		</button>
		{#if open[id]}
			<div class="pb-3">
				{@render body()}
			</div>
		{/if}
	</div>
{/snippet}

<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<div class="mb-1 flex items-center justify-between">
		<h2 class="text-lg font-bold text-slate-900">Settings</h2>
		<button
			type="button"
			onclick={onreset}
			class="text-xs font-medium text-slate-500 underline hover:text-slate-700"
		>
			Reset to defaults
		</button>
	</div>

	{#snippet toolBody()}
		{@render numberField(
			'Tool tip diameter',
			'mm',
			() => settings.toolDiameterMm,
			(v) => (settings.toolDiameterMm = v),
			0.05
		)}
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">V-bit tool</span>
			<input
				type="checkbox"
				class="rounded"
				checked={vBitEnabled}
				onchange={(event) =>
					(settings.vBitAngleDeg = (event.target as HTMLInputElement).checked ? 30 : null)}
			/>
		</label>
		{#if vBitEnabled}
			{@render numberField(
				'V-bit angle',
				'deg',
				() => settings.vBitAngleDeg ?? 30,
				(v) => (settings.vBitAngleDeg = v),
				5,
				5
			)}
			<p class="py-1 text-xs text-slate-400">
				Effective cut width at depth: {effectiveToolDiameterMm(settings).toFixed(3)} mm
			</p>
		{/if}
		{@render numberField(
			'Isolation passes',
			'',
			() => settings.isolationPasses,
			(v) => (settings.isolationPasses = Math.max(1, Math.round(v))),
			1,
			1
		)}
		{#if settings.isolationPasses > 1}
			{@render numberField(
				'Stepover',
				'× tool',
				() => settings.isolationStepover,
				(v) => (settings.isolationStepover = v),
				0.1,
				0.1
			)}
		{/if}
		{@render numberField(
			'Minimum trace width',
			'mm',
			() => settings.minimumTrackWidthMm,
			(v) => (settings.minimumTrackWidthMm = v),
			0.05
		)}
		{@render numberField(
			'Minimum pad/via size',
			'mm',
			() => settings.minimumViaSizeMm,
			(v) => (settings.minimumViaSizeMm = v),
			0.1
		)}
		<p class="py-1 text-xs text-slate-400">
			Thin traces and small pads are widened to these minimums so the copper doesn't peel while
			machining — but only as far as neighboring copper on other nets allows, so widening never
			causes a short.
		</p>
	{/snippet}
	{@render group('tool', 'Tool', toolBody)}

	{#snippet isolationBody()}
		{@render numberField(
			'Cut depth',
			unit,
			() => settings.isolationDepth,
			(v) => (settings.isolationDepth = v)
		)}
		{@render numberField(
			'Safe height',
			unit,
			() => settings.isolationSafeZ,
			(v) => (settings.isolationSafeZ = v)
		)}
		{@render numberField(
			'Engraving speed',
			feedUnit,
			() => settings.isolationXYSpeed,
			(v) => (settings.isolationXYSpeed = v),
			1
		)}
		{@render numberField(
			'Plunge speed',
			feedUnit,
			() => settings.isolationPlungeSpeed,
			(v) => (settings.isolationPlungeSpeed = v),
			1
		)}
		{@render numberField(
			'Spindle speed',
			'RPM',
			() => settings.isolationSpindleRPM,
			(v) => (settings.isolationSpindleRPM = Math.round(v)),
			500
		)}
	{/snippet}
	{@render group('isolation', 'Isolation engraving', isolationBody)}

	{#snippet drillingBody()}
		{@render numberField(
			'Drill depth',
			unit,
			() => settings.drillDepth,
			(v) => (settings.drillDepth = v)
		)}
		{@render numberField(
			'Safe height',
			unit,
			() => settings.drillingSafeZ,
			(v) => (settings.drillingSafeZ = v)
		)}
		{@render numberField(
			'Plunge speed',
			feedUnit,
			() => settings.drillingPlungeSpeed,
			(v) => (settings.drillingPlungeSpeed = v),
			1
		)}
		{@render numberField(
			'Retract speed',
			feedUnit,
			() => settings.drillingRetractSpeed,
			(v) => (settings.drillingRetractSpeed = v),
			1
		)}
		{@render numberField(
			'Spindle speed',
			'RPM',
			() => settings.drillingSpindleRPM,
			(v) => (settings.drillingSpindleRPM = Math.round(v)),
			500
		)}
	{/snippet}
	{@render group('drilling', 'Drilling', drillingBody)}

	{#snippet outputBody()}
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">Output units</span>
			<select bind:value={settings.outputUnits} class="rounded-md border-slate-300 py-1 text-sm">
				<option value="inch">Inches</option>
				<option value="mm">Millimeters</option>
			</select>
		</label>
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">XY zero position</span>
			<select bind:value={settings.xyZeroPosition} class="rounded-md border-slate-300 py-1 text-sm">
				<option value="lower-left">Lower left</option>
				<option value="upper-left">Upper left</option>
				<option value="upper-right">Upper right</option>
				<option value="lower-right">Lower right</option>
				<option value="center">Center</option>
			</select>
		</label>
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">Rapid speed</span>
			<span class="flex items-center gap-2 text-sm">
				<label class="flex items-center gap-1 text-xs text-slate-500">
					<input type="checkbox" class="rounded" bind:checked={settings.useMachineRapids} />
					machine default
				</label>
			</span>
		</label>
		{#if !settings.useMachineRapids}
			{@render numberField(
				'Rapid feed',
				feedUnit,
				() => settings.xyRapidSpeed,
				(v) => (settings.xyRapidSpeed = v),
				1
			)}
		{/if}
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">File extension</span>
			<select bind:value={settings.fileExtension} class="rounded-md border-slate-300 py-1 text-sm">
				<option value=".txt">.txt</option>
				<option value=".nc">.nc</option>
				<option value=".gcode">.gcode</option>
			</select>
		</label>
		<div class="flex items-center gap-4 py-1">
			<label class="flex items-center gap-1 text-sm text-slate-600">
				<input type="checkbox" class="rounded" bind:checked={settings.flipX} /> Flip X
			</label>
			<label class="flex items-center gap-1 text-sm text-slate-600">
				<input type="checkbox" class="rounded" bind:checked={settings.flipY} /> Flip Y
			</label>
		</div>
	{/snippet}
	{@render group('output', 'Output & origin', outputBody)}

	{#snippet doubleSidedBody()}
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">Mirror bottom side</span>
			<input type="checkbox" class="rounded" bind:checked={settings.mirrorBottom} />
		</label>
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">Drill from</span>
			<select bind:value={settings.drillSide} class="rounded-md border-slate-300 py-1 text-sm">
				<option value="bottom">Bottom (flipped)</option>
				<option value="top">Top</option>
			</select>
		</label>
		<label class="flex items-center justify-between gap-2 py-1">
			<span class="text-sm text-slate-600">Registration holes</span>
			<input type="checkbox" class="rounded" bind:checked={settings.registrationHoles.enabled} />
		</label>
		{#if settings.registrationHoles.enabled}
			{@render numberField(
				'Hole diameter',
				'mm',
				() => settings.registrationHoles.diameterMm,
				(v) => (settings.registrationHoles.diameterMm = v),
				0.05
			)}
			{@render numberField(
				'Margin from board',
				'mm',
				() => settings.registrationHoles.marginMm,
				(v) => (settings.registrationHoles.marginMm = v),
				0.5
			)}
		{/if}
	{/snippet}
	{@render group('doubleSided', 'Double-sided machining', doubleSidedBody)}
</section>
