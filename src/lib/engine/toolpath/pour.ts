import type { BoardModel, LayerId, Pad, Pour, Vec2 } from '../model/types';

/**
 * The pour that owns a layer's uncut copper. Isolation milling leaves every
 * bit of copper it does not cut, all joined together, so a layer can carry
 * only one pour net: copper on that net is left uncut and joined to the
 * sheet, and everything else is isolated as usual.
 */
export interface LayerPour {
	net: number;
	netName: string;
	/** Smallest clearance of the chosen net's zones on this layer (mm). */
	clearance: number;
	/** The chosen net's zones on this layer. */
	zones: Pour[];
	/** Zones on this layer for OTHER nets, which cannot be milled as pours. */
	ignored: Pour[];
}

/**
 * Pick the layer's pour net. When zones for several nets share a layer, the
 * net whose zones cover the most area wins (KiCad's fill when present, else
 * the drawn outline); the others are reported as ignored.
 */
export function selectLayerPour(board: BoardModel, layer: LayerId): LayerPour | null {
	const zones = (board.pours ?? []).filter((pour) => pour.layer === layer && pour.net !== 0);
	if (zones.length === 0) return null;

	const areaByNet = new Map<number, number>();
	for (const zone of zones) {
		areaByNet.set(zone.net, (areaByNet.get(zone.net) ?? 0) + zoneArea(zone));
	}
	let net = zones[0].net;
	for (const [candidate, area] of areaByNet) {
		if (area > areaByNet.get(net)!) net = candidate;
	}

	const chosen = zones.filter((zone) => zone.net === net);
	return {
		net,
		netName: chosen[0].netName,
		clearance: Math.min(...chosen.map((zone) => zone.clearance)),
		zones: chosen,
		ignored: zones.filter((zone) => zone.net !== net)
	};
}

/**
 * How a pad meets the uncut copper on a layer:
 * - `solid`: not cut around at all — the pad is part of the pour.
 * - `thermal`: cut around except for four spokes (and where its tracks enter).
 * - `isolated`: cut all the way around, except where its tracks enter.
 *
 * Without a pour on the layer, ground-named pads keep the legacy thermal
 * relief. With one, only pads on the pour's net may touch it — a
 * ground-named pad on another net would short to the pour.
 */
export function padPourJoint(pad: Pad, pour: LayerPour | null): 'solid' | 'thermal' | 'isolated' {
	if (!pour) return pad.isGround ? 'thermal' : 'isolated';
	if (pad.net === 0 || pad.net !== pour.net) return 'isolated';
	// KiCad always joins vias to their zone solidly.
	if (pad.source === 'via') return 'solid';

	const connection = pad.zoneConnection ?? pour.zones[0].connection;
	switch (connection) {
		case 'solid':
			return 'solid';
		case 'none':
			return 'isolated';
		case 'thermal-thru-hole':
			return pad.layers === 'through' ? 'thermal' : 'solid';
		case 'thermal':
			return 'thermal';
	}
}

function zoneArea(zone: Pour): number {
	const polygons = zone.fills.length > 0 ? zone.fills : [zone.outline];
	return polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon)), 0);
}

function signedArea(points: Vec2[]): number {
	let twice = 0;
	for (let index = 0; index < points.length; index++) {
		const a = points[index];
		const b = points[(index + 1) % points.length];
		twice += a.x * b.y - b.x * a.y;
	}
	return twice / 2;
}
