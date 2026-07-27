/** Fatal problem with the input file — nothing usable could be parsed. */
export class BoardParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BoardParseError';
	}
}
