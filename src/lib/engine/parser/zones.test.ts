import { describe, expect, it } from 'vitest';
import { parseBoard } from './parseBoard';

/** A 20 × 10 board whose Edge.Cuts rectangle runs from (100, 100) to (120, 110). */
const board = (version: number, body: string) => `(kicad_pcb (version ${version})
	(gr_rect (start 100 100) (end 120 110) (layer "Edge.Cuts") (stroke (width 0.1)))
	${body})`;

const square = `(polygon (pts (xy 100 100) (xy 120 100) (xy 120 110) (xy 100 110)))`;

describe('parseBoard — copper zones', () => {
	it('reads a KiCad 10 zone, whose net is written by name', () => {
		const { board: model, warnings } = parseBoard(
			board(
				20260206,
				`(footprint "R" (layer "F.Cu") (at 105 105)
					(pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu") (net "GND")))
				(zone (net "GND") (layer "B.Cu")
					(connect_pads (clearance 0.508))
					${square}
					(filled_polygon (layer "B.Cu") (pts (xy 101 101) (xy 119 101) (xy 119 109) (xy 101 109))))`
			)
		);

		expect(warnings).toEqual([]);
		expect(model.pours).toHaveLength(1);
		const [pour] = model.pours;
		expect(pour.layer).toBe('bottom');
		expect(pour.netName).toBe('GND');
		expect(pour.net).toBe(model.pads[0].net);
		expect(pour.clearance).toBe(0.508);
		expect(pour.connection).toBe('thermal');
		// Board-local Y-up: file (101, 101) is 1 mm in from the left, 9 mm up.
		expect(pour.fills).toHaveLength(1);
		expect(pour.fills[0][0]).toEqual({ x: 1, y: 9 });
		expect(pour.outline).toHaveLength(4);
	});

	it('reads a KiCad 6–9 zone, numbered from the net table', () => {
		const { board: model } = parseBoard(
			board(
				20241229,
				`(net 0 "") (net 1 "+5V") (net 2 "GND")
				(zone (net 2) (net_name "GND") (layer "F.Cu") (connect_pads yes (clearance 0.3)) ${square})`
			)
		);
		expect(model.pours).toHaveLength(1);
		expect(model.pours[0]).toMatchObject({
			layer: 'top',
			net: 2,
			netName: 'GND',
			clearance: 0.3,
			connection: 'solid',
			fills: []
		});
	});

	it('makes one pour per layer for a zone on both sides', () => {
		for (const layers of [`(layers "F.Cu" "B.Cu")`, `(layers "*.Cu")`, `(layer F&B.Cu)`]) {
			const { board: model } = parseBoard(
				board(20241229, `(net 1 "GND") (zone (net 1) (net_name "GND") ${layers} ${square})`)
			);
			expect(model.pours.map((pour) => pour.layer).sort()).toEqual(['bottom', 'top']);
		}
	});

	it('gives a legacy fill without a layer to the zone’s own layer', () => {
		const { board: model } = parseBoard(
			board(
				20171130,
				`(net 1 GND)
				(zone (net 1) (net_name GND) (layer B.Cu) (connect_pads (clearance 0.5)) ${square}
					(filled_polygon (pts (xy 101 101) (xy 119 101) (xy 119 109))))`
			)
		);
		expect(model.pours[0].fills).toHaveLength(1);
	});

	it('reads every pad connection style', () => {
		const connectionOf = (connectPads: string) =>
			parseBoard(
				board(20241229, `(net 1 "GND") (zone (net 1) (layer "F.Cu") ${connectPads} ${square})`)
			).board.pours[0].connection;

		expect(connectionOf('(connect_pads (clearance 0.5))')).toBe('thermal');
		expect(connectionOf('(connect_pads yes (clearance 0.5))')).toBe('solid');
		expect(connectionOf('(connect_pads no (clearance 0.5))')).toBe('none');
		expect(connectionOf('(connect_pads thru_hole_only (clearance 0.5))')).toBe('thermal-thru-hole');
		expect(connectionOf('')).toBe('thermal');
	});

	it('leaves out keepouts, zones without a net and inner-layer zones', () => {
		const { board: model, warnings } = parseBoard(
			board(
				20241229,
				`(net 0 "") (net 1 "GND")
				(zone (net 0) (net_name "") (layers "F.Cu" "B.Cu") (keepout (tracks not_allowed)) ${square})
				(zone (net 0) (net_name "") (layer "F.Cu") ${square})
				(zone (net 1) (net_name "GND") (layer "In1.Cu") ${square})`
			)
		);
		expect(model.pours).toEqual([]);
		expect(warnings.map((warning) => warning.code)).toEqual(['copper-zone']);
		expect(warnings[0].message).toContain('inner layers');
	});

	it('reads pad and footprint zone_connect overrides, the pad’s winning', () => {
		const { board: model } = parseBoard(
			board(
				20241229,
				`(net 1 "GND")
				(footprint "U" (layer "F.Cu") (at 105 105) (zone_connect 2)
					(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))
					(pad "2" smd rect (at 2 0) (size 1 1) (layers "F.Cu") (net 1 "GND") (zone_connect 0)))
				(footprint "R" (layer "F.Cu") (at 110 105)
					(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND")))`
			)
		);
		const zoneConnection = (footprint: string, pad: string) =>
			model.pads.find((p) => p.footprint === footprint && p.padName === pad)!.zoneConnection;
		expect(zoneConnection('U', '1')).toBe('solid');
		expect(zoneConnection('U', '2')).toBe('none');
		expect(zoneConnection('R', '1')).toBeUndefined();
	});
});
