import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Honor a PORT env var when set (used by the Claude preview harness); a plain
	// `npm run dev` leaves PORT unset and keeps Vite's default 5173 behavior.
	server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node for the Fly.io Docker deployment (node build/ at runtime).
			adapter: adapter()
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
