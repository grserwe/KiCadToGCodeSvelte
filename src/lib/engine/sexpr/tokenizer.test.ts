import { describe, expect, it } from 'vitest';
import { parseSExpression, SExprParseError } from './tokenizer';

describe('parseSExpression', () => {
	it('parses names, attributes, and nested children', () => {
		const root = parseSExpression('(segment (start 1 2.5) (end -3 4) (width 0.25))');
		expect(root.name).toBe('segment');
		expect(root.children).toHaveLength(3);
		expect(root.children[0]).toEqual({ name: 'start', attributes: ['1', '2.5'], children: [] });
		expect(root.children[1].attributes).toEqual(['-3', '4']);
	});

	it('handles quoted strings containing spaces and parentheses', () => {
		// The old C# split-on-"(" parser corrupted exactly this kind of input.
		const root = parseSExpression('(net 1 "Net-(J1-Pad1)")');
		expect(root.attributes).toEqual(['1', 'Net-(J1-Pad1)']);

		const layer = parseSExpression('(layer "F.Cu")');
		expect(layer.attributes).toEqual(['F.Cu']);

		const spaced = parseSExpression('(title "My Cool Board (rev 2)")');
		expect(spaced.attributes).toEqual(['My Cool Board (rev 2)']);
	});

	it('handles backslash escapes in quoted strings', () => {
		const root = parseSExpression('(property "Value" "5\\" screw \\\\ pad")');
		expect(root.attributes).toEqual(['Value', '5" screw \\ pad']);
	});

	it('accepts CRLF line endings and tab indentation', () => {
		const root = parseSExpression('(kicad_pcb\r\n\t(version 20241229)\r\n\t(net 0 "")\r\n)');
		expect(root.name).toBe('kicad_pcb');
		expect(root.children.map((c) => c.name)).toEqual(['version', 'net']);
		expect(root.children[1].attributes).toEqual(['0', '']);
	});

	it('reports line and column for unterminated input', () => {
		expect(() => parseSExpression('(kicad_pcb\n  (version 5)\n')).toThrow(SExprParseError);
		try {
			parseSExpression('(kicad_pcb\n  (version 5)\n');
		} catch (error) {
			expect((error as SExprParseError).line).toBe(3);
		}
	});

	it('rejects trailing garbage after the root node', () => {
		expect(() => parseSExpression('(a)(b)')).toThrow(SExprParseError);
	});

	it('rejects empty node names', () => {
		expect(() => parseSExpression('(())')).toThrow(SExprParseError);
	});
});
