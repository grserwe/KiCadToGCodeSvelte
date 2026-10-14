<script lang="ts">
	import type { GCodeSettings } from '$lib/engine/gcode/settings';
	import { FEEDBACK_LIMITS, formatBytes, isPlausibleEmail } from '$lib/feedback/report';

	let {
		open = $bindable(false),
		board = null,
		settings,
		warnings = [],
		error = ''
	}: {
		open?: boolean;
		/** The board currently loaded, offered as an attachment. */
		board?: { name: string; contents: string } | null;
		settings: GCodeSettings;
		/** Warning messages currently shown for the board. */
		warnings?: string[];
		/** The conversion error currently shown, if any. */
		error?: string;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let messageField = $state<HTMLTextAreaElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	let message = $state('');
	let email = $state('');
	let includePcb = $state(true);
	let extras = $state<File[]>([]);
	let status = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');
	let failure = $state('');

	const pcbBytes = $derived(board ? new TextEncoder().encode(board.contents).length : 0);
	const totalBytes = $derived(
		(board && includePcb ? pcbBytes : 0) + extras.reduce((sum, file) => sum + file.size, 0)
	);
	const tooLarge = $derived(totalBytes > FEEDBACK_LIMITS.maxTotalBytes);
	const tooManyFiles = $derived(extras.length > FEEDBACK_LIMITS.maxExtraAttachments);
	const emailInvalid = $derived(email.trim() !== '' && !isPlausibleEmail(email.trim()));
	const canSend = $derived(
		status !== 'sending' && message.trim() !== '' && !tooLarge && !tooManyFiles && !emailInvalid
	);

	// Mirror `open` onto the native dialog so Escape and backdrop clicks stay in sync.
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			messageField?.focus();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	function close() {
		open = false;
		if (status === 'sent') {
			message = '';
			extras = [];
			status = 'idle';
		}
		failure = '';
	}

	function addFiles(event: Event) {
		const chosen = Array.from((event.target as HTMLInputElement).files ?? []);
		extras = [...extras, ...chosen];
		if (fileInput) fileInput.value = '';
	}

	function removeFile(index: number) {
		extras = extras.filter((_, i) => i !== index);
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) return;
		status = 'sending';
		failure = '';

		const form = new FormData();
		form.set('message', message.trim());
		form.set('email', email.trim());
		form.set('settings', JSON.stringify($state.snapshot(settings)));
		form.set('warnings', JSON.stringify(warnings));
		form.set('error', error);
		if (board) {
			form.set('boardName', board.name);
			if (includePcb) {
				form.set(
					'pcb',
					new File([board.contents], `${board.name}.kicad_pcb`, { type: 'text/plain' })
				);
			}
		}
		for (const file of extras) form.append('attachments', file);

		try {
			const response = await fetch('/api/feedback', { method: 'POST', body: form });
			const body = (await response.json().catch(() => null)) as {
				ok?: boolean;
				message?: string;
			} | null;
			if (response.ok && body?.ok) {
				status = 'sent';
			} else {
				status = 'failed';
				failure = body?.message ?? `Sending failed (HTTP ${response.status}).`;
			}
		} catch {
			status = 'failed';
			failure = 'Sending failed — check your connection and try again.';
		}
	}
</script>

<dialog
	bind:this={dialog}
	onclose={close}
	aria-labelledby="feedback-title"
	class="m-auto w-[min(100%-2rem,36rem)] rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
