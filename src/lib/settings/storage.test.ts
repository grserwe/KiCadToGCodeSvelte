import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../engine/gcode/settings';
import { clearSettings, loadSettings, saveSettings } from './storage';

class FakeStorage {
	private store = new Map<string, string>();
	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}
	removeItem(key: string): void {
		this.store.delete(key);
	}
}

describe('settings storage', () => {
	it('returns defaults when nothing is stored', () => {
		expect(loadSettings(new FakeStorage())).toEqual(defaultSettings());
	});

	it('round-trips a modified settings object', () => {
		const storage = new FakeStorage();
		const settings = {
			...defaultSettings(),
			toolDiameterMm: 0.3,
			outputUnits: 'mm' as const,
			registrationHoles: { enabled: false, diameterMm: 2, marginMm: 7 }
		};
		saveSettings(settings, storage);
		expect(loadSettings(storage)).toEqual(settings);
	});

	it('merges partial stored data over defaults (additive migration)', () => {
		const storage = new FakeStorage();
		storage.setItem('kicadtogcode.settings.v1', JSON.stringify({ isolationDepth: 0.5 }));
		const loaded = loadSettings(storage);
		expect(loaded.isolationDepth).toBe(0.5);
		expect(loaded.drillDepth).toBe(defaultSettings().drillDepth);
		expect(loaded.registrationHoles).toEqual(defaultSettings().registrationHoles);
	});

	it('ignores stored values of the wrong type', () => {
		const storage = new FakeStorage();
		storage.setItem(
			'kicadtogcode.settings.v1',
			JSON.stringify({ isolationDepth: 'deep', flipX: 'yes', vBitAngleDeg: 45 })
		);
		const loaded = loadSettings(storage);
		expect(loaded.isolationDepth).toBe(defaultSettings().isolationDepth);
		expect(loaded.flipX).toBe(false);
		expect(loaded.vBitAngleDeg).toBe(45);
	});

	it('survives corrupted JSON', () => {
		const storage = new FakeStorage();
		storage.setItem('kicadtogcode.settings.v1', '{not json');
		expect(loadSettings(storage)).toEqual(defaultSettings());
	});

	it('clears stored settings', () => {
		const storage = new FakeStorage();
		saveSettings({ ...defaultSettings(), toolDiameterMm: 9 }, storage);
		clearSettings(storage);
		expect(loadSettings(storage)).toEqual(defaultSettings());
	});
});
