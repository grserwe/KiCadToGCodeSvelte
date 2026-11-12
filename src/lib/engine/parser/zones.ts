import type { SExpr } from '../sexpr/types';
import type { EngineWarning, LayerId, Pour, PourConnection, Vec2 } from '../model/types';
import type { NetIdReader } from './nets';
import { findChild, numberAttr } from './sexprHelpers';

/** KiCad's default zone clearance, used when a file leaves it out. */
const DEFAULT_ZONE_CLEARANCE = 0.5;

/** A pour still in KiCad file coordinates (Y-down, absolute mm). */
export type RawPour = Pour;

/**
 * Copper zones on the outer layers. A zone on both layers (`(layers "F.Cu"
 * "B.Cu")`, `*.Cu`) becomes one pour per layer. Rule areas (keepouts) and
 * zones with no net are not copper the engine has to keep, so they are left
 * out; inner-layer zones are skipped with a warning.
 */
export function extractZones(
	root: SExpr,
	netId: NetIdReader,
	warnings: EngineWarning[]
): RawPour[] {
	const pours: RawPour[] = [];
	let innerZones = 0;

	for (const zone of root.children) {
		if (zone.name.toLowerCase() !== 'zone') continue;
		if (findChild(zone, 'keepout')) continue;

		const net = netId(zone);
		if (net === 0) continue;

		const layerNames = [
			...(findChild(zone, 'layer')?.attributes ?? []),
			...(findChild(zone, 'layers')?.attributes ?? [])
		];
		const layers = outerLayers(layerNames);
		if (layers.length === 0) {
			if (layerNames.some((name) => /\bIN\d+\.CU/i.test(name))) innerZones++;
			continue;
		}

		const outline = polygonPoints(findChild(zone, 'polygon'));
		if (outline.length < 3) continue;

		const fillsByLayer = new Map<LayerId, Vec2[][]>();
		for (const filled of zone.children) {
			if (filled.name.toLowerCase() !== 'filled_polygon') continue;
			// Legacy files write no layer on a fill: it is the zone's own.
			const fillLayers = outerLayers(findChild(filled, 'layer')?.attributes ?? []);
			const layer = fillLayers[0] ?? (layers.length === 1 ? layers[0] : undefined);
			const points = polygonPoints(filled);
			if (!layer || points.length < 3) continue;
			fillsByLayer.set(layer, [...(fillsByLayer.get(layer) ?? []), points]);
		}

		const connectPads = findChild(zone, 'connect_pads');
		const clearance =
			numberAttr(connectPads && findChild(connectPads, 'clearance'), 0) ?? DEFAULT_ZONE_CLEARANCE;

		for (const layer of layers) {
			pours.push({
				layer,
				net,
				netName: zoneNetName(zone),
				clearance,
				connection: zoneConnection(connectPads),
				outline,
				fills: fillsByLayer.get(layer) ?? []
			});
		}
	}

	if (innerZones > 0) {
		warnings.push({
			code: 'copper-zone',
			message: `${innerZones} copper zone${innerZones === 1 ? '' : 's'} on inner layers ignored — only two-layer boards are supported.`
		});
	}

	return pours;
}

/** `(zone_connect N)` on a pad or footprint: KiCad's ZONE_CONNECTION enum. */
export function zoneConnectOverride(record: SExpr | undefined): PourConnection | undefined {
	switch (numberAttr(record && findChild(record, 'zone_connect'), 0)) {
		case 0:
			return 'none';
		case 1:
			return 'thermal';
		case 2:
			return 'solid';
		case 3:
			return 'thermal-thru-hole';
		default:
			return undefined;
	}
}

/** `(connect_pads [yes|no|thru_hole_only] (clearance …))`; bare = thermal reliefs. */
function zoneConnection(connectPads: SExpr | undefined): PourConnection {
	switch (connectPads?.attributes[0]?.toLowerCase()) {
		case 'yes':
			return 'solid';
		case 'no':
			return 'none';
		case 'thru_hole_only':
			return 'thermal-thru-hole';
		default:
			return 'thermal';
	}
}

function outerLayers(layerNames: string[]): LayerId[] {
	const layers = new Set<LayerId>();
	for (const name of layerNames) {
		const upper = name.toUpperCase();
		if (upper === '*.CU' || upper === 'F&B.CU') {
			layers.add('top');
			layers.add('bottom');
		} else if (upper === 'F.CU') {
			layers.add('top');
		} else if (upper === 'B.CU') {
			layers.add('bottom');
		}
	}
	return [...layers];
}

/** KiCad ≤ 9 writes `(net 1) (net_name "GND")`; KiCad 10 writes `(net "GND")`. */
function zoneNetName(zone: SExpr): string {
	return findChild(zone, 'net_name')?.attributes[0] ?? findChild(zone, 'net')?.attributes[0] ?? '';
}

/** The `(pts (xy …) …)` of a polygon record; arcs contribute their three points. */
function polygonPoints(record: SExpr | undefined): Vec2[] {
	const pts = record && findChild(record, 'pts');
	if (!pts) return [];
	const points: Vec2[] = [];
	for (const child of pts.children) {
		const name = child.name.toLowerCase();
		const corners =
			name === 'xy'
				? [child]
				: name === 'arc'
					? ['start', 'mid', 'end'].map((key) => findChild(child, key))
					: [];
		for (const corner of corners) {
			const x = numberAttr(corner, 0);
			const y = numberAttr(corner, 1);
			if (x !== undefined && y !== undefined) points.push({ x, y });
		}
	}
	return points;
}
