#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PARISH_TOPO = ROOT / "frontend/assets/web/parroquias.web.topo.json"
OUTPUT = ROOT / "frontend/assets/web/cerdedo-cotobade-parts.geojson"

CERDEDO_PARISH_CODES = {
    3690206,
    3690207,
    3690209,
    3690210,
    3690212,
    3690213,
    3690214,
    3690219,
}

COTOBADE_PARISH_CODES = {
    3690201,
    3690202,
    3690203,
    3690204,
    3690205,
    3690208,
    3690211,
    3690215,
    3690216,
    3690217,
    3690218,
    3690220,
    3690221,
}

PARTS = [
    {
        "part": "Cerdedo",
        "codcom": 52,
        "comarca": "Tabeirós-Terra de Montes",
        "parishes": CERDEDO_PARISH_CODES,
    },
    {
        "part": "Cotobade",
        "codcom": 51,
        "comarca": "Pontevedra",
        "parishes": COTOBADE_PARISH_CODES,
    },
]


def signed_arc_index(index: int) -> int:
    return index if index >= 0 else ~index


def decode_arcs(topology: dict) -> list[list[tuple[int, int]]]:
    arcs = []
    for arc in topology["arcs"]:
        x = 0
        y = 0
        coords = []
        for dx, dy in arc:
            x += dx
            y += dy
            coords.append((x, y))
        arcs.append(coords)
    return arcs


def transform_ring(raw_ring: list[tuple[int, int]], topology: dict) -> list[list[float]]:
    scale_x, scale_y = topology["transform"]["scale"]
    translate_x, translate_y = topology["transform"]["translate"]
    return [
        [
            round(x * scale_x + translate_x, 7),
            round(y * scale_y + translate_y, 7),
        ]
        for x, y in raw_ring
    ]


def geometry_rings(geometry: dict) -> list[list[int]]:
    if geometry["type"] == "Polygon":
        return geometry["arcs"]
    if geometry["type"] == "MultiPolygon":
        return [ring for polygon in geometry["arcs"] for ring in polygon]
    raise ValueError(f"Tipo xeométrico non soportado: {geometry['type']}")


def oriented_arc(decoded_arcs: list[list[tuple[int, int]]], index: int) -> list[tuple[int, int]]:
    coords = decoded_arcs[signed_arc_index(index)]
    return coords if index >= 0 else list(reversed(coords))


def stitch_segments(segments: list[list[tuple[int, int]]]) -> list[list[tuple[int, int]]]:
    remaining = [segment for segment in segments if len(segment) >= 2]
    rings = []

    while remaining:
        ring = remaining.pop(0)
        changed = True
        while changed:
            changed = False
            for index, segment in enumerate(remaining):
                if ring[-1] == segment[0]:
                    ring.extend(segment[1:])
                elif ring[-1] == segment[-1]:
                    ring.extend(reversed(segment[:-1]))
                elif ring[0] == segment[-1]:
                    ring = segment[:-1] + ring
                elif ring[0] == segment[0]:
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue
                remaining.pop(index)
                changed = True
                break

        if ring[0] != ring[-1]:
            ring.append(ring[0])
        rings.append(ring)

    return rings


def dissolved_part(topology: dict, decoded_arcs: list[list[tuple[int, int]]], part: dict) -> dict:
    geometries = topology["objects"]["parroquias"]["geometries"]
    selected = [
        geometry
        for geometry in geometries
        if geometry.get("properties", {}).get("CODPARRO") in part["parishes"]
    ]
    if len(selected) != len(part["parishes"]):
        found = {geometry.get("properties", {}).get("CODPARRO") for geometry in selected}
        missing = sorted(part["parishes"] - found)
        raise RuntimeError(f"Faltan parroquias para {part['part']}: {missing}")

    arc_counts = Counter()
    ring_arcs = []
    for geometry in selected:
        for ring in geometry_rings(geometry):
            ring_arcs.append(ring)
            arc_counts.update(signed_arc_index(index) for index in ring)

    segments = []
    for ring in ring_arcs:
        for index in ring:
            if arc_counts[signed_arc_index(index)] == 1:
                segments.append(oriented_arc(decoded_arcs, index))

    rings = stitch_segments(segments)
    if not rings:
        raise RuntimeError(f"Non se puido xerar contorno para {part['part']}")

    return {
        "type": "Feature",
        "properties": {
            "territory_id": "con:36902",
            "CONCELLO": "Cerdedo-Cotobade",
            "CODCONC": 36902,
            "CODIGOINE": "36902",
            "part": part["part"],
            "NOME": part["part"],
            "CODCOM": part["codcom"],
            "COMARCA": part["comarca"],
            "CODPROV": 36,
            "PROVINCIA": "Pontevedra",
        },
        "geometry": {
            "type": "MultiPolygon",
            "coordinates": [[transform_ring(ring, topology)] for ring in rings],
        },
    }


def main() -> int:
    topology = json.loads(PARISH_TOPO.read_text(encoding="utf-8"))
    decoded_arcs = decode_arcs(topology)
    features = [dissolved_part(topology, decoded_arcs, part) for part in PARTS]
    OUTPUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Xerado {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
