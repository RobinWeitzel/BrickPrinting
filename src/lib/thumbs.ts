import * as THREE from "three";

import { renderKey, renderStl } from "./render";
import { parseBinaryStl } from "./stl";
import type { PartSpec } from "./types";

/**
 * Small colored snapshots of parts, rendered from the generated STL with one shared
 * offscreen WebGL renderer. Results are cached per part + color.
 */
const SIZE = 192; // px, rendered at ~2-4x the displayed size

let ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; material: THREE.MeshStandardMaterial } | null = null;

function getCtx() {
  if (ctx) return ctx;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777788, 2.4));
  const dir = new THREE.DirectionalLight(0xffffff, 1.8);
  dir.position.set(40, -60, 100);
  scene.add(dir);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, flatShading: true });
  ctx = { renderer, scene, camera, material };
  return ctx;
}

const geometries = new Map<string, Promise<THREE.BufferGeometry>>();
const images = new Map<string, Promise<string>>();
let chain: Promise<unknown> = Promise.resolve();

function geometryFor(spec: PartSpec) {
  const key = renderKey(spec);
  let g = geometries.get(key);
  if (!g) {
    g = renderStl(spec).then((buf) => {
      const m = parseBinaryStl(buf);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
      geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return geo;
    });
    g.catch(() => geometries.delete(key));
    geometries.set(key, g);
  }
  return g;
}

/** Returns a PNG data URL of the part in the given color. */
export function partThumbnail(spec: PartSpec, hex: string): Promise<string> {
  const key = `${renderKey(spec)}|${hex.toLowerCase()}`;
  let p = images.get(key);
  if (p) return p;
  p = geometryFor(spec).then((geo) => {
    // snapshots share one renderer, so take turns
    const run = chain.then(() => {
      const c = getCtx();
      const mesh = new THREE.Mesh(geo, c.material);
      c.material.color.set(hex);
      c.scene.add(mesh);
      const s = geo.boundingSphere!;
      const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(c.camera.fov / 2)) * 1.02;
      const dirv = new THREE.Vector3(0.75, -1.1, 0.9).normalize();
      c.camera.position.copy(s.center).addScaledVector(dirv, dist);
      c.camera.lookAt(s.center);
      c.renderer.render(c.scene, c.camera);
      const url = c.renderer.domElement.toDataURL("image/png");
      c.scene.remove(mesh);
      return url;
    });
    chain = run.catch(() => {});
    return run;
  });
  p.catch(() => images.delete(key));
  images.set(key, p);
  return p;
}
