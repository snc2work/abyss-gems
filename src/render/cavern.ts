// The 3D world behind the boards: a deep-sea cavern lit by shafts of light and
// by gem crystals, which flare up when a player clears blocks. Purely decorative,
// so it may use Math.random; the game's seeded randomness is not involved.

import * as THREE from 'three';
import { BLOCKS } from './theme';

const REFERENCE_ASPECT = 1.6;
const FIELD_OF_VIEW = 46;
const LOOK_AT_DEPTH = -14;
const SNOW_COUNT = 280;
const SHAFT_COUNT = 6;

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

const BACKDROP_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform float uAspect;
  uniform vec2 uParallax;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }
  float rock(float x) {
    return noise(x) * 0.6 + noise(x * 2.3 + 7.0) * 0.28 + noise(x * 5.1 + 3.0) * 0.12;
  }

  void main() {
    float x = (vUv.x - 0.5) * uAspect;
    float t = uTime;

    // Water column: lit from above, sinking to black.
    vec3 color = mix(vec3(0.0015, 0.006, 0.014), vec3(0.006, 0.06, 0.088), pow(vUv.y, 1.7));

    // Light fanning out from a point above the surface.
    vec2 fromSource = vec2(x, vUv.y - 1.45);
    float angle = atan(fromSource.x, -fromSource.y);
    float fan = noise(angle * 11.0 + t * 0.09) * noise(angle * 29.0 - t * 0.06 + 5.0);
    float reach = smoothstep(0.05, 1.0, vUv.y);
    color += vec3(0.012, 0.15, 0.19) * fan * fan * reach * (1.2 + uPulse * 1.6);

    // Caustic shimmer near the top.
    float caustic = sin(x * 16.0 + sin(vUv.y * 22.0 + t * 0.5) * 1.8 + t * 0.3)
                  * sin(vUv.y * 19.0 - t * 0.35 + sin(x * 13.0 - t * 0.4) * 1.6);
    color += vec3(0.01, 0.06, 0.075) * smoothstep(0.2, 1.0, caustic) * smoothstep(0.62, 1.0, vUv.y);

    // Colored glow rising from the crystals on the floor.
    float leftGlow = exp(-pow((x + uAspect * 0.42) * 1.9, 2.0)) * exp(-vUv.y * 4.0);
    float rightGlow = exp(-pow((x - uAspect * 0.42) * 1.9, 2.0)) * exp(-vUv.y * 4.0);
    float midGlow = exp(-pow(x * 2.4, 2.0)) * exp(-vUv.y * 5.0);
    color += (vec3(0.02, 0.15, 0.17) * leftGlow
            + vec3(0.09, 0.03, 0.2) * rightGlow
            + vec3(0.14, 0.05, 0.05) * midGlow) * (0.35 + uPulse * 0.9);

    // Layers of rock, far to near. Nearer layers shift more with the camera.
    for (int i = 0; i < 3; i++) {
      float depth = float(i);
      float shift = uParallax.x * (0.012 + depth * 0.03);
      float rx = (x + shift) * (1.7 + depth * 1.1) + depth * 13.0;
      float edge = 0.018;
      vec3 rockColor = mix(vec3(0.0065, 0.035, 0.052), vec3(0.0006, 0.002, 0.005), depth / 2.0);

      float floorHeight = 0.2 - depth * 0.055 + (rock(rx) - 0.5) * (0.24 - depth * 0.04);
      float aboveFloor = vUv.y - floorHeight;
      color += vec3(0.008, 0.06, 0.08) * exp(-abs(aboveFloor) * 90.0) * (1.0 - depth * 0.3);
      color = mix(color, rockColor, smoothstep(edge * 0.4, -edge * 0.4, aboveFloor));

      float sides = pow(abs(x / (uAspect * 0.5)), 1.6);
      float ceilingDrop = (0.03 + sides * 0.2 - depth * 0.02) + (rock(rx + 31.0) - 0.5) * 0.16;
      float belowCeiling = (1.0 - vUv.y) - ceilingDrop;
      color = mix(color, rockColor, smoothstep(edge * 0.4, -edge * 0.4, belowCeiling));
    }

    // Vignette.
    float falloff = length(vec2(x / (uAspect * 0.5), vUv.y * 2.0 - 1.0));
    color *= smoothstep(1.75, 0.55, falloff);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const CRYSTAL_VERTEX = /* glsl */ `
  varying vec3 vViewPosition;
  varying vec3 vTint;
  varying float vHeight;
  varying float vPhase;
  void main() {
    vTint = instanceColor;
    vHeight = clamp(position.y / 3.7, 0.0, 1.0);
    vPhase = instanceMatrix[3][0] * 3.1 + instanceMatrix[3][2] * 1.7;
    vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const CRYSTAL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vViewPosition;
  varying vec3 vTint;
  varying float vHeight;
  varying float vPhase;
  void main() {
    // Flat facets from screen-space derivatives.
    vec3 normal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    vec3 toCamera = normalize(-vViewPosition);
    float facing = abs(dot(normal, toCamera));
    float rim = pow(1.0 - facing, 2.2);
    float facet = 0.5 + 0.5 * dot(normal, normalize(vec3(-0.4, 0.8, 0.45)));
    float glint = pow(max(0.0, dot(reflect(-toCamera, normal), normalize(vec3(-0.3, 0.9, 0.3)))), 26.0);

    float breathe = 0.82 + 0.18 * sin(uTime * 0.7 + vPhase);
    float inner = (0.03 + vHeight * vHeight * 0.16) * breathe;
    float bands = 0.5 + 0.5 * sin(vHeight * 26.0 + vPhase + uTime * 0.35);

    vec3 color = vTint * (inner + facet * 0.07 + bands * 0.012);
    color += vTint * rim * 0.2;
    color += vec3(1.0) * glint * 0.1;
    color *= 1.0 + uPulse * 1.5;

    // Distant crystals fade into the water.
    float distanceFog = smoothstep(7.0, 27.0, -vViewPosition.z);
    color = mix(color, vec3(0.003, 0.02, 0.032), distanceFog * 0.86);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const SHAFT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHAFT_FRAGMENT = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float along = smoothstep(0.0, 0.75, vUv.y);
    gl_FragColor = vec4(vec3(0.1, 0.52, 0.62), across * across * along * uStrength);
  }
`;

const SNOW_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixels;
  attribute float aDrift;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + 10.0 - uTime * aDrift, 20.0) - 10.0;
    p.x += sin(uTime * 0.17 + position.z * 2.0 + position.y) * 0.35;
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    float depth = -viewPosition.z;
    vAlpha = smoothstep(30.0, 6.0, depth) * 0.5;
    gl_PointSize = aSize * uPixels * 12.0 / depth;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    gl_FragColor = vec4(vec3(0.55, 0.85, 0.95), vAlpha * smoothstep(1.0, 0.1, d));
  }
