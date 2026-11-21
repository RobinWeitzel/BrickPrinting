export interface Mesh {
  /** flat xyz per vertex (indexed) */
  vertices: Float32Array;
  /** 3 indices per triangle */
  triangles: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
}

/** Parses a binary STL into an indexed mesh (vertices are de-duplicated). */
export function parseBinaryStl(buf: ArrayBuffer): Mesh {
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  const map = new Map<string, number>();
  const verts: number[] = [];
  const tris = new Uint32Array(count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let off = 84;
  for (let t = 0; t < count; t++) {
    off += 12; // normal
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
      off += 12;
      const k = `${x},${y},${z}`;
      let idx = map.get(k);
      if (idx === undefined) {
        idx = verts.length / 3;
        map.set(k, idx);
        verts.push(x, y, z);
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
      }
      tris[t * 3 + v] = idx;
    }
    off += 2; // attribute
  }
  return { vertices: new Float32Array(verts), triangles: tris, min, max };
}
