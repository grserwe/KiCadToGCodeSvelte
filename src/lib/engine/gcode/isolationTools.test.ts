import { describe, expect, it } from 'vitest';
import {
	applyIsolationTool,
	cutToMm,
	cutWidthMm,
	defaultIsolationTools,
	defaultToolName,
	recommendIsolationCut,
	restoreDefaultTools,
	settingsMatchTool,
	toolFromSettings,
	type IsolationTool
} from './isolationTools';
import { defaultSettings } from './settings';

function tool(overrides: Partial<IsolationTool> = {}): IsolationTool {
	return {
		id: 't1',
		name: 'test',
		kind: 'vbit',
		tipDiameterMm: 0.2,
		angleDeg: 30,
		...cutToMm(recommendIsolationCut('vbit', 0.2, 30, 'inch', 10000), 'inch'),
		...overrides
	};
}

describe('recommendIsolationCut', () => {
	it('recommends a shallow cut and two passes for a 30° 0.2 mm V-bit', () => {
		const cut = recommendIsolationCut('vbit', 0.2, 30, 'inch', 12000);
		expect(cut).toEqual({
			depth: 0.003,
			xySpeed: 16,
			plungeSpeed: 4,
			spindleRPM: 12000,
			passes: 2,
			stepover: 0.5
		});
	});

	it('slows a 0.2 mm end mill down', () => {
		const cut = recommendIsolationCut('endmill', 0.2, 30, 'mm', 10000);
		expect(cut.depth).toBe(0.075);
		expect(cut.xySpeed).toBe(250);
		expect(cut.plungeSpeed).toBe(63);
		expect(cut.passes).toBe(2);
	});

	it('uses one pass when the bit already cuts wide', () => {
		expect(recommendIsolationCut('endmill', 0.8, 30, 'mm', 10000).passes).toBe(1);
		expect(recommendIsolationCut('vbit', 0.2, 90, 'mm', 10000).passes).toBe(1);
	});

	it('caps end mill feed for large and small cutters', () => {
		expect(recommendIsolationCut('endmill', 2, 30, 'mm', 10000).xySpeed).toBe(500);
		expect(recommendIsolationCut('endmill', 0.05, 30, 'mm', 10000).xySpeed).toBe(150);
	});
});

describe('cutWidthMm', () => {
	it('adds the cone to a V-bit tip and ignores depth for an end mill', () => {
		expect(cutWidthMm('vbit', 0.2, 30, 0.1)).toBeCloseTo(0.2 + 0.2 * Math.tan(Math.PI / 12), 6);
		expect(cutWidthMm('endmill', 0.2, 30, 0.5)).toBe(0.2);
	});
});

describe('applying a tool', () => {
	it('copies the bit and cut into the settings in output units', () => {
		const settings = defaultSettings();
		applyIsolationTool(settings, tool());
		expect(settings.isolationToolId).toBe('t1');
		expect(settings.toolDiameterMm).toBe(0.2);
		expect(settings.vBitAngleDeg).toBe(30);
		expect(settings.isolationDepth).toBe(0.003);
		expect(settings.isolationXYSpeed).toBe(16);
		expect(settings.isolationPasses).toBe(2);
		expect(settingsMatchTool(settings, tool())).toBe(true);
	});

	it('converts to millimeters when those are the output units', () => {
		const settings = { ...defaultSettings(), outputUnits: 'mm' as const };
		applyIsolationTool(settings, tool());
		expect(settings.isolationDepth).toBeCloseTo(0.076, 3);
		expect(settings.isolationXYSpeed).toBeCloseTo(406.4, 1);
	});

	it('clears the V-bit angle for an end mill', () => {
		const settings = defaultSettings();
		settings.vBitAngleDeg = 60;
		applyIsolationTool(settings, tool({ kind: 'endmill' }));
		expect(settings.vBitAngleDeg).toBeNull();
	});

	it('notices a hand edit after applying, and can save it back', () => {
		const settings = defaultSettings();
		const t = tool();
		applyIsolationTool(settings, t);
		settings.isolationXYSpeed = 12;
		expect(settingsMatchTool(settings, t)).toBe(false);
		const saved = toolFromSettings(settings, t);
		expect(saved.id).toBe('t1');
		expect(saved.xySpeedMmPerMin).toBeCloseTo(12 * 25.4, 6);
		expect(settingsMatchTool(settings, saved)).toBe(true);
	});
});

describe('default tools', () => {
	it('covers 30/45/60/90° V-bits and end mills at 0.1/0.2/0.3 mm', () => {
		const tools = defaultIsolationTools('inch', 10000);
		expect(tools).toHaveLength(15);
		expect(tools.filter((t) => t.kind === 'vbit').map((t) => t.name)).toContain(
			'90° V-bit, 0.3 mm tip'
		);
		expect(tools.filter((t) => t.kind === 'endmill').map((t) => t.tipDiameterMm)).toEqual([
			0.1, 0.2, 0.3
		]);
		expect(new Set(tools.map((t) => t.id)).size).toBe(15);
	});

	it('puts each default on its recommended settings', () => {
		const tool = defaultIsolationTools('inch', 10000).find((t) => t.id === 'default-vbit-30-0.2')!;
		const settings = defaultSettings();
		applyIsolationTool(settings, tool);
		const rec = recommendIsolationCut('vbit', 0.2, 30, 'inch', 10000);
		expect(settings.isolationDepth).toBe(rec.depth);
		expect(settings.isolationXYSpeed).toBe(rec.xySpeed);
		expect(settings.isolationPasses).toBe(rec.passes);
	});

	it('restores only missing defaults and keeps the user’s tools and edits', () => {
		const defaults = defaultIsolationTools('inch', 10000);
		const edited = { ...defaults[0], name: 'My favorite' };
		const own = tool({ id: 'mine' });
		const restored = restoreDefaultTools([edited, own], 'inch', 10000);
		expect(restored).toHaveLength(16);
		expect(restored[0].name).toBe('My favorite');
		expect(restored[1].id).toBe('mine');
		expect(restoreDefaultTools(restored, 'inch', 10000)).toHaveLength(16);
	});
});

describe('defaultToolName', () => {
	it('names V-bits and end mills', () => {
		expect(defaultToolName('vbit', 0.2, 30)).toBe('30° V-bit, 0.2 mm tip');
		expect(defaultToolName('endmill', 0.2, 30)).toBe('0.2 mm end mill');
	});
});
