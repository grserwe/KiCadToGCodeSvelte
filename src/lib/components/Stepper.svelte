<script lang="ts">
	let { current }: { current: 1 | 2 | 3 } = $props();

	const steps = [
		{ number: 1, label: 'Upload board' },
		{ number: 2, label: 'Preview & settings' },
		{ number: 3, label: 'Download GCode' }
	];
</script>

<ol class="flex items-center justify-center gap-2 text-sm sm:gap-4">
	{#each steps as step (step.number)}
		<li class="flex items-center gap-2">
			<span
				class="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold
					{step.number < current
					? 'bg-emerald-600 text-white'
					: step.number === current
						? 'bg-amber-600 text-white'
						: 'bg-slate-200 text-slate-500'}"
			>
				{#if step.number < current}✓{:else}{step.number}{/if}
			</span>
			<span class={step.number === current ? 'font-semibold text-slate-900' : 'text-slate-500'}>
				{step.label}
			</span>
			{#if step.number < steps.length}
				<span class="mx-1 hidden h-px w-8 bg-slate-300 sm:block" aria-hidden="true"></span>
			{/if}
		</li>
	{/each}
</ol>