>
	{#if status === 'sent'}
		<div class="p-6 text-center">
			<h2 id="feedback-title" class="text-xl font-bold text-slate-900">Thanks — message sent</h2>
			<p class="mt-2 text-sm text-slate-600">
				{#if email.trim()}
					A reply will go to <span class="font-medium text-slate-800">{email.trim()}</span>.
				{:else}
					If you'd like a reply next time, include your email address.
				{/if}
			</p>
			<button
				type="button"
				onclick={close}
				class="mt-6 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
			>
				Close
			</button>
		</div>
	{:else}
		<form onsubmit={send} class="p-6">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h2 id="feedback-title" class="text-xl font-bold text-slate-900">
						{board ? 'Report a problem' : 'Send feedback'}
					</h2>
					<p class="mt-1 text-sm text-slate-600">
						Something wrong with the GCode, or an idea for the tool? Your message goes straight to
						the developer.
					</p>
				</div>
				<button
					type="button"
					onclick={close}
					aria-label="Close"
					class="-mt-1 -mr-2 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
				>
					<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
						/>
					</svg>
				</button>
			</div>

			<label class="mt-4 block">
				<span class="text-sm font-semibold text-slate-800">Message</span>
				<textarea
					bind:this={messageField}
					bind:value={message}
					name="message"
					required
					rows="5"
					maxlength={FEEDBACK_LIMITS.messageMaxChars}
					placeholder={board
						? 'What went wrong? Which file, which part of the board, and what you expected instead.'
						: 'What would you like to tell me?'}
					class="mt-1 block w-full rounded-lg border-slate-300 text-sm focus:border-amber-500 focus:ring-amber-500"
				></textarea>
			</label>

			<label class="mt-3 block">
				<span class="text-sm font-semibold text-slate-800">
					Your email <span class="font-normal text-slate-500">(optional, for a reply)</span>
				</span>
				<input
					bind:value={email}
					type="email"
					name="email"
					autocomplete="email"
					placeholder="you@example.com"
					class="mt-1 block w-full rounded-lg border-slate-300 text-sm focus:border-amber-500 focus:ring-amber-500"
				/>
				{#if emailInvalid}
					<span class="mt-1 block text-xs text-red-700"
						>That doesn't look like an email address.</span
					>
				{/if}
			</label>

			<!-- Honeypot: hidden from people, filled in by bots. -->
			<div class="hidden" aria-hidden="true">
				<label>
					Website
					<input type="text" name="website" tabindex="-1" autocomplete="off" />
				</label>
			</div>

			<fieldset class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
				<legend class="px-1 text-sm font-semibold text-slate-800">Attachments</legend>
				{#if board}
					<label class="flex items-start gap-2 text-sm text-slate-700">
						<input
							type="checkbox"
							bind:checked={includePcb}
							class="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
						/>
						<span>
							Include my PCB file
							<span class="font-mono text-amber-700">{board.name}.kicad_pcb</span>
							<span class="text-slate-500">({formatBytes(pcbBytes)})</span>
							<span class="block text-xs text-slate-500">
								The design is the fastest way to reproduce a problem. Untick if you'd rather not
								share it.
							</span>
						</span>
					</label>
				{/if}
				<p class="mt-2 text-xs text-slate-500">
					Your current settings{warnings.length ? ' and the warnings shown' : ''} are included automatically.
				</p>

				{#if extras.length}
					<ul class="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
						{#each extras as file, index (`${file.name}-${file.size}-${index}`)}
							<li class="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
								<span class="min-w-0 truncate font-mono text-slate-800">{file.name}</span>
								<span class="shrink-0 text-xs text-slate-500">{formatBytes(file.size)}</span>
								<button
									type="button"
									onclick={() => removeFile(index)}
									class="shrink-0 text-xs font-semibold text-slate-500 hover:text-red-700"
								>
									Remove
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<label
					class="mt-2 inline-block cursor-pointer text-sm font-semibold text-amber-700 underline"
				>
					Add screenshots or other files…
					<input bind:this={fileInput} type="file" multiple class="sr-only" onchange={addFiles} />
				</label>
				{#if tooManyFiles}
					<p class="mt-1 text-xs text-red-700">
						Please attach at most {FEEDBACK_LIMITS.maxExtraAttachments} extra files.
					</p>
				{:else if tooLarge}
					<p class="mt-1 text-xs text-red-700">
						Attachments total {formatBytes(totalBytes)}; the limit is
						{formatBytes(FEEDBACK_LIMITS.maxTotalBytes)}.
					</p>
				{/if}
			</fieldset>

			{#if status === 'failed'}
				<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{failure}</p>
			{/if}

			<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
				<p class="text-xs text-slate-500">Nothing leaves your browser until you press Send.</p>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={close}
						class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!canSend}
						class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{status === 'sending' ? 'Sending…' : 'Send'}
					</button>
				</div>
			</div>
		</form>
	{/if}
</dialog>
