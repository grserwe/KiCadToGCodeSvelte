<script lang="ts">
	import '../app.css';
	import { env } from '$env/dynamic/public';
	import { startAnalytics } from '$lib/analytics';

	let { children } = $props();

	// Marks hydration completion; e2e tests wait on this before interacting.
	$effect(() => {
		document.body.dataset.hydrated = 'true';
		startAnalytics(env.PUBLIC_GOATCOUNTER_CODE);
	});
</script>

{@render children()}
