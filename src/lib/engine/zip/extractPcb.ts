import { unzipSync, strFromU8 } from 'fflate';

export interface PcbCandidate {
	/** Path inside the archive. */
	path: string;
	contents: string;
}

/**
 * Find every `.kicad_pcb` file inside a zipped KiCad project, shallowest
 * paths first (macOS junk folders skipped). Throws when the archive is
 * unreadable or contains no board file.
 */
export function extractPcbFromZip(zipData: Uint8Array): PcbCandidate[] {
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(zipData);
	} catch {
		throw new Error('This zip file could not be read.');
	}

	const candidates = Object.entries(entries)
		.filter(
			([path]) =>
				path.toLowerCase().endsWith('.kicad_pcb') &&
				!path.includes('__MACOSX/') &&
				!path.split('/').some((part) => part.startsWith('._'))
		)
		.map(([path, data]) => ({ path, contents: strFromU8(data) }))
		.sort(
			(a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path)
		);

	if (candidates.length === 0) {
		throw new Error('No .kicad_pcb file was found inside this zip.');
	}
	return candidates;
}

/** Board name derived from a candidate's file name. */
export function boardNameFromPath(path: string): string {
	const fileName = path.split('/').pop() ?? path;
	return fileName.replace(/\.kicad_pcb$/i, '');
}
