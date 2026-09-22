// 青蛙 + 果蝇的行为系统：程序化建模 + 状态机 + 简单物理 + 内置神经元。
// 不依赖 pond.js 的场景搭建；只暴露 Frog / Fly 类，供主循环使用。
import * as THREE from '/vendor/three.module.js';
import { OdorCircuit, GiantFiber } from '/pond-neuron.js';

const WRAP_TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randUnit = () => {
  const t = Math.random() * WRAP_TAU;
  const y = Math.random() * 2 - 1;
  const r = Math.sqrt(1 - y * y);
  return new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t));
};

/* ------------------------------------------------------------------ *
 *                        程序化建模 helpers                            *
 * ------------------------------------------------------------------ */

const FROG_SKIN = 0x4d8a44;
const FROG_BELLY = 0xa8c88a;
const TONGUE = 0xd5586f;

/** 构造一只坐着的青蛙（Group）。返回 { group, parts }，parts 含 eyes / mouth / tongue / tongueTip。 */
export function buildFrog() {
  const group = new THREE.Group();
  group.name = 'frog';

  const skin = new THREE.MeshLambertMaterial({ color: FROG_SKIN });
  const belly = new THREE.MeshLambertMaterial({ color: FROG_BELLY });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b3a24 });

  // 身体（略扁）
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), skin);
  body.scale.set(1.05, 0.72, 0.95);
  body.position.set(0, 0.35, 0);
  body.castShadow = true;
  group.add(body);

  // 肚皮
  const under = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), belly);
  under.scale.set(1.0, 0.5, 0.9);
  under.position.set(0, 0.22, 0.05);
  group.add(under);

  // 头
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 22, 18), skin);
  head.scale.set(1.15, 0.75, 0.9);
  head.position.set(0, 0.55, 0.32);
  head.castShadow = true;
  group.add(head);

  // 嘴缝
  const mouthGeom = new THREE.BoxGeometry(0.32, 0.02, 0.02);
  const mouth = new THREE.Mesh(mouthGeom, dark);
  mouth.position.set(0, 0.48, 0.62);
  group.add(mouth);

  // 眼睛（两组：眼白 + 瞳孔），每组挂在 eyeGroup 上便于 lookAt
  const eyeWhite = new THREE.MeshLambertMaterial({ color: 0xf5efe0 });
  const eyeBlack = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const makeEye = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.20 * side, 0.78, 0.34);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), eyeWhite);
    pivot.add(ball);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), eyeBlack);
    pupil.position.set(0, 0, 0.09);
    pivot.add(pupil);
    group.add(pivot);
    return pivot;
  };
  const leftEye = makeEye(-1);
  const rightEye = makeEye(1);

  // 四肢（简化，只做成为静态圆柱）
  const legMat = skin;
  const addLeg = (x, z, length, tilt) => {
    const g = new THREE.CylinderGeometry(0.08, 0.11, length, 10);
    const m = new THREE.Mesh(g, legMat);
    m.position.set(x, length / 2 - 0.02, z);
    m.rotation.z = tilt;
    group.add(m);
  };
  addLeg(-0.42, 0.15, 0.25, 0.4);
  addLeg(0.42, 0.15, 0.25, -0.4);
  addLeg(-0.55, -0.25, 0.35, 0.5);
  addLeg(0.55, -0.25, 0.35, -0.5);

  // 舌托（Group），原点位于嘴部；scale.z 沿局部 +Z 拉伸
  const mouthAnchor = new THREE.Group();
  mouthAnchor.position.set(0, 0.48, 0.62);
  group.add(mouthAnchor);

  const tongueGeom = new THREE.CylinderGeometry(0.045, 0.055, 1, 10);
  tongueGeom.translate(0, 0.5, 0);   // 底在 origin
  tongueGeom.rotateX(-Math.PI / 2);  // 沿 +Z 拉伸（tip 在 z=+1）
  const tongue = new THREE.Mesh(tongueGeom, new THREE.MeshLambertMaterial({ color: TONGUE }));
  tongue.visible = false;
  mouthAnchor.add(tongue);

  const tongueTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xe46f83 }),
  );
  tongueTip.position.set(0, 0, 1);
  tongueTip.visible = false;
  mouthAnchor.add(tongueTip);

  return {
    group,
    parts: { leftEye, rightEye, mouthAnchor, tongue, tongueTip, mouth },
  };
}

