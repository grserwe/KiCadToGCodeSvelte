import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { boardNameFromPath, extractPcbFromZip } from './extractPcb';

const sample = readFileSync(
	new URL('../__fixtures__/TopAndBottomLayer.kicad_pcb', import.meta.url),
	'utf8'
);

describe('extractPcbFromZip', () => {
	it('finds the board inside a nested project folder', () => {
		const zip = zipSync({
			'MyProject/MyBoard.kicad_pcb': strToU8(sample),
			'MyProject/MyBoard.kicad_sch': strToU8('(kicad_sch)'),
			'MyProject/MyBoard.kicad_pro': strToU8('{}')
		});
		const candidates = extractPcbFromZip(zip);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].path).toBe('MyProject/MyBoard.kicad_pcb');
		expect(candidates[0].contents).toContain('(kicad_pcb');
	});

	it('skips macOS junk entries and orders shallowest first', () => {
		const zip = zipSync({
			'__MACOSX/._Board.kicad_pcb': strToU8('junk'),
			'deep/nested/Backup.kicad_pcb': strToU8(sample),
			'Board.kicad_pcb': strToU8(sample)
		});
		const candidates = extractPcbFromZip(zip);
		expect(candidates.map((c) => c.path)).toEqual([
			'Board.kicad_pcb',
			'deep/nested/Backup.kicad_pcb'
		]);
	});

	it('throws a friendly error when no board is present', () => {
		const zip = zipSync({ 'readme.txt': strToU8('hello') });
		expect(() => extractPcbFromZip(zip)).toThrow(/no \.kicad_pcb file/i);
	});

	it('throws a friendly error for garbage input', () => {
		expect(() => extractPcbFromZip(strToU8('not a zip'))).toThrow(/could not be read/i);
	});
});

describe('boardNameFromPath', () => {
	it('derives the board name from the file name', () => {
		expect(boardNameFromPath('MyProject/MyBoard.kicad_pcb')).toBe('MyBoard');
		expect(boardNameFromPath('Board.kicad_pcb')).toBe('Board');
	});
});
