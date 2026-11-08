// three.js compositor: the 3D cavern first, then the 2D game canvas as a flat
// overlay with particle bursts on top, and bloom over everything.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Cavern } from './cavern';

const MAX_PARTICLES = 2400;
const BURST_LIFE = 0.95;
const BLOOM_STRENGTH = 0.26;

const BURST_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixels;
  attribute vec2 aVelocity;
  attribute float aBirth;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vLife;
  void main() {
    float age = uTime - aBirth;
    vLife = 1.0 - age / ${BURST_LIFE.toFixed(2)};
    vColor = aColor;
    if (aBirth < 0.0 || vLife <= 0.0) {
      gl_Position = vec4(4.0, 4.0, 4.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec2 p = position.xy + aVelocity * age + vec2(0.0, -150.0) * age * age;
    gl_PointSize = aSize * (0.35 + vLife * 0.65) * uPixels;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 2.0, 1.0);
  }
`;

const BURST_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vLife;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float glow = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vColor * 1.8 * glow * glow, glow * vLife);
  }
`;

export class Stage3D {
  readonly element: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly cavern = new Cavern();
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCamera: THREE.OrthographicCamera;
  private readonly overlay: THREE.MeshBasicMaterial;
  private readonly burstMaterial: THREE.ShaderMaterial;
  private readonly burstGeometry = new THREE.BufferGeometry();
  private texture: THREE.CanvasTexture | null = null;
  private cursor = 0;
  private pulse = 0;
  private readonly startedAt = performance.now();
  private time = 0;

  /** Throws if WebGL is unavailable; the caller falls back to the plain canvas. */
  constructor(
    private readonly source: HTMLCanvasElement,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.element = this.renderer.domElement;
    this.overlayCamera = new THREE.OrthographicCamera(0, width, height, 0, -10, 10);

    this.overlay = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.overlay);
    overlayMesh.position.set(width / 2, height / 2, 0);
    overlayMesh.renderOrder = 2;
    this.overlayScene.add(overlayMesh);

    this.burstMaterial = this.createBurstMaterial();
    const burstPoints = new THREE.Points(this.createBurstGeometry(), this.burstMaterial);
    burstPoints.frustumCulled = false;
    burstPoints.renderOrder = 3;
    this.overlayScene.add(burstPoints);

    // Multisampling keeps the crystal edges clean.
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.cavern.scene, this.cavern.camera));
    const overlayPass = new RenderPass(this.overlayScene, this.overlayCamera);
    overlayPass.clear = false;
    overlayPass.clearDepth = true;
    this.composer.addPass(overlayPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), BLOOM_STRENGTH, 0.5, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private createBurstGeometry(): THREE.BufferGeometry {
    const g = this.burstGeometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    g.setAttribute('aVelocity', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 2), 2));
    g.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES).fill(-1), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    return g;
  }

  private createBurstMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: BURST_VERTEX,
      fragmentShader: BURST_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uPixels: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * The canvas fills the whole (cssWidth, cssHeight) area. `fit` is CSS pixels per
   * logical unit. The game area stays centered across the top; the camera sees the
   * extra space beside and below it, so that the cavern reaches the window's edges.
   */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number, fit: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(cssWidth, cssHeight, true);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(cssWidth, cssHeight);

    const marginX = (cssWidth / fit - this.width) / 2;
    this.overlayCamera.left = -marginX;
    this.overlayCamera.right = this.width + marginX;
    this.overlayCamera.top = this.height;
    this.overlayCamera.bottom = this.height - cssHeight / fit;
    this.overlayCamera.updateProjectionMatrix();

    const devicePerLogical = fit * pixelRatio;
    this.burstMaterial.uniforms.uPixels.value = devicePerLogical;
    this.cavern.resize(cssWidth / cssHeight, devicePerLogical);

    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(this.source);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.overlay.map = this.texture;
    this.overlay.needsUpdate = true;
  }

  /** Spawns particles at a logical position (origin at the top-left, y down). */
  burst(x: number, y: number, hexColor: string, count: number, power: number): void {
    const color = new THREE.Color(hexColor);
    const position = this.burstGeometry.getAttribute('position') as THREE.BufferAttribute;
    const velocity = this.burstGeometry.getAttribute('aVelocity') as THREE.BufferAttribute;
    const birth = this.burstGeometry.getAttribute('aBirth') as THREE.BufferAttribute;
    const size = this.burstGeometry.getAttribute('aSize') as THREE.BufferAttribute;
    const tint = this.burstGeometry.getAttribute('aColor') as THREE.BufferAttribute;
    const now = this.time;

    for (let i = 0; i < count; i++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const angle = Math.random() * Math.PI * 2;
      const speed = (30 + Math.random() * 130) * power;
      position.setXYZ(index, x, this.height - y, 0);
      velocity.setXY(index, Math.cos(angle) * speed, Math.sin(angle) * speed + 40);
      birth.setX(index, now);
      size.setX(index, 3 + Math.random() * 8);
      tint.setXYZ(index, color.r, color.g, color.b);
    }
    position.needsUpdate = true;
    velocity.needsUpdate = true;
    birth.needsUpdate = true;
    size.needsUpdate = true;
    tint.needsUpdate = true;
  }

  /** Makes the cavern flare for a moment; stronger for longer chains. */
  flash(strength: number): void {
    this.pulse = Math.min(1.4, this.pulse + strength);
  }

  render(): void {
    const time = (performance.now() - this.startedAt) / 1000;
    const delta = time - this.time;
    this.time = time;
    this.pulse = Math.max(0, this.pulse - delta * 1.8);

    this.cavern.update(time, delta, this.pulse);
    this.burstMaterial.uniforms.uTime.value = time;
    this.bloom.strength = BLOOM_STRENGTH + this.pulse * 0.45;

    if (this.texture) this.texture.needsUpdate = true;
    this.composer.render(delta);
  }
}
