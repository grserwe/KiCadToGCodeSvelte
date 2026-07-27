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

test('settings changes regenerate output and persist across reloads', async ({ page }) => {
	await gotoHydrated(page);
	await page.getByRole('button', { name: /try the sample board/i }).click();
	await expect(page.getByText(/21\.6 × 8\.3 mm/)).toBeVisible({ timeout: 20_000 });

	// Change the file extension setting (Output & origin group).
	await page.getByRole('button', { name: /output & origin/i }).click();
	await page.locator('label', { hasText: 'File extension' }).locator('select').selectOption('.nc');

	// The file list regenerates with the new extension (after debounce).
	await expect(page.getByText('SampleBoard-top-isolation.nc')).toBeVisible({ timeout: 20_000 });

	// The setting persists across a reload.
	await gotoHydrated(page);
	await page.getByRole('button', { name: /try the sample board/i }).click();
	await expect(page.getByText('SampleBoard-top-isolation.nc')).toBeVisible({ timeout: 20_000 });
});

test('a zipped project extracts its board file', async ({ page }) => {
	await gotoHydrated(page);

	// Build a zip in the browser from the served sample and load it through
	// the real file input.
	const zipBuffer = await page.evaluate(async () => {
		const response = await fetch('/samples/TopAndBottomLayer.kicad_pcb');
		const text = await response.text();
		// Minimal STORED-entry zip built by hand to avoid a bundler import.
		const encoder = new TextEncoder();
		const name = encoder.encode('Project/ZippedBoard.kicad_pcb');
		const data = encoder.encode(text);
		const crcTable = Array.from({ length: 256 }, (_, n) => {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			return c >>> 0;
		});
		let crc = 0xffffffff;
		for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
		crc = (crc ^ 0xffffffff) >>> 0;
		const le = (value: number, bytes: number) =>
			Array.from({ length: bytes }, (_, i) => (value >>> (8 * i)) & 0xff);
		const local = [
			...le(0x04034b50, 4),
			...le(20, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 2),
			...le(crc, 4),
			...le(data.length, 4),
			...le(data.length, 4),
			...le(name.length, 2),
			...le(0, 2),
			...name,
			...data
		];
		const central = [
			...le(0x02014b50, 4),
			...le(20, 2),
			...le(20, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 2),
			...le(crc, 4),
			...le(data.length, 4),
			...le(data.length, 4),
			...le(name.length, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 2),
			...le(0, 4),
			...le(0, 4),
			...name
		];
		const end = [
			...le(0x06054b50, 4),
			...le(0, 2),
			...le(0, 2),
			...le(1, 2),
			...le(1, 2),
			...le(central.length, 4),
			...le(local.length, 4),
			...le(0, 2)
		];
		return [...local, ...central, ...end];
	});

	await page.locator('input[type=file]').setInputFiles({
		name: 'project.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(zipBuffer)
	});

	await expect(page.getByText(/ZippedBoard —/)).toBeVisible({ timeout: 20_000 });
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
