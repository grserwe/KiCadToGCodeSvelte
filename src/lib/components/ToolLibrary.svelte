<script lang="ts">
	import type { GCodeSettings } from '$lib/engine/gcode/settings';
	import {
		applyIsolationTool,
		cutFromTool,
		cutToMm,
		cutWidthMm,
		defaultToolName,
		recommendIsolationCut,
		restoreDefaultTools,
		settingsMatchTool,
		toolFromSettings,
		type IsolationTool,
		type IsolationToolCut,
		type IsolationToolKind
	} from '$lib/engine/gcode/isolationTools';
	import { newToolId } from '$lib/settings/toolLibrary';

	let {
		settings = $bindable(),
		tools = $bindable()
	}: {
		settings: GCodeSettings;
		tools: IsolationTool[];
	} = $props();

	const unit = $derived(settings.outputUnits === 'inch' ? 'in' : 'mm');
	const feedUnit = $derived(settings.outputUnits === 'inch' ? 'in/min' : 'mm/min');

	const selected = $derived(tools.find((t) => t.id === settings.isolationToolId) ?? null);
	const modified = $derived(selected !== null && !settingsMatchTool(settings, selected));

	/** The add/edit form; null when closed. */
	let draft = $state<{
		/** The tool being edited, or null for a new one. */
		id: string | null;
		name: string;
		kind: IsolationToolKind;
		tipDiameterMm: number;
		angleDeg: number;
		/** Cut fields the user typed; the rest follow the recommendation. */
		overrides: Partial<IsolationToolCut>;
	} | null>(null);

	const recommended = $derived(
		draft
			? recommendIsolationCut(
					draft.kind,
					draft.tipDiameterMm,
					draft.angleDeg,
					settings.outputUnits,
					settings.isolationSpindleRPM
				)
			: null
	);
	const draftCut = $derived(draft && recommended ? { ...recommended, ...draft.overrides } : null);
	const draftWidthMm = $derived(
		draft && draftCut
			? cutWidthMm(
					draft.kind,
					draft.tipDiameterMm,
					draft.angleDeg,
					settings.outputUnits === 'inch' ? draftCut.depth * 25.4 : draftCut.depth
				)
			: 0
	);
	const draftGapMm = $derived(
		draftCut ? draftWidthMm * (1 + (draftCut.passes - 1) * draftCut.stepover) : 0
	);
	const draftUsesRecommendation = $derived(
		draft !== null && Object.keys(draft.overrides).length === 0
	);

	function select(id: string) {
		const tool = tools.find((t) => t.id === id);
		if (tool) applyIsolationTool(settings, tool);
		else settings.isolationToolId = null;
	}

	function startAdd() {
		draft = { id: null, name: '', kind: 'vbit', tipDiameterMm: 0.2, angleDeg: 30, overrides: {} };
	}

	function startEdit(tool: IsolationTool) {
		draft = {
			id: tool.id,
			name: tool.name,
			kind: tool.kind,
			tipDiameterMm: tool.tipDiameterMm,
			angleDeg: tool.angleDeg,
			overrides: cutFromTool(tool, settings.outputUnits)
		};
	}

	function saveDraft() {
		if (!draft || !draftCut) return;
		const tool: IsolationTool = {
			id: draft.id ?? newToolId(),
			name: draft.name.trim() || defaultToolName(draft.kind, draft.tipDiameterMm, draft.angleDeg),
			kind: draft.kind,
			tipDiameterMm: draft.tipDiameterMm,
			angleDeg: draft.angleDeg,
			...cutToMm(draftCut, settings.outputUnits)
		};
		const index = tools.findIndex((t) => t.id === tool.id);
		tools = index >= 0 ? tools.map((t) => (t.id === tool.id ? tool : t)) : [...tools, tool];
		applyIsolationTool(settings, tool);
		draft = null;
	}

	function remove(tool: IsolationTool) {
		if (!confirm(`Remove "${tool.name}" from the tool library?`)) return;
		tools = tools.filter((t) => t.id !== tool.id);
		if (settings.isolationToolId === tool.id) settings.isolationToolId = null;
	}

	function saveSettingsToTool(tool: IsolationTool) {
		const updated = toolFromSettings(settings, tool);
		tools = tools.map((t) => (t.id === tool.id ? updated : t));
	}

	const missingDefaults = $derived(
		restoreDefaultTools(tools, settings.outputUnits, settings.isolationSpindleRPM).length -
			tools.length
	);

	function restoreDefaults() {
		tools = restoreDefaultTools(tools, settings.outputUnits, settings.isolationSpindleRPM);
	}

	function setOverride(key: keyof IsolationToolCut, value: number) {
		if (draft) draft.overrides = { ...draft.overrides, [key]: value };
	}
</script>

