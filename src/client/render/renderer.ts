// Three.js renderer setup: scene, camera, sun light with shadows, fog, quality levels.
import * as THREE from 'three';
import type { World } from '../../sim/world';
import { THEMES } from './textures';
import { buildMapView, type MapView } from './mapmesh';
import type { ViewModel } from './viewmodel';

export type Quality = 'low' | 'medium' | 'high';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  mapView: MapView | null = null;
  quality: Quality = 'medium';
  shadows = true;
  renderScale = 1;
  private shake = 0;
  baseFov = 90;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(this.hfovToV(90, 16 / 9), 16 / 9, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.hemi = new THREE.HemisphereLight('#cfe0ff', '#7a6a55', 1.1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.4);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.resize();
  }

  /** CS-style horizontal FOV setting converted to Three's vertical FOV. */
  hfovToV(hfovDeg: number, aspect: number): number {
    // treat the setting as horizontal FOV at 4:3, scaled to the actual aspect (Hor+)
    const h43 = (hfovDeg * Math.PI) / 180;
    const v = 2 * Math.atan(Math.tan(h43 / 2) / (4 / 3));
    void aspect;
    return (v * 180) / Math.PI;
  }

  setQuality(q: Quality, shadows: boolean, renderScale: number): void {
    this.quality = q;
    this.shadows = shadows && q !== 'low';
    this.renderScale = renderScale;
    this.renderer.shadowMap.enabled = this.shadows;
    const size = q === 'high' ? 4096 : 2048;
    this.sun.castShadow = this.shadows;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    this.resize();
  }

  loadWorld(world: World): void {
    if (this.mapView) { this.scene.remove(this.mapView.group); this.mapView.dispose(); this.mapView = null; }
    // start from a clean scene: drop anything a previous screen left behind
    for (const o of [...this.scene.children]) {
      if (o === this.camera || o === this.hemi || o === this.sun || o === this.sun.target) continue;
      this.scene.remove(o);
    }
    const theme = world.map.def.theme;
    const pal = THEMES[theme];
    this.mapView = buildMapView(world, { shadows: this.shadows, quality: this.quality });
    this.scene.add(this.mapView.group);
    this.scene.fog = new THREE.Fog(pal.fog, 60, world.map.def.training ? 260 : 190);
    this.scene.background = new THREE.Color(pal.fog);
    this.hemi.color.set(pal.sky[0]);
    this.hemi.groundColor.set(pal.ambient);
    this.hemi.intensity = 1.2;
    this.sun.color.set(pal.sun);
    this.sun.intensity = pal.sunIntensity;
    const cx = world.sizeX / 2, cz = world.sizeZ / 2;
    this.sun.position.set(cx + 40, 70, cz + 25);
    this.sun.target.position.set(cx, 0, cz);
    const half = Math.max(world.sizeX, world.sizeZ) * 0.62;
    const cam = this.sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = 200;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1) * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void { this.shake = Math.min(1, this.shake + amount); }

  setView(pos: { x: number; y: number; z: number }, yaw: number, pitch: number, fovDeg: number, dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake;
    this.camera.position.set(pos.x + (Math.random() - 0.5) * 0.06 * s, pos.y + (Math.random() - 0.5) * 0.06 * s, pos.z);
    this.camera.rotation.set(pitch + (Math.random() - 0.5) * 0.02 * s, yaw, (Math.random() - 0.5) * 0.02 * s);
    const vf = this.hfovToV(fovDeg, this.camera.aspect);
    if (Math.abs(this.camera.fov - vf) > 0.01) { this.camera.fov = vf; this.camera.updateProjectionMatrix(); }
  }

  render(vm: ViewModel | null, t: number): void {
    this.mapView?.update(t);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (vm) {
      this.renderer.clearDepth();
      vm.setAspect(this.camera.aspect);
      this.renderer.render(vm.scene, vm.camera);
    }
  }

  dispose(): void {
    if (this.mapView) { this.scene.remove(this.mapView.group); this.mapView.dispose(); this.mapView = null; }
  }
}
