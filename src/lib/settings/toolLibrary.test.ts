import { describe, expect, it } from 'vitest';
import { loadToolLibrary, saveToolLibrary } from './toolLibrary';
import type { IsolationTool } from '../engine/gcode/isolationTools';

class FakeStorage {
	private data = new Map<string, string>();
	getItem(key: string) {
		return this.data.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.data.set(key, value);
	}
}

const vbit: IsolationTool = {
	id: 'a',
	name: '30° V-bit',
	kind: 'vbit',
	tipDiameterMm: 0.2,
	angleDeg: 30,
	depthMm: 0.0762,
	xySpeedMmPerMin: 406.4,
	plungeSpeedMmPerMin: 101.6,
	spindleRPM: 10000,
	passes: 2,
	stepover: 0.5
};

describe('tool library storage', () => {
	it('round-trips tools', () => {
		const storage = new FakeStorage();
		saveToolLibrary([vbit], storage);
		expect(loadToolLibrary(storage)).toEqual([vbit]);
	});

	it('reports a never-saved library as null, so the defaults can be seeded', () => {
		expect(loadToolLibrary(new FakeStorage())).toBeNull();
	});

	it('keeps a saved empty library empty', () => {
		const storage = new FakeStorage();
		saveToolLibrary([], storage);
		expect(loadToolLibrary(storage)).toEqual([]);
	});

	it('loads an empty library when the data is not a list', () => {
		const storage = new FakeStorage();
		storage.setItem('kicadtogcode.tools.v1', '{"oops":1}');
		expect(loadToolLibrary(storage)).toEqual([]);
		storage.setItem('kicadtogcode.tools.v1', 'not json');
		expect(loadToolLibrary(storage)).toEqual([]);
	});

	it('drops malformed entries and keeps the good ones', () => {
		const storage = new FakeStorage();
		storage.setItem(
			'kicadtogcode.tools.v1',
			JSON.stringify([vbit, { ...vbit, id: 'b', kind: 'drill' }, { ...vbit, id: 'c', passes: 0 }])
		);
		expect(loadToolLibrary(storage)?.map((t) => t.id)).toEqual(['a']);
	});
});