{#snippet draftField(
	label: string,
	unitLabel: string,
	key: keyof IsolationToolCut,
	step: number,
	min = 0
)}
	<label class="flex items-center justify-between gap-2 py-1">
		<span class="text-sm text-slate-600">
			{label}
			{#if draft && key in draft.overrides && recommended && draft.overrides[key] !== recommended[key]}
				<span class="text-xs text-slate-400">(rec. {recommended[key]})</span>
			{/if}
		</span>
		<span class="flex items-center gap-1">
			<input
				type="number"
				{step}
				{min}
				value={draftCut?.[key]}
				onchange={(event) => {
					let value = Number((event.target as HTMLInputElement).value);
					if (!Number.isFinite(value)) return;
					if (key === 'passes') value = Math.max(1, Math.round(value));
					if (key === 'spindleRPM') value = Math.round(value);
					setOverride(key, value);
				}}
				class="w-24 rounded-md border-slate-300 px-2 py-1 text-right text-sm"
			/>
			<span class="w-12 text-xs text-slate-400">{unitLabel}</span>
		</span>
	</label>
{/snippet}

<div class="mb-2 rounded-lg bg-slate-50 p-2">
	<label class="flex items-center justify-between gap-2 py-1">
		<span class="text-sm font-medium text-slate-700">Tool library</span>
		<select
			class="max-w-[60%] rounded-md border-slate-300 py-1 text-sm"
			value={settings.isolationToolId ?? ''}
			onchange={(event) => select((event.target as HTMLSelectElement).value)}
		>
			<option value="">Entered by hand</option>
			{#each tools as tool (tool.id)}
				<option value={tool.id}>{tool.name}</option>
			{/each}
		</select>
	</label>

	{#if selected && modified && !draft}
		<p class="py-1 text-xs text-amber-700">
			Settings changed since applying this tool.
			<button
				type="button"
				class="underline"
				onclick={() => applyIsolationTool(settings, selected)}
			>
				Re-apply
			</button>
			·
			<button type="button" class="underline" onclick={() => saveSettingsToTool(selected)}>
				Save to tool
			</button>
		</p>
	{/if}

	{#if !draft}
		<div class="flex gap-3 py-1 text-xs font-medium">
			<button
				type="button"
				class="text-slate-600 underline hover:text-slate-800"
				onclick={startAdd}
			>
				Add tool
			</button>
			{#if selected}
				<button
					type="button"
					class="text-slate-600 underline hover:text-slate-800"
					onclick={() => startEdit(selected)}
				>
					Edit
				</button>
				<button
					type="button"
					class="text-red-600 underline hover:text-red-800"
					onclick={() => remove(selected)}
				>
					Remove
				</button>
			{/if}
			{#if missingDefaults > 0}
				<button
					type="button"
					class="ml-auto text-slate-500 underline hover:text-slate-700"
					title="Adds back {missingDefaults} missing default tool{missingDefaults === 1
						? ''
						: 's'}; your own tools are kept"
					onclick={restoreDefaults}
				>
					Restore default tools
				</button>
			{/if}
		</div>
	{:else}
		<div class="mt-1 border-t border-slate-200 pt-2">
			<label class="flex items-center justify-between gap-2 py-1">
				<span class="text-sm text-slate-600">Type</span>
				<select bind:value={draft.kind} class="rounded-md border-slate-300 py-1 text-sm">
					<option value="vbit">V-bit</option>
					<option value="endmill">End mill</option>
				</select>
			</label>
			{#if draft.kind === 'vbit'}
				<label class="flex items-center justify-between gap-2 py-1">
					<span class="text-sm text-slate-600">Angle</span>
					<span class="flex items-center gap-1">
						<input
							type="number"
							step="5"
							min="5"
							bind:value={draft.angleDeg}
							class="w-24 rounded-md border-slate-300 px-2 py-1 text-right text-sm"
						/>
						<span class="w-12 text-xs text-slate-400">deg</span>
					</span>
				</label>
			{/if}
			<label class="flex items-center justify-between gap-2 py-1">
				<span class="text-sm text-slate-600"
					>{draft.kind === 'vbit' ? 'Tip diameter' : 'Diameter'}</span
				>
				<span class="flex items-center gap-1">
					<input
						type="number"
						step="0.05"
						min="0"
						bind:value={draft.tipDiameterMm}
						class="w-24 rounded-md border-slate-300 px-2 py-1 text-right text-sm"
					/>
					<span class="w-12 text-xs text-slate-400">mm</span>
				</span>
			</label>
			<label class="flex items-center justify-between gap-2 py-1">
				<span class="text-sm text-slate-600">Name</span>
				<input
					type="text"
					bind:value={draft.name}
					placeholder={defaultToolName(draft.kind, draft.tipDiameterMm, draft.angleDeg)}
					class="w-44 rounded-md border-slate-300 px-2 py-1 text-sm"
				/>
			</label>

			<div class="mt-2 flex items-center justify-between">
				<span class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
					Isolation settings
				</span>
				{#if draftUsesRecommendation}
					<span class="text-xs text-slate-400">recommended</span>
				{:else}
					<button
						type="button"
						class="text-xs text-slate-500 underline hover:text-slate-700"
						onclick={() => draft && (draft.overrides = {})}
					>
						Use recommended
					</button>
				{/if}
			</div>
			{@render draftField(
				'Cut depth',
				unit,
				'depth',
				settings.outputUnits === 'inch' ? 0.0005 : 0.01
			)}
			{@render draftField('Engraving speed', feedUnit, 'xySpeed', 1)}
			{@render draftField('Plunge speed', feedUnit, 'plungeSpeed', 1)}
			{@render draftField('Spindle speed', 'RPM', 'spindleRPM', 500)}
			{@render draftField('Isolation passes', '', 'passes', 1, 1)}
			{#if draftCut && draftCut.passes > 1}
				{@render draftField('Stepover', '× tool', 'stepover', 0.1, 0.1)}
			{/if}
			<p class="py-1 text-xs text-slate-400">
				Cuts {draftWidthMm.toFixed(3)} mm wide per pass{#if draftCut && draftCut.passes > 1}, a
					{draftGapMm.toFixed(3)} mm gap over {draftCut.passes} passes{/if}. Fields follow the
				recommendation for the bit until you change them.
			</p>

			<div class="flex gap-2 pt-2">
				<button
					type="button"
					onclick={saveDraft}
					class="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
				>
					{draft.id ? 'Save and apply' : 'Add and apply'}
				</button>
				<button
					type="button"
					onclick={() => (draft = null)}
					class="rounded-md px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
				>
					Cancel
				</button>
			</div>
		</div>
	{/if}
</div>
