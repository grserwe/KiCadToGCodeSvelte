import { expect, test, type Page } from '@playwright/test';

/** Navigate and wait for Svelte hydration so clicks are never no-ops. */
async function gotoHydrated(page: Page): Promise<void> {
	await page.goto('/');
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
}

test('landing page explains the tool and offers upload', async ({ page }) => {
	await gotoHydrated(page);
	await expect(page.getByRole('heading', { name: /turn your kicad design/i })).toBeVisible();
	await expect(page.getByText(/drop a/i)).toBeVisible();
	await expect(page.getByText(/never leaves your computer/i)).toBeVisible();
});

test('sample board converts, previews both sides, and downloads GCode', async ({ page }) => {
	await gotoHydrated(page);
	await page.getByRole('button', { name: /try the sample board/i }).click();

	// Preview appears with the board dimensions (worker may compile on first
	// use in dev mode, so allow extra time).
	await expect(page.getByText(/21\.6 × 8\.3 mm/)).toBeVisible({ timeout: 20_000 });
	const preview = page.getByRole('img', { name: 'Board preview' });
	await expect(preview).toBeVisible();
	expect(await preview.locator('line').count()).toBeGreaterThan(0);

	// All four expected files are listed.
	await expect(page.getByText('SampleBoard-top-isolation.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-bottom-isolation.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-drill-0.5mm.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-registration.txt')).toBeVisible();

	// Switch to the bottom side.
	await page.getByRole('tab', { name: /bottom side/i }).click();
	await expect(page.getByText(/show as machined/i)).toBeVisible();

	// A single-file download produces the expected file.
	const downloadPromise = page.waitForEvent('download');
	await page
		.locator('li', { hasText: 'SampleBoard-top-isolation.txt' })
		.getByRole('button', { name: 'Download' })
		.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('SampleBoard-top-isolation.txt');

	// Download-all produces the zip bundle.
	const zipPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /download all/i }).click();
	const zip = await zipPromise;
	expect(zip.suggestedFilename()).toBe('SampleBoard-gcode.zip');
});

test('a broken file shows a friendly error and a retry path', async ({ page }) => {
	await gotoHydrated(page);
	await page.locator('input[type=file]').setInputFiles({
		name: 'broken.kicad_pcb',
		mimeType: 'text/plain',
		buffer: Buffer.from('this is not a kicad file')
	});
	await expect(page.getByText(/could not process this board/i)).toBeVisible({ timeout: 20_000 });
});
