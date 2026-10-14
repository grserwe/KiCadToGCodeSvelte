/**
 * The feedback report a user sends from the app, and the email built from it.
 *
 * Kept free of SvelteKit imports so the client dialog, the API endpoint and the
 * unit tests all share one definition of what a report contains.
 */

/** Hard limits enforced by both the dialog (early, friendly) and the endpoint (authoritative). */
export const FEEDBACK_LIMITS = {
	messageMaxChars: 5000,
	/** Extra files the user may attach beyond the PCB itself. */
	maxExtraAttachments: 5,
	/** Total bytes across the PCB and every extra attachment. */
	maxTotalBytes: 20 * 1024 * 1024
} as const;

export interface FeedbackReport {
	message: string;
	/** Optional address to reply to; the report is otherwise anonymous. */
	replyTo?: string;
	boardName?: string;
	/** Whether the user chose to share their PCB file. */
	pcbIncluded: boolean;
	/** A JSON snapshot of the settings in force when the report was sent. */
	settingsJson?: string;
	/** Warnings the engine showed for the board. */
	warnings: string[];
	/** The conversion error on screen, if the board failed to convert. */
	error?: string;
	userAgent?: string;
}

export interface AttachmentSummary {
	fileName: string;
	bytes: number;
}

export interface FeedbackEmail {
	subject: string;
	text: string;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Loose check that a reply address could plausibly be delivered to. */
export function isPlausibleEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Builds the plain-text email body and subject for a report. */
export function buildFeedbackEmail(
	report: FeedbackReport,
	attachments: AttachmentSummary[],
	sentAt: Date = new Date()
): FeedbackEmail {
	const subject = report.boardName
		? `[KiCadToGCode] Problem with ${report.boardName}`
		: '[KiCadToGCode] Feedback';

	const lines: string[] = [];
	lines.push(report.message.trim(), '');
	lines.push('----------------------------------------');
	lines.push(`Sent: ${sentAt.toISOString()}`);
	lines.push(`Reply to: ${report.replyTo?.trim() || '(not given)'}`);
	lines.push(`Board: ${report.boardName ?? '(no board loaded)'}`);
	lines.push(
		`PCB file: ${report.pcbIncluded ? 'attached' : report.boardName ? 'not shared' : 'n/a'}`
	);
	if (report.error) lines.push(`Conversion error: ${report.error}`);
	if (report.userAgent) lines.push(`Browser: ${report.userAgent}`);

	lines.push('', 'Attachments:');
	if (attachments.length === 0) lines.push('  (none)');
	for (const attachment of attachments) {
		lines.push(`  ${attachment.fileName} (${formatBytes(attachment.bytes)})`);
	}

	lines.push('', 'Warnings shown:');
	if (report.warnings.length === 0) lines.push('  (none)');
	for (const warning of report.warnings) lines.push(`  - ${warning}`);

	lines.push('', 'Settings:');
	lines.push(report.settingsJson ? prettyJson(report.settingsJson) : '  (not captured)');

	return { subject, text: lines.join('\n') };
}

function prettyJson(json: string): string {
	try {
		return JSON.stringify(JSON.parse(json), null, 2);
	} catch {
		return json;
	}
}
