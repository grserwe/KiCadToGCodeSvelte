import type { SExpr } from './types';

export class SExprParseError extends Error {
	constructor(
		message: string,
		public readonly line: number,
		public readonly column: number
	) {
		super(`${message} (line ${line}, column ${column})`);
		this.name = 'SExprParseError';
	}
}

/**
 * Parse KiCad S-expression text into a tree. Character-level scanner that
 * handles quoted strings (layer names like "F.Cu", net names containing
 * spaces or parentheses) with C-style backslash escapes.
 */
export function parseSExpression(text: string): SExpr {
	const scanner = new Scanner(text);
	scanner.skipWhitespace();
	if (scanner.peek() !== '(') {
		scanner.fail('Expected "(" at start of file');
	}
	const root = scanner.parseNode();
	scanner.skipWhitespace();
	if (!scanner.atEnd()) {
		scanner.fail('Unexpected content after closing ")"');
	}
	return root;
}

class Scanner {
	private index = 0;
	private line = 1;
	private column = 1;

	constructor(private readonly text: string) {
		// Skip a UTF-8 BOM if present.
		if (text.charCodeAt(0) === 0xfeff) {
			this.index = 1;
		}
	}

	atEnd(): boolean {
		return this.index >= this.text.length;
	}

	peek(): string {
		return this.text[this.index] ?? '';
	}

	fail(message: string): never {
		throw new SExprParseError(message, this.line, this.column);
	}

	private advance(): string {
		const char = this.text[this.index++];
		if (char === '\n') {
			this.line++;
			this.column = 1;
		} else {
			this.column++;
		}
		return char;
	}

	skipWhitespace(): void {
		while (!this.atEnd() && ' \t\r\n'.includes(this.peek())) {
			this.advance();
		}
	}

	parseNode(): SExpr {
		this.advance(); // consume '('
		this.skipWhitespace();

		const node: SExpr = { name: '', attributes: [], children: [] };

		if (this.peek() === ')' || this.peek() === '(') {
			this.fail('Expected a node name after "("');
		}
		node.name = this.parseAtom();

		for (;;) {
			this.skipWhitespace();
			if (this.atEnd()) {
				this.fail('Unexpected end of file inside "(' + node.name + '"');
			}
			const char = this.peek();
			if (char === ')') {
				this.advance();
				return node;
			}
			if (char === '(') {
				node.children.push(this.parseNode());
			} else {
				node.attributes.push(this.parseAtom());
			}
		}
	}

	private parseAtom(): string {
		if (this.peek() === '"') {
			return this.parseQuotedString();
		}
		let atom = '';
		while (!this.atEnd() && !' \t\r\n()'.includes(this.peek())) {
			atom += this.advance();
		}
		return atom;
	}

	private parseQuotedString(): string {
		this.advance(); // consume opening quote
		let value = '';
		for (;;) {
			if (this.atEnd()) {
				this.fail('Unterminated quoted string');
			}
			const char = this.advance();
			if (char === '"') {
				return value;
			}
			if (char === '\\' && !this.atEnd()) {
				const escaped = this.advance();
				switch (escaped) {
					case 'n':
						value += '\n';
						break;
					case 't':
						value += '\t';
						break;
					case 'r':
						value += '\r';
						break;
					default:
						value += escaped;
				}
			} else {
				value += char;
			}
		}
	}
}
