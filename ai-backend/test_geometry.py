"""Dependency-free checks for the local GLB builders."""

import json
import struct
import unittest

from geometry import box_glb, build_glb, heightmap_glb


def parse_glb(data):
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF"
    assert version == 2
    assert length == len(data)
    offset = 12
    doc = None
    binary = b""
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + chunk_length]
        if chunk_type == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8"))
        elif chunk_type == 0x004E4942:
            binary = chunk
        offset += 8 + chunk_length
    assert doc is not None
    return doc, binary


class GeometryTest(unittest.TestCase):
    def test_box_is_valid_glb(self):
        doc, binary = parse_glb(box_glb(1.0))
        primitive = doc["meshes"][0]["primitives"][0]
        self.assertIn("POSITION", primitive["attributes"])
        self.assertIn("NORMAL", primitive["attributes"])
        self.assertEqual(doc["accessors"][0]["count"], 24)
        self.assertEqual(doc["accessors"][2]["count"], 36)
        self.assertEqual(doc["buffers"][0]["byteLength"], len(binary))

    def test_heightmap_shapes_and_normals(self):
        pixels = [min(255, (x + y) * 18) for y in range(6) for x in range(8)]
        doc, binary = parse_glb(heightmap_glb(pixels, 8, 6, max_vertices=20))
        position_count = doc["accessors"][0]["count"]
        index_count = doc["accessors"][2]["count"]
        self.assertLessEqual(position_count, 20)
        self.assertEqual(index_count % 6, 0)
        self.assertEqual(doc["buffers"][0]["byteLength"], len(binary))
        self.assertTrue(doc["materials"][0]["doubleSided"])

        position_view = doc["bufferViews"][0]
        normal_view = doc["bufferViews"][1]
        positions = struct.unpack_from(
            "<%df" % (position_view["byteLength"] // 4), binary, position_view["byteOffset"]
        )
        normals = struct.unpack_from(
            "<%df" % (normal_view["byteLength"] // 4), binary, normal_view["byteOffset"]
        )
        self.assertEqual(len(positions), position_count * 3)
        self.assertEqual(len(normals), position_count * 3)
        self.assertGreater(max(positions[1::3]) - min(positions[1::3]), 0.1)
        for i in range(0, len(normals), 3):
            length = (normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2) ** 0.5
            self.assertAlmostEqual(length, 1.0, places=5)

    def test_rejects_short_pixel_buffer(self):
        with self.assertRaises(ValueError):
            heightmap_glb([1, 2, 3], 4, 4)

    def test_requires_geometry_data(self):
        with self.assertRaises(ValueError):
            build_glb([], [], [])


if __name__ == "__main__":
    unittest.main()
