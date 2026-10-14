import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '$env/dynamic/private';

/**
 * Outbound email over SMTP, used to deliver user feedback to the site owner.
 *
 * Configured with SMTP_HOST / SMTP_USER / SMTP_PASS (and optionally SMTP_PORT,
 * EMAIL_FROM). Production uses Resend's SMTP relay (smtp.resend.com:465, user
 * `resend`, password = API key, EMAIL_FROM on the verified kicadtogcode.com
 * domain). The same env vars work with any other SMTP provider.
 *
 * When SMTP is not configured — local dev and E2E tests — messages are logged
 * to the console instead of sent, so the app runs without credentials.
 */

export interface EmailAttachment {
	filename: string;
	content: string | Buffer;
}

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	replyTo?: string;
	attachments?: EmailAttachment[];
}

let cached: Transporter | null = null;
let resolved = false;

function getTransporter(): Transporter | null {
	if (resolved) return cached;
	resolved = true;

	const host = env.SMTP_HOST;
	const user = env.SMTP_USER;
	const pass = env.SMTP_PASS;
	if (!host || !user || !pass) return (cached = null);

	const port = Number(env.SMTP_PORT || '465');
	cached = nodemailer.createTransport({
		host,
		port,
		secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
		auth: { user, pass }
	});
	return cached;
}

export function isEmailConfigured(): boolean {
	return getTransporter() !== null;
}

/**
 * The From address. EMAIL_FROM wins; SMTP_USER is only a usable fallback when it
 * is itself an address — Resend's SMTP user is the literal `resend`.
 */
export function senderAddress(emailFrom: string | undefined, smtpUser: string | undefined): string {
	const from = emailFrom?.trim();
	if (from) return from;
	const user = smtpUser?.trim();
	if (user?.includes('@')) return user;
	return 'no-reply@kicadtogcode.com';
}

export async function sendEmail(message: EmailMessage): Promise<void> {
	const transporter = getTransporter();

	if (!transporter) {
		const attached = (message.attachments ?? [])
			.map((attachment) => `\n  attachment: ${attachment.filename}`)
			.join('');
		console.info(
			`[email] SMTP not configured — not sent.\n  to: ${message.to}\n  reply-to: ${message.replyTo ?? '-'}\n  subject: ${message.subject}${attached}\n${message.text}`
		);
		return;
	}

	await transporter.sendMail({
		from: senderAddress(env.EMAIL_FROM, env.SMTP_USER),
		to: message.to,
		replyTo: message.replyTo,
		subject: message.subject,
		text: message.text,
		attachments: message.attachments
	});
}
