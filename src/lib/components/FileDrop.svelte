<script lang="ts">
	let {
		onfile,
		onsample,
		compact = false
	}: {
		onfile: (file: File) => void;
		onsample: () => void;
		compact?: boolean;
	} = $props();

	let dragging = $state(false);
	let inputElement: HTMLInputElement;

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) onfile(file);
	}

	function handleBrowse(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (file) onfile(file);
	}
</script>

<div
	role="button"
	tabindex="0"
	aria-label="Upload a KiCad board file"
	class="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors
		{dragging ? 'border-amber-500 bg-amber-50' : 'border-slate-300 bg-white hover:border-amber-400'}
		{compact ? 'px-6 py-4' : 'px-10 py-14'}"
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={handleDrop}
	onclick={() => inputElement.click()}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') inputElement.click();
	}}
>
	{#if !compact}
		<svg
			class="h-12 w-12 text-slate-400"
			fill="none"
			viewBox="0 0 24 24"
			stroke-width="1.5"
			stroke="currentColor"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
			/>
		</svg>
	{/if}
	<p class="text-center font-medium text-slate-700 {compact ? 'text-sm' : 'text-lg'}">
		Drop a <span class="font-mono text-amber-700">.kicad_pcb</span> file here
	</p>
	<p class="text-sm text-slate-500">
		or
		<span class="font-semibold text-amber-700 underline">browse for a file</span>
	</p>
	<input
		bind:this={inputElement}
		type="file"
		accept=".kicad_pcb,.zip"
		class="sr-only"
		onclick={(event) => event.stopPropagation()}
		onchange={handleBrowse}
	/>
</div>
{#if !compact}
	<p class="mt-3 text-center text-sm text-slate-500">
		No board handy?
		<button type="button" class="font-semibold text-amber-700 underline" onclick={onsample}>
			Try the sample board
		</button>
	</p>
{/if}
