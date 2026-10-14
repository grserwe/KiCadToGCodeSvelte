import { defaultSettings, type GCodeSettings } from '../engine/gcode/settings';

const STORAGE_KEY = 'kicadtogcode.settings.v1';

/**
 * Load persisted settings, merging stored values over the current defaults so
 * newly added settings pick up their defaults automatically (the migration
 * strategy for additive schema changes).
 */
export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): GCodeSettings {
	const defaults = defaultSettings();
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return defaults;
		const stored = JSON.parse(raw) as Partial<GCodeSettings>;
		return { ...defaults, ...sanitize(stored, defaults) };
	} catch {
		return defaults;
	}
}

export function saveSettings(
	settings: GCodeSettings,
	storage: Pick<Storage, 'setItem'> = localStorage
): void {
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage may be unavailable (private browsing); settings just won't persist.
	}
}

export function clearSettings(storage: Pick<Storage, 'removeItem'> = localStorage): void {
	try {
		storage.removeItem(STORAGE_KEY);
	} catch {
		// Ignore.
	}
}

/**
 * Keep only keys whose stored type matches the default's type. Nested setting
 * groups are merged over their defaults so a group can grow new keys later.
 */
function sanitize(stored: Partial<GCodeSettings>, defaults: GCodeSettings): Partial<GCodeSettings> {
	const clean: Record<string, unknown> = {};
	for (const [key, defaultValue] of Object.entries(defaults)) {
		const storedValue = (stored as Record<string, unknown>)[key];
		if (storedValue === undefined) continue;
		if (defaultValue !== null && typeof defaultValue === 'object') {
			const storedGroup =
				storedValue !== null && typeof storedValue === 'object' ? storedValue : {};
			clean[key] = { ...defaultValue, ...storedGroup };
			continue;
		}
		if (key === 'vBitAngleDeg') {
			if (storedValue === null || typeof storedValue === 'number') clean[key] = storedValue;
			continue;
		}
		if (typeof storedValue === typeof defaultValue) {
			clean[key] = storedValue;
		}
	}
	return clean as Partial<GCodeSettings>;
}
