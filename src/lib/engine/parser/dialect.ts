import type { SExpr } from '../sexpr/types';
import { findChild } from './sexprHelpers';

/**
 * KiCad file-format dialect differences. Files with version >= 20211014
 * (KiCad 6+) use `footprint` records and per-pad `net` names; older files
 * use `module` records. Mirrors the C# Version6Parser/Version3Parser split.
 */
export interface Dialect {
	footprintNodeName: 'footprint' | 'module';
	isPadGround(padRecord: SExpr): boolean;
}

export const MODERN_VERSION_THRESHOLD = 20211014;

const modern: Dialect = {
	footprintNodeName: 'footprint',
	isPadGround(padRecord) {
		const net = findChild(padRecord, 'net');
		if (!net) return false;
		return net.attributes.some((attribute) => {
			const value = attribute.toLowerCase();
			return value.includes('gnd') || value.includes('ground') || value.includes('grnd');
		});
	}
};

const legacy: Dialect = {
	footprintNodeName: 'module',
	isPadGround(padRecord) {
		return padRecord.children.some((child) =>
			child.attributes.some((attribute) => attribute.toLowerCase() === 'gnd')
		);
	}
};

export function dialectForVersion(fileVersion: number): Dialect {
	return fileVersion >= MODERN_VERSION_THRESHOLD ? modern : legacy;
}