/** 构造一只果蝇（Group）。翅膀绕 z 轴摆动即可。 */
export function buildFly() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b3038 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), bodyMat);
  body.scale.set(0.85, 0.9, 1.3);
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0x1a1e23 }));
  head.position.set(0, 0.006, 0.06);
  group.add(head);

  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x9a3232 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
    e.position.set(0.022 * sx, 0.02, 0.078);
    group.add(e);
  }

  const wingMat = new THREE.MeshBasicMaterial({
    color: 0xcfd9e6, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  });
  const wingGeom = new THREE.PlaneGeometry(0.09, 0.035);
  wingGeom.translate(0.045, 0, 0);
  const leftWing = new THREE.Mesh(wingGeom, wingMat);
  leftWing.position.set(0, 0.03, 0.01);
  leftWing.rotation.set(-Math.PI / 2, 0, 0.3);
  const rightWing = new THREE.Mesh(wingGeom.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1)), wingMat);
  rightWing.position.set(0, 0.03, 0.01);
  rightWing.rotation.set(-Math.PI / 2, 0, -0.3);
  group.add(leftWing); group.add(rightWing);

  return { group, parts: { leftWing, rightWing } };
}

/* ------------------------------------------------------------------ *
 *                              Fly                                   *
 * ------------------------------------------------------------------ */

/**
 * 单只果蝇：内置 OdorCircuit (L1) + GiantFiber (逃逸)，驱动 3D 漫游与逃逸。
 * state: 'alive' | 'drowning' | 'caught' | 'removed'
 */
