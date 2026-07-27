import type { SExpr } from '../sexpr/types';

export function findChild(node: SExpr, name: string): SExpr | undefined {
	return node.children.find((child) => child.name.toLowerCase() === name);
}

/** Depth-first search for every node with the given name in a subtree. */
export function findAllRecursive(node: SExpr, name: string, results: SExpr[] = []): SExpr[] {
	for (const child of node.children) {
		if (child.name.toLowerCase() === name) {
			results.push(child);
		}
		findAllRecursive(child, name, results);
	}
	return results;
}

export function numberAttr(node: SExpr | undefined, index: number): number | undefined {
	const raw = node?.attributes[index];
	if (raw === undefined) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

/** Read the first attribute of a named child as a number, e.g. `(width 0.25)`. */
export function childNumber(node: SExpr, childName: string): number | undefined {
	return numberAttr(findChild(node, childName), 0);
}
