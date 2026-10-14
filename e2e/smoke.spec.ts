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

	// All five expected files are listed.
	await expect(page.getByText('SampleBoard-top-isolation.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-bottom-isolation.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-drill-0.5mm.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-registration.txt')).toBeVisible();
	await expect(page.getByText('SampleBoard-silkscreen-top.svg')).toBeVisible();

	// Switch to the bottom side.
	await page.getByRole('tab', { name: /bottom side/i }).click();
	await expect(page.getByText(/show as machined/i)).toBeVisible();

	// The GCode viewer replays the drill program and finds nothing wrong.
	await page
		.locator('li', { hasText: 'SampleBoard-drill-0.5mm.txt' })
		.getByRole('button', { name: 'View' })
		.click();
	const viewer = page.getByRole('img', { name: 'GCode toolpath preview' });
	await expect(viewer).toBeVisible();
	expect(await viewer.locator('circle').count()).toBeGreaterThan(4); // plunge markers + origin
	await expect(page.getByText(/\d+ \/ \d+ moves/)).toBeVisible();
	await expect(page.getByText(/no problems found/i)).toBeVisible();
	await page.getByRole('tab', { name: 'Design' }).click();
	await expect(preview).toBeVisible();

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
	expect(zip.suggestedFilename()).toBe('SampleBoard-output.zip');
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

	await page.locator('input[type=file][accept]').setInputFiles({
		name: 'project.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(zipBuffer)
	});

	await expect(page.getByText(/ZippedBoard —/)).toBeVisible({ timeout: 20_000 });
});

test('a broken file shows a friendly error and a retry path', async ({ page }) => {
	await gotoHydrated(page);
	await page.locator('input[type=file][accept]').setInputFiles({
		name: 'broken.kicad_pcb',
		mimeType: 'text/plain',
		buffer: Buffer.from('this is not a kicad file')
	});
	await expect(page.getByText(/could not process this board/i)).toBeVisible({ timeout: 20_000 });
});

/**
 * What the dialog actually posted. Playwright cannot read a multipart body
 * that carries file parts, so the test wraps fetch inside the page and
 * records the FormData fields it cares about.
 */
interface CapturedFeedback {
	message: string | null;
	boardName: string | null;
	pcbName: string | null;
	pcbBytes: number;
	settings: string | null;
}

async function captureFeedback(page: Page): Promise<void> {
	await page.evaluate(() => {
		const original = window.fetch;
		window.fetch = async (input, init) => {
			if (init?.body instanceof FormData) {
				const form = init.body;
				const pcb = form.get('pcb');
				(window as unknown as { __feedback: CapturedFeedback }).__feedback = {
					message: form.get('message') as string | null,
					boardName: form.get('boardName') as string | null,
					pcbName: pcb instanceof File ? pcb.name : null,
					pcbBytes: pcb instanceof File ? pcb.size : 0,
					settings: form.get('settings') as string | null
				};
			}
			return original(input, init);
		};
	});
}

function capturedFeedback(page: Page): Promise<CapturedFeedback> {
	return page.evaluate(() => (window as unknown as { __feedback: CapturedFeedback }).__feedback);
}

test('feedback dialog emails the message with the PCB attached by default', async ({ page }) => {
	await gotoHydrated(page);
	await page.getByRole('button', { name: /try the sample board/i }).click();
	await expect(page.getByText(/21\.6 × 8\.3 mm/)).toBeVisible({ timeout: 20_000 });

	await page.getByRole('button', { name: /report a problem/i }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: /report a problem/i })).toBeVisible();
	const includePcb = dialog.getByRole('checkbox', { name: /include my pcb file/i });
	await expect(includePcb).toBeChecked();
	await expect(dialog.getByText('SampleBoard.kicad_pcb')).toBeVisible();

	// Nothing can be sent until there is a message.
	const send = dialog.getByRole('button', { name: 'Send', exact: true });
	await expect(send).toBeDisabled();
	await dialog.getByLabel('Message').fill('The drill file skips the registration holes.');
	await dialog.getByLabel(/your email/i).fill('maker@example.com');

	// Without SMTP configured the dev server logs the report and reports
	// success; the request itself must still carry the board as a file part.
	await captureFeedback(page);
	await send.click();
	await expect(dialog.getByText(/message sent/i)).toBeVisible({ timeout: 10_000 });
	const sent = await capturedFeedback(page);
	expect(sent.message).toBe('The drill file skips the registration holes.');
	expect(sent.boardName).toBe('SampleBoard');
	expect(sent.pcbName).toBe('SampleBoard.kicad_pcb');
	expect(sent.pcbBytes).toBeGreaterThan(1000);
	expect(sent.settings).toContain('"toolDiameterMm"');

	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(dialog).toBeHidden();
});

test('unticking the PCB checkbox keeps the design out of the report', async ({ page }) => {
	await gotoHydrated(page);
	await page.getByRole('button', { name: /try the sample board/i }).click();
	await expect(page.getByText(/21\.6 × 8\.3 mm/)).toBeVisible({ timeout: 20_000 });

	await page
		.getByRole('banner')
		.getByRole('button', { name: /send feedback/i })
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('checkbox', { name: /include my pcb file/i }).uncheck();
	await dialog.getByLabel('Message').fill('Just saying thanks.');

	await captureFeedback(page);
	await dialog.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(dialog.getByText(/message sent/i)).toBeVisible({ timeout: 10_000 });
	const sent = await capturedFeedback(page);
	expect(sent.pcbName).toBeNull();
	expect(sent.boardName).toBe('SampleBoard');
});