export class Fly {
  constructor(spawnPos, seed, index) {
    const { group, parts } = buildFly();
    this.mesh = group;
    this.wings = parts;
    this.index = index;              // 供检视器标识
    this.position = spawnPos.clone();
    this.velocity = new THREE.Vector3(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3));
    this.seed = seed;
    this.state = 'alive';
    this.cooldownUntil = 0;
    this.drownTimer = 0;
    this.age = 0;
    this.odor = new OdorCircuit();
    this.gf = new GiantFiber();
    this._pendingEscape = 0;         // 本帧待施加的逃逸量级（用户/环境注入）
    group.position.copy(this.position);
  }

  /**
   * env 字段：
   *  time, gravity, wind, wanderSpeed,
   *  tongueTip, tongueActive, pondRadius, onDrown,
   *  neuron: {odorParams, gfParams, escapeForce},
   *  concentration, odorGrad: {x,z},
   *  habitPulse (0-1 无害扰动电流强度)
   */
  update(dt, env) {
    this.age += dt;
    if (this.state === 'caught' || this.state === 'removed') return;
    if (this.state === 'drowning') {
      this.drownTimer += dt;
      this.wings.leftWing.rotation.z = Math.sin(env.time * 40) * 0.4 + 0.3;
      this.wings.rightWing.rotation.z = Math.sin(env.time * 40) * -0.4 - 0.3;
      this.mesh.position.copy(this.position);
      if (this.drownTimer > 4) this.state = 'removed';
      return;
    }

    const N = env.neuron;

    // ---- GF 感觉电流：舌头接近强度 + 环境无害扰动脉冲 ----
    let sensI = 0;
    if (env.tongueActive) {
      const d = this.position.distanceTo(env.tongueTip);
      const r = Math.max(1e-3, N.gfParams.tongue_input_radius);
      sensI += N.gfParams.g_tongue * Math.max(0, 1 - d / r);
    }
    if (env.habitPulse > 0) sensI += env.habitPulse * 0.35;
    if (this._pendingEscape > 0) {
      // 用户直接点击 / 致敏事件注入 → 向 V 注人电荷，下一级 GF 会判定 spike
      this.gf.V += this._pendingEscape;
      this.gf.cool = 0;
      this._pendingEscape = 0;
    }
    this.gf.step(dt, sensI, N.gfParams, env.time);

    // ---- 逃逸执行 ----
    if (N.gfParams.enable_gf) {
      if (this.gf.spikeFlag) {
        const burst = randUnit();
        burst.y = Math.abs(burst.y) * 0.9 + 0.4;
        this.velocity.addScaledVector(burst, N.escapeForce);
        this.cooldownUntil = env.time + 0.6;
      }
    } else if (env.tongueActive) {
      // 消融对照：旧版“距离 + 概率”逃逸
      const d = this.position.distanceTo(env.tongueTip);
      if (d < N.escapeRadiusLegacy && env.time > this.cooldownUntil && Math.random() < N.escapeProbLegacy) {
        const burst = randUnit();
        burst.y = Math.abs(burst.y) * 0.9 + 0.4;
        this.velocity.addScaledVector(burst, N.escapeForce);
        this.cooldownUntil = env.time + 0.9;
      }
    }

    // ---- 嗅觉链路 ----
    this.odor.step(dt, env.concentration || 0, N.odorParams);

    // ---- 漫游 ----
    const s = this.seed;
    const t = this.age;
    const wander = env.wanderSpeed;
    const nx = Math.sin(t * 1.7 + s * 0.9) + 0.6 * Math.sin(t * 3.4 + s * 1.5);
    const ny = Math.sin(t * 1.4 + s * 2.1) + 0.6 * Math.sin(t * 2.7 + s * 0.5);
    const nz = Math.sin(t * 1.9 + s * 3.7) + 0.6 * Math.sin(t * 3.1 + s * 2.3);

    const drag = 2.6;
    let ax = env.wind.x + nx * wander * 3.5;
    let az = env.wind.z + nz * wander * 3.5;

    // ---- 趋化拉力：仅当 KC 发放时朝源心拉 ----
    if (this.odor.fire && env.odorGrad) {
      ax += env.odorGrad.x * N.odorParams.k_odor;
      az += env.odorGrad.z * N.odorParams.k_odor;
      // 趋化时抑制漫游（“专注”），让行为差异更可视化
      ax -= nx * wander * 2.2;
      az -= nz * wander * 2.2;
    }

    this.velocity.x += (ax - drag * this.velocity.x) * dt;
    this.velocity.z += (az - drag * this.velocity.z) * dt;

    const altTarget = 1.4 + Math.sin(t * 0.6 + s * 1.3) * 0.7 + 0.35 * Math.sin(t * 1.7 + s);
    const altErr = altTarget - this.position.y;
    const liftForce = altErr * 5.5 - this.velocity.y * 3.0;
    const gravityPull = env.gravity * 0.06;
    const verticalNoise = ny * wander * 1.4;
    this.velocity.y += (liftForce - gravityPull + verticalNoise + env.wind.y * 0.4) * dt;

    if (this.position.y > 3.6) this.velocity.y -= (this.position.y - 3.6) * 8 * dt;
    if (this.position.y < 0.28) {
      this.velocity.y += (0.28 - this.position.y) * 45 * dt;
      if (this.velocity.y < 0) this.velocity.y *= 0.6;
    }

    this.position.addScaledVector(this.velocity, dt);

    // 边界：超出 pondRadius 时朝中心加速
    const radialDist = Math.hypot(this.position.x, this.position.z);
    const bound = env.pondRadius * 0.85;
    if (radialDist > bound) {
      const pull = (radialDist - bound) * 4.0 * dt;
      this.velocity.x -= (this.position.x / radialDist) * pull;
      this.velocity.z -= (this.position.z / radialDist) * pull;
    }

    if (this.position.y < 0.03) {
      this.position.y = 0.03;
      this.velocity.set(0, 0, 0);
      this.state = 'drowning';
      this.drownTimer = 0;
      env.onDrown?.(this.position.x, this.position.z);
    }

    if (this.velocity.lengthSq() > 1e-4) {
      const target = this.position.clone().add(this.velocity);
      this.mesh.lookAt(target);
      this.mesh.rotateY(Math.PI / 2);
    }
    const flap = Math.sin(this.age * 55) * 0.9;
    this.wings.leftWing.rotation.z = flap + 0.3;
    this.wings.rightWing.rotation.z = -flap - 0.3;

    this.mesh.position.copy(this.position);
  }

  /** 用户点击→直接向 GF 注人电荷，下一级会 spike（若冷却中则自然延迟）。 */
  forceEscape(_force = 6) {
    if (this.state !== 'alive') return;
    this._pendingEscape += 3.5;
  }
}

