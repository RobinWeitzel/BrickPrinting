import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { renderStl } from "../lib/render";
import { parseBinaryStl } from "../lib/stl";
import type { PartSpec } from "../lib/types";

interface Props {
  spec: PartSpec;
  color: string;
  height?: number;
}

export function Preview3D({ spec, color, height = 280 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; mesh?: THREE.Mesh } | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  const [dims, setDims] = useState<string>("");

  // set up scene once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(40, -60, 100);
    scene.add(dir);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    ctx.current = { renderer, scene, camera, controls };
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // (re)load geometry when the spec changes
  const key = JSON.stringify(spec);
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(() => {
      renderStl(spec)
        .then((buf) => {
          if (cancelled || !ctx.current) return;
          const m = parseBinaryStl(buf);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
          geo.setIndex(new THREE.BufferAttribute(m.triangles, 1));
          geo.computeVertexNormals();
          const c = ctx.current;
          if (c.mesh) {
            c.scene.remove(c.mesh);
            c.mesh.geometry.dispose();
          }
          const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, flatShading: true });
          const mesh = new THREE.Mesh(geo, mat);
          c.mesh = mesh;
          c.scene.add(mesh);
          const center = new THREE.Vector3((m.min[0] + m.max[0]) / 2, (m.min[1] + m.max[1]) / 2, (m.min[2] + m.max[2]) / 2);
          const r = Math.max(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]);
          c.controls.target.copy(center);
          c.camera.position.set(center.x + r * 1.1, center.y - r * 1.6, center.z + r * 1.2);
          setDims(`${(m.max[0] - m.min[0]).toFixed(1)} × ${(m.max[1] - m.min[1]).toFixed(1)} × ${(m.max[2] - m.min[2]).toFixed(1)} mm`);
          setStatus("ok");
        })
        .catch((e) => {
          if (cancelled) return;
          setError(String(e.message ?? e));
          setStatus("error");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const mesh = ctx.current?.mesh;
    if (mesh) (mesh.material as THREE.MeshStandardMaterial).color.set(color);
  }, [color, status]);

  return (
    <div className="preview3d" style={{ height }}>
      <div ref={host} className="preview3d-canvas" />
      {status === "loading" && <div className="preview3d-overlay">Generating…</div>}
      {status === "error" && <div className="preview3d-overlay error">Render failed: {error}</div>}
      {status === "ok" && <div className="preview3d-dims">{dims}</div>}
    </div>
  );
}
