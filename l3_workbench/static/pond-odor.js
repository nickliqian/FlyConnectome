// 岸边腐烂水果 + 气味羽流：浓度采样 + InstancedMesh 粒子云可视化。
import * as THREE from '/vendor/three.module.js';

/**
 * @param {{ position: THREE.Vector3, radius: number, strength: number }} opts
 *   radius：高斯羽流半径；strength：源心最大浓度（0-1）。
 * @returns {{ group, sample(x,z,t), setEnabled(bool), setParams({radius,strength}), update(dt, elapsed) }}
 */
export function createOdor(opts) {
  const group = new THREE.Group();
  group.name = 'odor-source';

  // ---- 腐烂水果本体 ----
  const fruit = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.42, 0),
    new THREE.MeshLambertMaterial({ color: 0x6b3a1a }),
  );
  fruit.position.set(0, 0.28, 0);
  fruit.rotation.set(0.3, 0.7, 0.1);
  group.add(fruit);

  // 果核上的深色斑点（简单"腐烂感"）
  const spotMat = new THREE.MeshLambertMaterial({ color: 0x2a1a0a });
  for (let i = 0; i < 4; i++) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), spotMat);
    spot.position.set(
      Math.cos(i * 1.6) * 0.34,
      0.30 + Math.sin(i * 0.9) * 0.10,
      Math.sin(i * 1.6) * 0.34,
    );
    group.add(spot);
  }

  // ---- 粒子云（InstancedMesh）：60 个小球沿源心上升 + 扩散 ----
  const COUNT = 60;
  const geom = new THREE.SphereGeometry(0.09, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xa9885a, transparent: true, opacity: 0.32, depthWrite: false,
  });
  const cloud = new THREE.InstancedMesh(geom, mat, COUNT);
  cloud.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(cloud);

  const dummy = new THREE.Object3D();
  const particles = new Array(COUNT).fill(0).map(() => ({
    angle: Math.random() * Math.PI * 2,
    r: Math.random() * 0.4,
    y: Math.random() * 2.4,
    vy: 0.35 + Math.random() * 0.5,
    vr: 0.15 + Math.random() * 0.20,
    phase: Math.random() * Math.PI * 2,
  }));

  group.position.copy(opts.position);

  const state = {
    position: opts.position.clone(),
    radius: opts.radius ?? 4.0,
    strength: opts.strength ?? 0.85,
    enabled: true,
  };

  return {
    group,
    /** 采样点 (x,z) 在时刻 t 处的气味浓度，返回 [0, 1]。 */
    sample(x, z, t) {
      if (!state.enabled) return 0;
      const dx = x - state.position.x;
      const dz = z - state.position.z;
      const d = Math.hypot(dx, dz);
      // 阵风：慢变正弦 + 二倍频，让 KC 的发放有 on/off 波动
      const puff = 0.7 + 0.3 * Math.sin(t * 0.4 + Math.sin(t * 0.15) * 2);
      const g = Math.exp(-(d * d) / (state.radius * state.radius));
      return Math.min(1, state.strength * g * puff);
    },
    /** 返回浓度梯度方向（朝源心的单位向量），供行为层用。 */
    gradientDir(x, z) {
      const dx = state.position.x - x;
      const dz = state.position.z - z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: dx / len, z: dz / len };
    },
    setEnabled(on) {
      state.enabled = !!on;
      cloud.visible = !!on;
      fruit.visible = true;   // 水果本体永远显示，只是关掉时不放气味
    },
    setParams({ radius, strength }) {
      if (radius != null) state.radius = radius;
      if (strength != null) state.strength = strength;
    },
    getParams() { return { ...state }; },
    setPosition(x, z) {
      state.position.set(x, state.position.y, z);
      group.position.copy(state.position);
    },
    /** 每帧推进粒子：上升 + 缓慢外扩 + 到高度后回到起点。 */
    update(dt, elapsed) {
      if (!state.enabled) return;
      const intensity = state.strength;
      for (let i = 0; i < COUNT; i++) {
        const p = particles[i];
        p.y += p.vy * dt * intensity;
        p.r += p.vr * dt * 0.6;
        p.angle += dt * 0.3;
        if (p.y > 2.4 + intensity * 1.6 || p.r > state.radius * 0.55) {
          p.y = 0.1;
          p.r = Math.random() * 0.3;
          p.angle = Math.random() * Math.PI * 2;
        }
        const sway = Math.sin(elapsed * 0.9 + p.phase) * 0.15;
        dummy.position.set(
          Math.cos(p.angle) * (p.r + sway),
          p.y,
          Math.sin(p.angle) * (p.r + sway),
        );
        const s = 0.6 + Math.min(1, p.y / 2.5) * 1.1;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        cloud.setMatrixAt(i, dummy.matrix);
      }
      cloud.instanceMatrix.needsUpdate = true;
    },
  };
}