/* ------------------------------------------------------------------ *
 *                              Frog                                  *
 * ------------------------------------------------------------------ */

const FROG_STATE = Object.freeze({
  IDLE: 'idle', LOCK: 'lock', STRIKE: 'strike', RETRACT: 'retract', CHEW: 'chew',
});

export { FROG_STATE };

/**
 * 青蛙：状态机 + 眼球追踪 + 舌头伸缩 + 捕食判定。
 * position 是世界坐标；朝向固定 +Z（可由外部旋转 group 改变）。
 */
export class Frog {
  constructor(worldPos) {
    const { group, parts } = buildFrog();
    this.mesh = group;
    this.parts = parts;
    this.mesh.position.copy(worldPos);
    this.state = FROG_STATE.IDLE;
    this.stateTimer = 0;
    this.tongueLength = 0;
    this.targetFly = null;        // Fly instance
    this.targetPoint = new THREE.Vector3();
    this.caughtFly = null;        // attached during RETRACT
    this.scanPhase = 0;
    this.hungerTimer = 0;
  }

  get mouthWorld() {
    return this.parts.mouthAnchor.getWorldPosition(new THREE.Vector3());
  }

  /** 舌头尖端的世界坐标（长度 = 0 时等于嘴部）。 */
  get tongueTipWorld() {
    return this.parts.tongueTip.getWorldPosition(new THREE.Vector3());
  }

