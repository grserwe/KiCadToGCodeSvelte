import { json, type RequestHandler } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import {
	buildFeedbackEmail,
	FEEDBACK_LIMITS,
	isPlausibleEmail,
	type AttachmentSummary,
	type FeedbackReport
} from '$lib/feedback/report';
import { isEmailConfigured, sendEmail, type EmailAttachment } from '$lib/server/email';

/**
 * Receives a feedback report from the dialog (multipart form data) and emails
 * it to the site owner. The app is otherwise fully client-side, so this is the
 * one place a user's design can leave their machine — and only when they chose
 * to attach it.
 *
 * Fields: message, email (optional reply-to), boardName, settings (JSON),
 * warnings (JSON string[]), error, pcb (File, optional), attachments (File[],
 * optional), website (honeypot — must stay empty).
 */

/** Where reports are delivered. Override with FEEDBACK_TO. */
const DEFAULT_RECIPIENT = 'KiCadToGCode@outlook.com';

// A light brake on abuse: the endpoint is unauthenticated and sends real mail.
const RATE_LIMIT = { maxPerWindow: 5, windowMs: 15 * 60 * 1000 };
const recentSends = new Map<string, number[]>();

function isRateLimited(key: string, now: number): boolean {
	const cutoff = now - RATE_LIMIT.windowMs;
	const times = (recentSends.get(key) ?? []).filter((time) => time > cutoff);
	if (times.length >= RATE_LIMIT.maxPerWindow) {
		recentSends.set(key, times);
		return true;
	}
	times.push(now);
	recentSends.set(key, times);
	// Keep the map from growing without bound on a long-lived machine.
	if (recentSends.size > 1000) {
		for (const [other, otherTimes] of recentSends) {
			if (!otherTimes.some((time) => time > cutoff)) recentSends.delete(other);
		}
	}
	return false;
}

function text(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

function files(form: FormData, name: string): File[] {
	return form
		.getAll(name)
		.filter((value): value is File => value instanceof File && value.size > 0);
}

function parseWarnings(raw: string): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map(String).slice(0, 50) : [];
	} catch {
		return [];
	}
}

const fail = (status: number, message: string) => json({ ok: false, message }, { status });

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!isEmailConfigured() && !dev) {
		return fail(
			503,
			`Feedback isn't set up on this server yet — please email ${env.FEEDBACK_TO || DEFAULT_RECIPIENT} directly.`
		);
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return fail(400, 'Could not read the feedback form.');
	}

	// Bots fill every field; people never see this one.
	if (text(form, 'website')) return json({ ok: true });

	const clientKey = request.headers.get('fly-client-ip') || getClientAddress();
	if (isRateLimited(clientKey, Date.now())) {
		return fail(429, 'Too many messages in a short time — please try again later.');
	}

	const message = text(form, 'message').trim();
	if (!message) return fail(400, 'Please write a message first.');
	if (message.length > FEEDBACK_LIMITS.messageMaxChars) {
		return fail(
			400,
			`Please keep the message under ${FEEDBACK_LIMITS.messageMaxChars} characters.`
		);
	}

	const replyTo = text(form, 'email').trim();
	if (replyTo && !isPlausibleEmail(replyTo)) {
		return fail(400, "That doesn't look like an email address.");
	}

	const pcb = files(form, 'pcb')[0];
	const extras = files(form, 'attachments');
	if (extras.length > FEEDBACK_LIMITS.maxExtraAttachments) {
		return fail(400, `Please attach at most ${FEEDBACK_LIMITS.maxExtraAttachments} extra files.`);
	}
	const totalBytes = (pcb?.size ?? 0) + extras.reduce((sum, file) => sum + file.size, 0);
	if (totalBytes > FEEDBACK_LIMITS.maxTotalBytes) {
		return fail(
			413,
			`Attachments total ${(totalBytes / 1048576).toFixed(1)} MB; the limit is ${FEEDBACK_LIMITS.maxTotalBytes / 1048576} MB.`
		);
	}

	const report: FeedbackReport = {
		message,
		replyTo: replyTo || undefined,
		boardName: text(form, 'boardName').trim() || undefined,
		pcbIncluded: Boolean(pcb),
		settingsJson: text(form, 'settings') || undefined,
		warnings: parseWarnings(text(form, 'warnings')),
		error: text(form, 'error').trim() || undefined,
		userAgent: request.headers.get('user-agent') ?? undefined
	};

	const attachments: EmailAttachment[] = [];
	const summaries: AttachmentSummary[] = [];
	for (const file of [...(pcb ? [pcb] : []), ...extras]) {
		attachments.push({ filename: file.name, content: Buffer.from(await file.arrayBuffer()) });
		summaries.push({ fileName: file.name, bytes: file.size });
	}

	const email = buildFeedbackEmail(report, summaries);
	try {
		await sendEmail({
			to: env.FEEDBACK_TO || DEFAULT_RECIPIENT,
			replyTo: report.replyTo,
			subject: email.subject,
			text: email.text,
			attachments
		});
	} catch (sendError) {
		console.error('[feedback] send failed', sendError);
		return fail(502, 'The message could not be sent right now — please try again later.');
	}

	return json({ ok: true });
};
