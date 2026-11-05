import { expect, test, type Page } from '@playwright/test';

/** Stand in for count.js, recording what the app sends instead of calling GoatCounter. */
async function stubCountScript(page: Page) {
	await page.route('https://gc.zgo.at/count.js', (route) =>
		route.fulfill({
			contentType: 'text/javascript',
			body: 'window.sent = []; window.goatcounter = { count: (vars) => window.sent.push(vars) };'
		})
	);
}

const sentCounts = (page: Page) =>
	page.evaluate(() => (window as unknown as { sent: { path: string }[] }).sent);

async function loadSample(page: Page) {
	await page.goto('/');
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	await page.getByRole('button', { name: /try the sample board/i }).click();
	await expect(page.getByText('SampleBoard-top-isolation.txt')).toBeVisible({ timeout: 20_000 });
}

test('counts conversions and downloads, not regenerating after a settings change', async ({
	page
}) => {
	await stubCountScript(page);
	await loadSample(page);
	await expect
		.poll(async () => (await sentCounts(page)).map((vars) => vars.path))
		.toEqual(['sample-converted']);

	await page.getByRole('button', { name: /output & origin/i }).click();
	await page.locator('label', { hasText: 'File extension' }).locator('select').selectOption('.nc');
	await expect(page.getByText('SampleBoard-top-isolation.nc')).toBeVisible({ timeout: 20_000 });

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /download all/i }).click();
	await downloadPromise;

	await expect
		.poll(async () => (await sentCounts(page)).map((vars) => vars.path))
		.toEqual(['sample-converted', 'output-downloaded']);

	// The promise on the page: nothing identifying the board is ever sent.
	expect(JSON.stringify(await sentCounts(page))).not.toContain('SampleBoard');
});

test('the page says what is counted', async ({ page }) => {
	await stubCountScript(page);
	await page.goto('/');
	await expect(page.getByText(/anonymous, cookie-free visit counts/i)).toBeVisible();
});

test('the app still works when the counting script is blocked', async ({ page }) => {
	await page.route('https://gc.zgo.at/**', (route) => route.abort());
	await loadSample(page);
	await expect(page.getByRole('img', { name: 'Board preview' })).toBeVisible();
});