`;

interface ClusterSpec {
  /** Position in screen-like units: -1..1 across the reference view, at this depth. */
  x: number;
  y: number;
  z: number;
  count: number;
  scale: number;
  /** Index of the dominant gem color, from 1 to 4. */
  color: number;
  hanging?: boolean;
}

function mirrored(spec: ClusterSpec, color: number): ClusterSpec[] {
  return [spec, { ...spec, x: -spec.x, color }];
}

const CLUSTERS: ClusterSpec[] = [
  // Large crystals at the near corners of the floor.
  ...mirrored({ x: -1.0, y: -1.02, z: -7, count: 9, scale: 0.46, color: 1 }, 4),
  ...mirrored({ x: -0.74, y: -1.06, z: -12, count: 9, scale: 0.62, color: 4 }, 1),
  // A low bed along the floor, under the center panel.
  { x: 0, y: -1.1, z: -13, count: 12, scale: 0.42, color: 2 },
  ...mirrored({ x: -0.34, y: -1.1, z: -16, count: 8, scale: 0.48, color: 3 }, 2),
  ...mirrored({ x: -0.58, y: -1.04, z: -23, count: 7, scale: 0.8, color: 1 }, 3),
  // Hanging from the ceiling.
  ...mirrored({ x: -0.96, y: 1.08, z: -11, count: 8, scale: 0.52, hanging: true, color: 4 }, 1),
  { x: 0, y: 1.1, z: -18, count: 9, scale: 0.5, hanging: true, color: 1 },
];

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function crystalGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0, -0.5),
    new THREE.Vector2(0.78, 0),
    new THREE.Vector2(1, 0.35),
    new THREE.Vector2(0.7, 2.75),
    new THREE.Vector2(0, 3.7),
  ];
  return new THREE.LatheGeometry(profile, 6);
}

export class Cavern {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, REFERENCE_ASPECT, 0.1, 90);

  private readonly backdrop: THREE.ShaderMaterial;
  private readonly crystals: THREE.ShaderMaterial;
  private readonly snow: THREE.ShaderMaterial;
  private readonly shafts: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; baseAngle: number; phase: number; strength: number }[] = [];
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pointerX = 0;
  private pointerY = 0;
  private lookX = 0;
  private lookY = 0;

  constructor() {
    this.backdrop = this.addBackdrop();
    this.crystals = this.addCrystals();
    this.addShafts();
    this.snow = this.addSnow();
    if (!this.reduceMotion) {
      window.addEventListener('pointermove', (event) => {
        this.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
        this.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
      });
    }
  }

  private addBackdrop(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uAspect: { value: REFERENCE_ASPECT },
        uParallax: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    this.scene.add(mesh);
    return material;
  }

  private addCrystals(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: CRYSTAL_VERTEX,
      fragmentShader: CRYSTAL_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      side: THREE.DoubleSide,
    });

    const total = CLUSTERS.reduce((sum, cluster) => sum + cluster.count, 0);
    const mesh = new THREE.InstancedMesh(crystalGeometry(), material, total);
    mesh.frustumCulled = false;

    const halfHeightAt = (depth: number) => depth * Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2));
    const palette = [1, 2, 3, 4].map((id) => new THREE.Color(BLOCKS[id].body));
    const transform = new THREE.Object3D();
    let index = 0;

    for (const cluster of CLUSTERS) {
      const halfHeight = halfHeightAt(-cluster.z);
      const baseX = cluster.x * halfHeight * REFERENCE_ASPECT;
      const baseY = cluster.y * halfHeight;
      const flip = cluster.hanging ? Math.PI : 0;

      for (let i = 0; i < cluster.count; i++) {
        // The first crystals are the tall centerpiece; later ones are smaller and lean out.
        const rank = i / Math.max(1, cluster.count - 1);
        const lean = rank * 0.85 * (i % 2 === 0 ? 1 : -1) + randomRange(-0.1, 0.1);
        const girth = cluster.scale * randomRange(0.32, 0.5) * (1 - rank * 0.45);
        const length = cluster.scale * randomRange(0.85, 1.25) * (1 - rank * 0.62);

        transform.position.set(baseX + lean * cluster.scale * 1.6, baseY, cluster.z + randomRange(-1.4, 1.4));
        transform.rotation.set(randomRange(-0.25, 0.25), randomRange(0, Math.PI), flip - lean * 0.75);
        transform.scale.set(girth, length, girth);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);

        const dominant = Math.random() < 0.72;
        mesh.setColorAt(index, dominant ? palette[cluster.color - 1] : palette[Math.floor(Math.random() * 4)]);
        index++;
      }
    }
    this.scene.add(mesh);
    return material;
  }

  private addShafts(): void {
    for (let i = 0; i < SHAFT_COUNT; i++) {
      const strength = randomRange(0.05, 0.11);
      const material = new THREE.ShaderMaterial({
        vertexShader: SHAFT_VERTEX,
        fragmentShader: SHAFT_FRAGMENT,
        uniforms: { uStrength: { value: strength } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const width = randomRange(2.2, 5);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 34), material);
      const spread = (i / (SHAFT_COUNT - 1) - 0.5) * 2;
      const baseAngle = -spread * 0.3 + randomRange(-0.05, 0.05);
      mesh.position.set(spread * 11, 4, randomRange(-20, -9));
      mesh.rotation.z = baseAngle;
      mesh.renderOrder = 5;
      this.scene.add(mesh);
      this.shafts.push({ mesh, material, baseAngle, phase: Math.random() * 6.28, strength });
    }
  }

  private addSnow(): THREE.ShaderMaterial {
    const positions = new Float32Array(SNOW_COUNT * 3);
    const drift = new Float32Array(SNOW_COUNT);
    const size = new Float32Array(SNOW_COUNT);
    for (let i = 0; i < SNOW_COUNT; i++) {
      positions[i * 3] = randomRange(-16, 16);
      positions[i * 3 + 1] = randomRange(-10, 10);
      positions[i * 3 + 2] = randomRange(-28, -4);
      drift[i] = randomRange(0.06, 0.3);
      size[i] = randomRange(0.9, 3.6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aDrift', new THREE.BufferAttribute(drift, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERTEX,
      fragmentShader: SNOW_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uPixels: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.scene.add(points);
    return material;
  }

  resize(aspect: number, devicePixelsPerLogical: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.backdrop.uniforms.uAspect.value = aspect;
    this.snow.uniforms.uPixels.value = devicePixelsPerLogical;
  }

  update(time: number, delta: number, pulse: number): void {
    // Ease toward the pointer, with a slow idle sway so the scene is never static.
    const ease = Math.min(1, delta * 2.2);
    this.lookX += (this.pointerX - this.lookX) * ease;
    this.lookY += (this.pointerY - this.lookY) * ease;
    const swayX = this.reduceMotion ? 0 : Math.sin(time * 0.11) * 0.28;
    const swayY = this.reduceMotion ? 0 : Math.sin(time * 0.07 + 1.0) * 0.12;
    this.camera.position.set(this.lookX * 0.55 + swayX, -this.lookY * 0.28 + swayY, 0);
    this.camera.lookAt(this.camera.position.x * 0.4, this.camera.position.y * 0.4, LOOK_AT_DEPTH);

    this.backdrop.uniforms.uTime.value = time;
    this.backdrop.uniforms.uPulse.value = pulse;
    this.backdrop.uniforms.uParallax.value.set(this.camera.position.x, this.camera.position.y);
    this.crystals.uniforms.uTime.value = time;
    this.crystals.uniforms.uPulse.value = pulse;
    this.snow.uniforms.uTime.value = time;

    for (const shaft of this.shafts) {
      shaft.mesh.rotation.z = shaft.baseAngle + Math.sin(time * 0.13 + shaft.phase) * 0.035;
      const shimmer = 0.75 + 0.25 * Math.sin(time * 0.4 + shaft.phase * 3.0);
      shaft.material.uniforms.uStrength.value = shaft.strength * shimmer * (1 + pulse * 1.8);
    }
  }
}
