import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeScript {
	src?: string;
	dataset: Record<string, string>;
	onload?: () => void;
	onerror?: () => void;
}

describe('analytics', () => {
	let analytics: typeof import('./analytics');
	let scripts: FakeScript[];
	const count = vi.fn();

	beforeEach(async () => {
		vi.resetModules();
		analytics = await import('./analytics');
		scripts = [];
		count.mockClear();
		vi.stubGlobal('window', { goatcounter: { count } });
		vi.stubGlobal('document', {
			createElement: (): FakeScript => ({ dataset: {} }),
			head: { append: (script: FakeScript) => scripts.push(script) }
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stays off without a site code, or with one that is not a plain code', () => {
		analytics.startAnalytics(undefined);
		analytics.startAnalytics('');
		analytics.startAnalytics('evil.example.com/x?');
		analytics.trackEvent('board-converted');

		expect(scripts).toEqual([]);
		expect(count).not.toHaveBeenCalled();
	});

	it('points the script at the site and loads it only once', () => {
		analytics.startAnalytics('my-site');
		analytics.startAnalytics('my-site');

		expect(scripts).toHaveLength(1);
		expect(scripts[0].src).toBe('https://gc.zgo.at/count.js');
		expect(scripts[0].dataset.goatcounter).toBe('https://my-site.goatcounter.com/count');
	});

	it('holds events until the script has loaded, then sends them in order', () => {
		analytics.startAnalytics('my-site');
		analytics.trackEvent('sample-converted');
		analytics.trackEvent('output-downloaded');
		expect(count).not.toHaveBeenCalled();

		scripts[0].onload!();
		analytics.trackEvent('board-converted');

		expect(count.mock.calls.map(([vars]) => vars.path)).toEqual([
			'sample-converted',
			'output-downloaded',
			'board-converted'
		]);
		expect(count).toHaveBeenCalledWith({
			path: 'board-converted',
			title: 'Converted a board',
			event: true
		});
	});

	it('drops events quietly when the script is blocked', () => {
		analytics.startAnalytics('my-site');
		analytics.trackEvent('board-converted');
		scripts[0].onerror!();
		analytics.trackEvent('output-downloaded');

		expect(count).not.toHaveBeenCalled();
	});
});