  /** 参数：{ reactionTime, tongueSpeed, tongueRange, hungerPeriod, viewRadius, hitRadius } */
  update(dt, flies, env) {
    this.stateTimer += dt;
    this.hungerTimer += dt;
    const hungry = this.hungerTimer > env.hungerPeriod * 0.4;

    // 选择目标：最近的、实际可及（在舌头射程内）的 fly
    let nearest = null, nearestDist = Infinity;
    let visible = null, visibleDist = Infinity;
    for (const f of flies) {
      if (f.state === 'removed' || f.state === 'caught') continue;
      const d = f.position.distanceTo(this.mesh.position);
      if (d < env.tongueRange && d < nearestDist) { nearest = f; nearestDist = d; }
      if (d < env.viewRadius && d < visibleDist) { visible = f; visibleDist = d; }
    }
    this.visibleFly = visible;   // 仅供眼球追踪使用（可看到但捕不到）

    // 状态转移
    switch (this.state) {
      case FROG_STATE.IDLE: {
        this.parts.tongue.visible = false;
        this.parts.tongueTip.visible = false;
        if (nearest && (hungry || nearestDist < env.tongueRange * 0.7)) {
          this.targetFly = nearest;
          this.state = FROG_STATE.LOCK;
          this.stateTimer = 0;
        } else {
          // 眼球缓慢扫动，若有可见但射程外的 fly 则眼睛先跟踪它
          this.scanPhase += dt * 0.9;
        }
        break;
      }
      case FROG_STATE.LOCK: {
        // 眼球锁定，若目标已移出射程或超时 → 回 IDLE
        if (!nearest || nearestDist > env.tongueRange * 1.15) {
          this.state = FROG_STATE.IDLE; this.targetFly = null; break;
        }
        this.targetFly = nearest;
        this.targetPoint.copy(nearest.position);
        if (this.stateTimer >= env.reactionTime) {
          this.state = FROG_STATE.STRIKE;
          this.stateTimer = 0;
          this.tongueLength = 0.01;
          this.parts.tongue.visible = true;
          this.parts.tongueTip.visible = true;
        }
        break;
      }
      case FROG_STATE.STRIKE: {
        // 追踪目标（飞着的或水面挣扎的都实时更新）
        if (this.targetFly && (this.targetFly.state === 'alive' || this.targetFly.state === 'drowning')) {
          this.targetPoint.copy(this.targetFly.position);
        }
        this.tongueLength += env.tongueSpeed * dt;
        // 命中检测
        if (this.targetFly && (this.targetFly.state === 'alive' || this.targetFly.state === 'drowning')) {
          const tip = this.tongueTipWorld;
          if (tip.distanceTo(this.targetFly.position) < env.hitRadius) {
            this.targetFly.state = 'caught';
            this.caughtFly = this.targetFly;
            this.state = FROG_STATE.RETRACT;
            this.stateTimer = 0;
            break;
          }
        }
        if (this.tongueLength >= env.tongueRange) {
          // 未命中，舌头尖端触水 → 涟漪
          const tip = this.tongueTipWorld;
          env.onTongueSplash?.(tip.x, tip.z);
          this.state = FROG_STATE.RETRACT;
          this.stateTimer = 0;
        }
        break;
      }
      case FROG_STATE.RETRACT: {
        this.tongueLength = Math.max(0, this.tongueLength - env.tongueSpeed * 1.4 * dt);
        // 若捕获了 fly，让 fly 跟随舌尖
        if (this.caughtFly) {
          const tip = this.tongueTipWorld;
          this.caughtFly.position.copy(tip);
          this.caughtFly.mesh.position.copy(tip);
        }
        if (this.tongueLength <= 0.001) {
          if (this.caughtFly) {
            this.state = FROG_STATE.CHEW;
            this.stateTimer = 0;
            this.caughtFly.state = 'removed';
          } else {
            this.state = FROG_STATE.IDLE;
          }
        }
        break;
      }
      case FROG_STATE.CHEW: {
        this.caughtFly = null;
        this.targetFly = null;
        // 嘴部轻微缩放的呼吸效果
        const pulse = Math.sin(this.stateTimer * 22) * 0.06 + 1.0;
        this.parts.mouth.scale.set(pulse, 1, 1);
        if (this.stateTimer > 0.6) {
          this.state = FROG_STATE.IDLE;
          this.hungerTimer = 0;
          this.parts.mouth.scale.set(1, 1, 1);
        }
        break;
      }
    }

    // 每帧刷新眼球与舌头姿态
    let lookTarget;
    if (this.state === FROG_STATE.STRIKE || this.state === FROG_STATE.RETRACT) {
      lookTarget = this.targetPoint;
    } else if (this.targetFly && this.targetFly.state !== 'removed') {
      lookTarget = this.targetFly.position;
    } else if (this.visibleFly && this.visibleFly.state !== 'removed') {
      // 射程外但视野内的 fly：眼睛先跟踪，不发起攻击
      lookTarget = this.visibleFly.position;
    } else {
      // 缓慢扫动视线
      this.scanPhase += dt * 0.6;
      lookTarget = new THREE.Vector3(
        this.mesh.position.x + Math.cos(this.scanPhase) * 3,
        this.mesh.position.y + 1.4 + Math.sin(this.scanPhase * 0.7) * 0.5,
        this.mesh.position.z + Math.sin(this.scanPhase) * 3,
      );
    }
    this.parts.leftEye.lookAt(lookTarget);
    this.parts.rightEye.lookAt(lookTarget);

    // 舌头沿 +Z 拉伸
    this.parts.mouthAnchor.lookAt(this.state === FROG_STATE.STRIKE || this.state === FROG_STATE.RETRACT
      ? this.targetPoint : lookTarget);
    const L = Math.max(0.001, this.tongueLength);
    this.parts.tongue.scale.set(1, 1, L);
    this.parts.tongueTip.position.set(0, 0, L);
    this.parts.tongue.visible = L > 0.02;
    this.parts.tongueTip.visible = L > 0.02;
  }
}
