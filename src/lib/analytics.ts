/**
 * Anonymous usage counts through GoatCounter (cookie-free). Off unless a site
 * code is configured. Only the fixed event names below are ever sent: never
 * anything from the board, including its name, because the page promises the
 * design stays on the user's computer.
 */
const SCRIPT_URL = 'https://gc.zgo.at/count.js';
const SITE_CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

const EVENT_TITLES = {
	'board-converted': 'Converted a board',
	'sample-converted': 'Tried the sample board',
	'output-downloaded': 'Downloaded output'
} as const;

export type UsageEvent = keyof typeof EVENT_TITLES;

interface GoatCounter {
	count?: (vars: { path: string; title: string; event: true }) => void;
}

declare global {
	interface Window {
		goatcounter?: GoatCounter;
	}
}

let status: 'off' | 'loading' | 'ready' = 'off';
/** Events from before count.js finished loading; it has no queue of its own. */
let pending: UsageEvent[] = [];

/** Load the counting script, which also records the page view. */
export function startAnalytics(siteCode: string | undefined): void {
	if (status !== 'off' || !siteCode || !SITE_CODE_PATTERN.test(siteCode)) return;

	const script = document.createElement('script');
	script.async = true;
	script.src = SCRIPT_URL;
	script.dataset.goatcounter = `https://${siteCode}.goatcounter.com/count`;
	script.onload = () => {
		status = 'ready';
		pending.forEach(send);
		pending = [];
	};
	// Blocked by the visitor's browser or an extension: carry on uncounted.
	script.onerror = () => {
		status = 'off';
		pending = [];
	};
	status = 'loading';
	document.head.append(script);
}

export function trackEvent(event: UsageEvent): void {
	if (status === 'ready') send(event);
	else if (status === 'loading') pending.push(event);
}

function send(event: UsageEvent): void {
	window.goatcounter?.count?.({ path: event, title: EVENT_TITLES[event], event: true });
}
