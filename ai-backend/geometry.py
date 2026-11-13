"""Small, dependency-free GLB builders used by the local backend."""

import json
import math
import struct


def _pad4(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def build_glb(positions, normals, indices, name="Generated Model"):
    """Build a valid binary glTF with one indexed triangle mesh."""
    vertex_count = len(positions) // 3
    if vertex_count == 0 or len(normals) != len(positions) or not indices:
        raise ValueError("positions, normals and indices are required")

    position_data = struct.pack("<%df" % len(positions), *positions)
    normal_data = struct.pack("<%df" % len(normals), *normals)
    use_short = vertex_count <= 65535
    index_data = struct.pack(
        "<%d%s" % (len(indices), "H" if use_short else "I"), *indices
    )
    index_type = 5123 if use_short else 5125

    bin_data = position_data + normal_data + index_data
    buffer_views = [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(position_data), "target": 34962},
        {"buffer": 0, "byteOffset": len(position_data), "byteLength": len(normal_data), "target": 34962},
        {
            "buffer": 0,
            "byteOffset": len(position_data) + len(normal_data),
            "byteLength": len(index_data),
            "target": 34963,
        },
    ]
    xs = positions[0::3]
    ys = positions[1::3]
    zs = positions[2::3]
    doc = {
        "asset": {"version": "2.0", "generator": "AI-3D-Creator local backend"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1},
                        "indices": 2,
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.72, 0.76, 0.84, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.7,
                },
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": vertex_count,
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": vertex_count,
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": index_type,
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_data)}],
    }

    json_data = _pad4(
        json.dumps(doc, separators=(",", ":")).encode("utf-8"), b" "
    )
    binary_data = _pad4(bin_data, b"\0")
    total_length = 12 + 8 + len(json_data) + 8 + len(binary_data)
    return (
        b"glTF"
        + struct.pack("<II", 2, total_length)
        + struct.pack("<II", len(json_data), 0x4E4F534A)
        + json_data
        + struct.pack("<II", len(binary_data), 0x004E4942)
        + binary_data
    )


def box_glb(size=1.0):
    """A simple closed box used by the text-to-3D demo path."""
    h = size / 2.0
    faces = [
        ((0, 0, 1), [(-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h)]),
        ((0, 0, -1), [(h, -h, -h), (-h, -h, -h), (-h, h, -h), (h, h, -h)]),
        ((1, 0, 0), [(h, -h, h), (h, -h, -h), (h, h, -h), (h, h, h)]),
        ((-1, 0, 0), [(-h, -h, -h), (-h, -h, h), (-h, h, h), (-h, h, -h)]),
        ((0, 1, 0), [(-h, h, h), (h, h, h), (h, h, -h), (-h, h, -h)]),
        ((0, -1, 0), [(-h, -h, -h), (h, -h, -h), (h, -h, h), (-h, -h, h)]),
    ]
    positions = []
    normals = []
    indices = []
    for normal, corners in faces:
        base = len(positions) // 3
        for corner in corners:
            positions.extend(corner)
            normals.extend(normal)
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
    return build_glb(positions, normals, indices, "Text Demo Box")


def _sample(pixels, width, height, x, y):
    x = min(width - 1, max(0, x))
    y = min(height - 1, max(0, y))
    return pixels[y * width + x] / 255.0


def heightmap_glb(pixels, width, height, max_vertices=3000, depth=0.6):
    """Build a relief mesh from a downsampled grayscale image.

    This is a deterministic CPU fallback, not a neural reconstruction. The
    frontend sends a small grayscale grid so the backend needs no image codecs.
    """
    if not pixels or width < 1 or height < 1:
        raise ValueError("image_pixels and dimensions are required")
    if len(pixels) < width * height:
        raise ValueError("image_pixels is smaller than image_width * image_height")

    max_vertices = max(4, int(max_vertices))
    cols = max(2, min(width, int(math.ceil(math.sqrt(max_vertices)))))
    rows = max(2, min(height, int(math.ceil(math.sqrt(max_vertices)))))
    while cols * rows > max_vertices:
        if cols >= rows and cols > 2:
            cols -= 1
        elif rows > 2:
            rows -= 1
        else:
            break

    aspect = height / width
    world_width = 2.0
    world_height = 2.0 * aspect
    dx = world_width / (cols - 1)
    dz = world_height / (rows - 1)
    heights = []

    for row in range(rows):
        for col in range(cols):
            px = round(col / (cols - 1) * (width - 1))
            py = round(row / (rows - 1) * (height - 1))
            heights.append(_sample(pixels, width, height, px, py) * depth)

    positions = []
    normals = []
    for row in range(rows):
        for col in range(cols):
            index = row * cols + col
            x = (col / (cols - 1) - 0.5) * world_width
            z = (row / (rows - 1) - 0.5) * world_height
            positions.extend([x, heights[index], z])

            left = heights[row * cols + max(0, col - 1)]
            right = heights[row * cols + min(cols - 1, col + 1)]
            up = heights[max(0, row - 1) * cols + col]
            down = heights[min(rows - 1, row + 1) * cols + col]
            nx = -(right - left) / (2.0 * dx)
            nz = -(down - up) / (2.0 * dz)
            length = math.sqrt(nx * nx + 1.0 + nz * nz)
            normals.extend([nx / length, 1.0 / length, nz / length])

    indices = []
    for row in range(rows - 1):
        for col in range(cols - 1):
            a = row * cols + col
            b = a + 1
            c = a + cols
            d = c + 1
            indices.extend([a, c, b, b, c, d])

    return build_glb(positions, normals, indices, "Image Relief")
