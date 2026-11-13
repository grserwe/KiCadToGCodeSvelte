import type { IsolationTool } from '../engine/gcode/isolationTools';

/**
 * Kept apart from the settings so "Reset to defaults" leaves the library alone.
 */
const STORAGE_KEY = 'kicadtogcode.tools.v1';

/**
 * The saved library, or null when none was ever saved (so the caller can seed
 * the defaults). A saved empty list stays empty.
 */
export function loadToolLibrary(
	storage: Pick<Storage, 'getItem'> = localStorage
): IsolationTool[] | null {
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (raw === null) return null;
		const stored: unknown = JSON.parse(raw);
		if (!Array.isArray(stored)) return [];
		return stored.filter(isTool);
	} catch {
		return [];
	}
}

export function saveToolLibrary(
	tools: IsolationTool[],
	storage: Pick<Storage, 'setItem'> = localStorage
): void {
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(tools));
	} catch {
		// Storage may be unavailable (private browsing); the library just won't persist.
	}
}

export function newToolId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isTool(value: unknown): value is IsolationTool {
	if (value === null || typeof value !== 'object') return false;
	const t = value as Record<string, unknown>;
	const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
	const nonNegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
	return (
		typeof t.id === 'string' &&
		typeof t.name === 'string' &&
		(t.kind === 'vbit' || t.kind === 'endmill') &&
		nonNegative(t.tipDiameterMm) &&
		positive(t.angleDeg) &&
		positive(t.depthMm) &&
		positive(t.xySpeedMmPerMin) &&
		positive(t.plungeSpeedMmPerMin) &&
		nonNegative(t.spindleRPM) &&
		typeof t.passes === 'number' &&
		Number.isInteger(t.passes) &&
		t.passes >= 1 &&
		positive(t.stepover)
	);
}
