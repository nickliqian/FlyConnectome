// 池塘水面：自定义 ShaderMaterial，支持最多 20 个动态涟漪（舌击、点击、落水触发）。
// 顶点着色器按涟漪叠加做 y 位移；片元着色器用屏幕空间导数求法线，做 Fresnel + 镜面高光。
import * as THREE from '/vendor/three.module.js';

const MAX_RIPPLES = 20;
const WATER_RADIUS = 10.0;

const VERT = /* glsl */`
uniform float uTime;
uniform vec4 uRipples[${MAX_RIPPLES}];   // x, z, startTime, amplitude
uniform int uRippleCount;

varying vec3 vWorldPos;

// 单个涟漪在 (p, age) 处产生的位移。
// 波形 = 高斯包络 × 衰减 × sin(空间频率·d − 时间频率·age)
float rippleAt(vec2 p, float age, float amp, vec2 center) {
  float d = distance(p, center);
  float wavefront = age * 2.6;                    // 波前传播速度
  float delta = d - wavefront;
  float envelope = exp(-delta * delta * 3.5);     // 靠近波前的窄带
  float decay = exp(-age * 0.9);
  return amp * envelope * decay * sin(d * 8.0 - age * 12.0);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float h = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 4.0 || abs(r.w) < 1e-4) continue;
    h += rippleAt(world.xz, age, r.w, r.xy);
  }
  // 微风细浪：两层不同方向的正弦，作为环境扰动
  h += 0.012 * sin(world.x * 1.7 + uTime * 0.9) * cos(world.z * 1.3 + uTime * 0.7);
  world.y += h;
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uCamPos;
uniform float uTime;
varying vec3 vWorldPos;

void main() {
  float r = length(vWorldPos.xz);
  if (r > ${WATER_RADIUS.toFixed(2)}) discard;

  vec3 nrm = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (nrm.y < 0.0) nrm = -nrm;                   // 保持朝上

  vec3 viewDir = normalize(uCamPos - vWorldPos);
  float fresnel = pow(1.0 - max(dot(nrm, viewDir), 0.0), 3.0);

  vec3 deep = vec3(0.05, 0.20, 0.28);
  vec3 shallow = vec3(0.24, 0.58, 0.66);
  vec3 col = mix(deep, shallow, fresnel * 0.85 + 0.15);

  vec3 lightDir = normalize(vec3(0.4, 1.0, 0.35));
  float spec = pow(max(dot(reflect(-lightDir, nrm), viewDir), 0.0), 48.0);
  col += vec3(1.0, 0.98, 0.92) * spec * 0.75;

  // 靠近岸边略变浅、变绿
  float edgeFade = smoothstep(${(WATER_RADIUS * 0.65).toFixed(2)}, ${WATER_RADIUS.toFixed(2)}, r);
  col = mix(col, vec3(0.15, 0.35, 0.30), edgeFade * 0.55);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createWater() {
  // PlaneGeometry + 圆形 discard 比 CircleGeometry 更利于顶点位移
  const geometry = new THREE.PlaneGeometry(WATER_RADIUS * 2.1, WATER_RADIUS * 2.1, 160, 160);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uRipples: { value: [] },
    uRippleCount: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
  };
  for (let i = 0; i < MAX_RIPPLES; i++) {
    uniforms.uRipples.value.push(new THREE.Vector4(0, 0, -100, 0));
  }

  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'pond-water';
  mesh.frustumCulled = false;

  let next = 0;
  const api = {
    mesh,
    radius: WATER_RADIUS,
    /** 在 (x, z) 处添加一个涟漪。amplitude 建议 0.15 ~ 0.6。 */
    addRipple(x, z, amplitude = 0.35, time = 0) {
      const slot = uniforms.uRipples.value[next];
      slot.set(x, z, time, amplitude);
      next = (next + 1) % MAX_RIPPLES;
      uniforms.uRippleCount.value = Math.min(uniforms.uRippleCount.value + 1, MAX_RIPPLES);
    },
    /** 主循环每帧调用：更新时间与相机位置。 */
    update(elapsedTime, cameraWorldPos) {
      uniforms.uTime.value = elapsedTime;
      if (cameraWorldPos) uniforms.uCamPos.value.copy(cameraWorldPos);
    },
  };
  return api;
}

export { WATER_RADIUS };
