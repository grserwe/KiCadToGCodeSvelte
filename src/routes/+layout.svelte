<script lang="ts">
	import '../app.css';

	let { children } = $props();

	// Marks hydration completion; e2e tests wait on this before interacting.
	$effect(() => {
		document.body.dataset.hydrated = 'true';
	});
</script>

{@render children()}
