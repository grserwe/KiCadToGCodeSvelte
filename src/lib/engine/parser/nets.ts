import type { SExpr } from '../sexpr/types';
import { findChild, numberAttr } from './sexprHelpers';

/** Reads the net id of a pad, via or track record; 0 = no net. */
export type NetIdReader = (record: SExpr) => number;

/**
 * KiCad files before version 10 list every net at the top of the board,
 * `(net 1 "GND")`, and tracks refer to it by number, `(net 1)`. KiCad 10 drops
 * that table and writes the name on each record, `(net "GND")`, so a board
 * without the table gets a number assigned to each name as it turns up.
 */
export function createNetIdReader(root: SExpr): NetIdReader {
	const hasNetTable = root.children.some((child) => child.name.toLowerCase() === 'net');
	if (hasNetTable) {
		return (record) => numberAttr(findChild(record, 'net'), 0) ?? 0;
	}

	const idsByName = new Map<string, number>();
	return (record) => {
		const name = findChild(record, 'net')?.attributes[0];
		if (!name) return 0;
		let id = idsByName.get(name);
		if (id === undefined) {
			id = idsByName.size + 1;
			idsByName.set(name, id);
		}
		return id;
	};
}
