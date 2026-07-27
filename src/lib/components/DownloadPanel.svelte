<script lang="ts">
	import { zipSync, strToU8 } from 'fflate';
	import type { GCodeFile } from '$lib/engine/gcode/emit';

	let { files, boardName }: { files: GCodeFile[]; boardName: string } = $props();

	const ordered = $derived([...files].sort((a, b) => orderOf(a) - orderOf(b)));

	function orderOf(file: GCodeFile): number {
		switch (file.kind) {
			case 'registration':
				return 0;
			case 'drill':
				return 1;
			case 'isolation-top':
				return 2;
			case 'isolation-bottom':
				return 3;
		}
	}

	function download(fileName: string, content: Blob) {
		const url = URL.createObjectURL(content);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function downloadFile(file: GCodeFile) {
		download(file.fileName, new Blob([file.content], { type: 'text/plain' }));
	}

	function downloadAll() {
		const entries: Record<string, Uint8Array> = {};
		for (const file of files) {
			entries[file.fileName] = strToU8(file.content);
		}
		const zipped = zipSync(entries);
		download(
			`${boardName}-gcode.zip`,
			new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
		);
	}
</script>

<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<div class="mb-3 flex items-center justify-between gap-2">
		<h2 class="text-lg font-bold text-slate-900">GCode files</h2>
		<button
			type="button"
			onclick={downloadAll}
			class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-500"
		>
			Download all (.zip)
		</button>
	</div>
	<ul class="divide-y divide-slate-100">
		{#each ordered as file (file.fileName)}
			<li class="flex items-center justify-between gap-3 py-2">
				<div class="min-w-0">
					<p class="truncate font-mono text-sm text-slate-800">{file.fileName}</p>
					<p class="text-xs text-slate-500">{file.label}</p>
				</div>
				<button
					type="button"
					onclick={() => downloadFile(file)}
					class="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
				>
					Download
				</button>
			</li>
		{/each}
	</ul>
</section>
