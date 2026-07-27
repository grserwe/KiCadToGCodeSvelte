/**
 * One node of a KiCad S-expression tree, e.g. `(segment (start 1 2) (width 0.25))`
 * becomes { name: 'segment', attributes: [], children: [start-node, width-node] }.
 * Quoted and bare atoms are both plain strings in `attributes`.
 */
export interface SExpr {
	name: string;
	attributes: string[];
	children: SExpr[];
}
