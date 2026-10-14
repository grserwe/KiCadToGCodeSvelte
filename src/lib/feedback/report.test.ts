import { describe, expect, it } from 'vitest';
import { buildFeedbackEmail, formatBytes, isPlausibleEmail } from './report';

describe('buildFeedbackEmail', () => {
	const sentAt = new Date('2026-10-14T12:00:00Z');

	it('names the board in the subject and lists everything the user shared', () => {
		const email = buildFeedbackEmail(
			{
				message: '  The bottom isolation misses a pad.  ',
				replyTo: 'maker@example.com',
				boardName: 'Blinky',
				pcbIncluded: true,
				settingsJson: '{"toolDiameterMm":0.2}',
				warnings: ['1 copper zone was skipped'],
				userAgent: 'TestBrowser/1.0'
			},
			[{ fileName: 'Blinky.kicad_pcb', bytes: 2048 }],
			sentAt
		);
		expect(email.subject).toBe('[KiCadToGCode] Problem with Blinky');
		expect(email.text).toContain('The bottom isolation misses a pad.');
		expect(email.text).toContain('Reply to: maker@example.com');
		expect(email.text).toContain('PCB file: attached');
		expect(email.text).toContain('Blinky.kicad_pcb (2.0 KB)');
		expect(email.text).toContain('- 1 copper zone was skipped');
		expect(email.text).toContain('"toolDiameterMm": 0.2');
		expect(email.text).toContain('Browser: TestBrowser/1.0');
		expect(email.text).toContain('Sent: 2026-10-14T12:00:00.000Z');
	});

	it('says when the PCB was deliberately withheld', () => {
		const email = buildFeedbackEmail(
			{ message: 'Hi', boardName: 'Blinky', pcbIncluded: false, warnings: [] },
			[],
			sentAt
		);
		expect(email.text).toContain('PCB file: not shared');
		expect(email.text).toContain('Attachments:\n  (none)');
	});

	it('falls back to a generic subject with no board loaded', () => {
		const email = buildFeedbackEmail(
			{ message: 'Love it', pcbIncluded: false, warnings: [], error: 'Unexpected token' },
			[],
			sentAt
		);
		expect(email.subject).toBe('[KiCadToGCode] Feedback');
		expect(email.text).toContain('Board: (no board loaded)');
		expect(email.text).toContain('PCB file: n/a');
		expect(email.text).toContain('Conversion error: Unexpected token');
		expect(email.text).toContain('Reply to: (not given)');
	});
});

describe('helpers', () => {
	it('formats byte counts for humans', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
	});

	it('accepts ordinary addresses and rejects junk', () => {
		expect(isPlausibleEmail('maker@example.com')).toBe(true);
		expect(isPlausibleEmail('not an email')).toBe(false);
		expect(isPlausibleEmail('missing@tld')).toBe(false);
	});
});
