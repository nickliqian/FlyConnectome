// 池塘 3D 场景主入口：Three.js 渲染、场景搭建、参数绑定、交互、神经元集成、环境事件。
import * as THREE from '/vendor/three.module.js';
import { OrbitControls } from '/vendor/addons/controls/OrbitControls.js';
import { createWater, WATER_RADIUS } from '/pond-water.js';
import { Fly, Frog } from '/pond-behavior.js';
import { createOdor } from '/pond-odor.js';
import { Inspector } from '/pond-inspector.js';

/* ------------------------------------------------------------------ *
 *                          渲染器 / 场景 / 相机                       *
 * ------------------------------------------------------------------ */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x9dc1d9);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa7c8dc, 22, 60);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(9, 7.5, 12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.0, 0);
controls.minDistance = 3;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49;

function resize() {
  const header = document.querySelector('.app-header');
  const footer = document.querySelector('.status-bar');
  const headerH = header?.offsetHeight ?? 72;
  const footerH = footer?.offsetHeight ?? 44;
  const w = innerWidth;
  const h = Math.max(200, innerHeight - headerH - footerH);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ------------------------------------------------------------------ *
 *                              灯光                                   *
 * ------------------------------------------------------------------ */

scene.add(new THREE.HemisphereLight(0xbcd9e6, 0x3a5a2e, 0.65));
const sun = new THREE.DirectionalLight(0xfff2d8, 0.9);
sun.position.set(6, 12, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x99b8ff, 0.25);
rim.position.set(-6, 6, -8);
scene.add(rim);

/* ------------------------------------------------------------------ *
 *                        地面 / 池塘 / 岸边                            *
 * ------------------------------------------------------------------ */

// 远景草地
{
  const g = new THREE.Mesh(
    new THREE.CircleGeometry(45, 48),
    new THREE.MeshLambertMaterial({ color: 0x4f7340 }),
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.03;
  scene.add(g);
}

// 池塘泥底（比水面稍低一点，通过水面 discard 边缘看到）
{
  const g = new THREE.Mesh(
    new THREE.CircleGeometry(WATER_RADIUS, 48),
    new THREE.MeshLambertMaterial({ color: 0x2b3a2f }),
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = -0.35;
  scene.add(g);
}

// 岸边石环
{
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(WATER_RADIUS + 0.05, 0.28, 10, 96),
    new THREE.MeshLambertMaterial({ color: 0x7a6b48 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);
}

// 水（Shader）
const water = createWater();
scene.add(water.mesh);

/* ------------------------------------------------------------------ *
 *                          荷叶 / 芦苇 / 石头                          *
 * ------------------------------------------------------------------ */

const lilyPads = [];
function makeLilyPad(x, z, radius = 0.9, tilt = 0.05) {
  const geom = new THREE.CircleGeometry(radius, 28, 0.35, Math.PI * 2 - 0.35);
  const mat = new THREE.MeshLambertMaterial({ color: 0x3b7a3d, side: THREE.DoubleSide });
  const pad = new THREE.Mesh(geom, mat);
  pad.rotation.x = -Math.PI / 2;
  pad.rotation.z = Math.random() * Math.PI * 2;
  pad.position.set(x, 0.05, z);
  // 轻微倾斜
  pad.userData.tilt = new THREE.Vector3(rand(-tilt, tilt), 0, rand(-tilt, tilt));
  pad.userData.phase = Math.random() * Math.PI * 2;
  scene.add(pad);
  lilyPads.push(pad);
  return pad;
}
function rand(a, b) { return a + Math.random() * (b - a); }

// 中央主荷叶（青蛙坐这里）+ 若干散落的荷叶
const mainPad = makeLilyPad(0, 0, 1.4, 0.04);
[[-3.4, 1.8], [3.2, -2.4], [4.3, 3.1], [-4.6, -2.1], [-1.2, 4.3], [1.9, -4.6]]
  .forEach(([x, z]) => makeLilyPad(x, z, rand(0.6, 0.95), 0.08));

// 芦苇
function makeReed(x, z) {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshLambertMaterial({ color: 0x5a7f3f });
  for (let i = 0; i < 5; i++) {
    const h = rand(1.2, 2.4);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, h, 6), stemMat);
    stem.position.set(rand(-0.3, 0.3), h / 2, rand(-0.3, 0.3));
    stem.rotation.z = rand(-0.1, 0.1);
    group.add(stem);
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.28, 8),
      new THREE.MeshLambertMaterial({ color: 0x6a4b2a }),
    );
    head.position.copy(stem.position);
    head.position.y += h / 2 + 0.14;
    head.rotation.z = stem.rotation.z;
    group.add(head);
  }
  group.position.set(x, 0.02, z);
  scene.add(group);
}
makeReed(-6.8, 5.5); makeReed(7.2, -4.8); makeReed(8.2, 4.5);

// 石头
function makeRock(x, z, r) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(r, 0),
    new THREE.MeshLambertMaterial({ color: 0x6c6c68 }),
  );
  rock.position.set(x, r * 0.6, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  scene.add(rock);
}
makeRock(5.5, 5.5, 0.45); makeRock(-5.8, -4.8, 0.35); makeRock(-6.5, 3.2, 0.28);

/* ------------------------------------------------------------------ *
 *                          青蛙 / 果蝇池                              *
 * ------------------------------------------------------------------ */

const frog = new Frog(new THREE.Vector3(0, 0.15, 0));
scene.add(frog.mesh);

// 腐烂水果气味源：默认射在青蛙对岸、边界内、与青蛙拉开距离
const FRUIT_HOME = new THREE.Vector3(7.4, 0.15, 0);
const odorSource = createOdor({
  position: FRUIT_HOME,
  radius: 8.5,
  strength: 0.85,
});
scene.add(odorSource.group);

/** @type {Fly[]} */
let flies = [];
let flySeedCounter = 0;

function spawnFly() {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() < 0.7 ? rand(0.8, 3.2) : rand(3.2, WATER_RADIUS * 0.7);
  const pos = new THREE.Vector3(Math.cos(angle) * radius, rand(0.8, 2.4), Math.sin(angle) * radius);
  const idx = ++flySeedCounter;
  const fly = new Fly(pos, idx * 3.7, idx);
  scene.add(fly.mesh);
  flies.push(fly);
}

function removeFly(fly) {
  scene.remove(fly.mesh);
  fly.mesh.traverse?.((o) => { o.geometry?.dispose?.(); });
  flies = flies.filter((f) => f !== fly);
}

function resetFlies(count) {
  for (const f of flies) scene.remove(f.mesh);
  flies = [];
  for (let i = 0; i < count; i++) spawnFly();
}

/* ------------------------------------------------------------------ *
 *                          参数与 UI 绑定                             *
 * ------------------------------------------------------------------ */

const params = {
  gravity: 9.8, windX: 0, windY: 0, windZ: 0,
  reaction: 0.3, tongueSpeed: 8, tongueRange: 3, hunger: 6, frogView: 5,
  flyCount: 6, wanderSpeed: 1.2, escapeProb: 0.85, escapeForce: 6, escapeRadius: 0.7,
  // 环境事件
  odorStrength: 0.85, odorRadius: 8.5,
  // 嗅觉链路
  g_orn: 3.0, tau_adapt: 2.0, g_ln: 0.55, kc_theta: 0.35, k_odor: 8.0,
  // GF
  theta_base: 1.0, gf_tau: 0.06, g_tongue: 3.2, s_gain: 0.5, h_gain: 0.55,
};

const toggles = {
  enable_or: true, enable_adapt: true, enable_ln: true,
  enable_gf: true, enable_plasticity: true,
  enable_odor_plume: true, enable_habit_events: true,
};

const DECIMALS = {
  gravity: 1, windX: 1, windY: 1, windZ: 1,
  reaction: 2, tongueSpeed: 1, tongueRange: 1, hunger: 1, frogView: 1,
  flyCount: 0, wanderSpeed: 1, escapeProb: 2, escapeForce: 1, escapeRadius: 2,
  odorStrength: 2, odorRadius: 1,
  g_orn: 2, tau_adapt: 2, g_ln: 2, kc_theta: 2, k_odor: 2,
  theta_base: 2, gf_tau: 3, g_tongue: 2, s_gain: 2, h_gain: 2,
};

function bindSlider(id) {
  const input = document.getElementById(id);
  const out = document.getElementById('o-' + id);
  const apply = () => {
    params[id] = parseFloat(input.value);
    out.textContent = params[id].toFixed(DECIMALS[id] ?? 2);
  };
  input.addEventListener('input', apply);
  apply();
}
Object.keys(params).forEach(bindSlider);

function bindToggle(id) {
  const el = document.getElementById(id);
  const apply = () => {
    toggles[id] = !!el.checked;
    if (id === 'enable_odor_plume') odorSource.setEnabled(toggles.enable_odor_plume);
  };
  el.addEventListener('change', apply);
  apply();
}
Object.keys(toggles).forEach(bindToggle);

// 视角切换
let cameraMode = 'orbit';
function setCameraMode(mode) {
  cameraMode = mode;
  const target = new THREE.Vector3(0, 1.0, 0);
  if (mode === 'top') camera.position.set(0.01, 18, 0.01);
  else if (mode === 'side') camera.position.set(0, 2.2, 12);
  else if (mode === 'orbit') camera.position.set(9, 7.5, 12);
  else if (mode === 'frog') { /* 主循环里跟随 */ }
  controls.target.copy(mode === 'frog' ? new THREE.Vector3(0, 0.6, 1.2) : target);
  document.querySelectorAll('.cam-btn').forEach((b) => b.classList.toggle('selected', b.dataset.cam === mode));
}
document.querySelectorAll('.cam-btn').forEach((b) => {
  b.addEventListener('click', () => setCameraMode(b.dataset.cam));
});

// 折叠参数面板
const paramsEl = document.getElementById('params');
document.getElementById('collapse').addEventListener('click', () => {
  paramsEl.classList.toggle('collapsed');
  document.getElementById('collapse').textContent = paramsEl.classList.contains('collapsed') ? '▶' : '◀';
});

// 重置
document.getElementById('reset').addEventListener('click', () => {
  resetFlies(params.flyCount);
  frog.state = 'idle';
  frog.stateTimer = 0;
  frog.tongueLength = 0;
  frog.caughtFly = null;
  frog.targetFly = null;
  frog.hungerTimer = 0;
  frog.parts.tongue.visible = false;
  frog.parts.tongueTip.visible = false;
  frog.parts.mouth.scale.set(1, 1, 1);
  stats.caught = 0;
  stats.drowned = 0;
  odorSource.setPosition(FRUIT_HOME.x, FRUIT_HOME.z);
  nextHabitAt = 8 + Math.random() * 6;
  toast('场景已重置');
});

// 事件按钮
document.getElementById('evt-leaf').addEventListener('click', () => {
  triggerHabituationPulse();
  toast('落叶飘下——无害扰动 (当前习惯化会逐次提高 θ)');
});
document.getElementById('evt-fruit-near').addEventListener('click', () => {
  odorSource.setPosition(1.4, 0.9);
  toast('水果射到了青蛙旁——观察趋化与危险拉扯');
});
document.getElementById('evt-fruit-home').addEventListener('click', () => {
  odorSource.setPosition(FRUIT_HOME.x, FRUIT_HOME.z);
  toast('水果射回岸边');
});

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(toast._h);
  toast._h = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ *
 *                          点击交互（Raycast）                        *
 * ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const inspector = new Inspector();
inspector.onNext = () => {
  // 跟随下一只现存 alive fly
  if (!flies.length) return;
  const alive = flies.filter((f) => f.state === 'alive');
  if (!alive.length) return;
  const cur = alive.indexOf(inspector.fly);
  const next = alive[(cur + 1) % alive.length];
  inspector.open(next);
};

function findFlyFromObject(obj) {
  let o = obj;
  while (o) {
    const f = flies.find((x) => x.mesh === o);
    if (f) return f;
    o = o.parent;
  }
  return null;
}

// 记录拖拽与点击区分（拖拽相机时不触发点击）
let downX = 0, downY = 0, downTime = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  downX = e.clientX; downY = e.clientY; downTime = performance.now();
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  const dx = e.clientX - downX, dy = e.clientY - downY;
  if (Math.hypot(dx, dy) > 6 || performance.now() - downTime > 500) return; // 视为拖拽
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // 先测果蝇（递归到叶 mesh）
  const flyMeshes = flies.filter((f) => f.state === 'alive' || f.state === 'drowning').map((f) => f.mesh);
  const flyHits = raycaster.intersectObjects(flyMeshes, true);
  if (flyHits.length > 0) {
    const fly = findFlyFromObject(flyHits[0].object);
    if (fly && fly.state === 'alive') {
      fly.forceEscape(params.escapeForce);
      inspector.open(fly);
      return;
    }
    if (fly && fly.state === 'drowning') {
      fly.state = 'alive';
      fly.velocity.set(rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5));
      return;
    }
  }

  // 再测水面 → 涟漪
  const waterHits = raycaster.intersectObject(water.mesh, false);
  if (waterHits.length > 0) {
    const p = waterHits[0].point;
    water.addRipple(p.x, p.z, 0.4, clock.elapsedTime);
  }
});

/* ------------------------------------------------------------------ *
 *                          统计与状态栏                               *
 * ------------------------------------------------------------------ */

const stats = { caught: 0, drowned: 0, lastFrame: performance.now(), fpsSmooth: 60 };
function updateStatus() {
  const alive = flies.filter((f) => f.state === 'alive').length;
  document.getElementById('caught').textContent = '已捕获 ' + stats.caught;
  document.getElementById('alive').textContent = '存活 ' + alive;
  document.getElementById('drowned').textContent = '落水 ' + stats.drowned;
  document.getElementById('fps').textContent = 'FPS ' + Math.round(stats.fpsSmooth);
}

/* ------------------------------------------------------------------ *
 *                            动画主循环                               *
 * ------------------------------------------------------------------ */

const clock = new THREE.Clock();

// ---- 环境事件：无害自动扰动（习惯化驱动） ----
let nextHabitAt = 8 + Math.random() * 6;
let habitPulse = 0;                // 当前一帧施加到每只 fly 的额外感觉电流

function triggerHabituationPulse() {
  habitPulse = 1.0;
  // 随机远处涟漪作为可视化提示
  const ang = Math.random() * Math.PI * 2;
  const r = 6 + Math.random() * 3;
  water.addRipple(Math.cos(ang) * r, Math.sin(ang) * r, 0.35, clock.elapsedTime);
}

function buildNeuron() {
  return {
    odorParams: {
      enable_or: toggles.enable_or,
      enable_adapt: toggles.enable_adapt,
      enable_ln: toggles.enable_ln,
      g_orn: params.g_orn,
      c0: 0.02,
      tau_adapt: params.tau_adapt,
      b: 0.5,
      g_pn: 1.4,
      g_ln: params.g_ln,
      tau_ln: 0.45,
      kc_theta: params.kc_theta,
      k_odor: params.k_odor,
    },
    gfParams: {
      enable_gf: toggles.enable_gf,
      enable_plasticity: toggles.enable_plasticity,
      tau: params.gf_tau,
      tau_ahp: 0.4,
      ahp_kick: 0.55,
      theta_base: params.theta_base,
      refractory: 0.55,
      g_tongue: params.g_tongue,
      tongue_input_radius: 1.2,
      h_gain: params.h_gain,
      h_kick: 0.02,
      tau_habit: 20,
      s_gain: params.s_gain,
      tau_sens: 8,
    },
    escapeForce: params.escapeForce,
    escapeProbLegacy: params.escapeProb,
    escapeRadiusLegacy: params.escapeRadius,
  };
}

function buildEnv(elapsed) {
  // 气味参数每帧同步到 odor source
  odorSource.setParams({ radius: params.odorRadius, strength: params.odorStrength });
  return {
    time: elapsed,
    gravity: params.gravity,
    wind: new THREE.Vector3(params.windX, params.windY, params.windZ),
    wanderSpeed: params.wanderSpeed,
    escapeProb: params.escapeProb,
    escapeForce: params.escapeForce,
    escapeRadius: params.escapeRadius,
    pondRadius: WATER_RADIUS,
    tongueTip: frog.tongueTipWorld,
    tongueActive: frog.state === 'strike',
    neuron: buildNeuron(),
    habitPulse,
    onDrown: (x, z) => {
      stats.drowned++;
      water.addRipple(x, z, 0.25, elapsed);
    },
    onTongueSplash: (x, z) => water.addRipple(x, z, 0.55, elapsed),
  };
}

/** 逐只 fly 采一次浓度与梯度（需依赖 fly.position）。 */
function applyOdorToFly(fly, elapsed) {
  if (!toggles.enable_odor_plume) {
    fly._envConcentration = 0;
    fly._envOdorGrad = null;
    return;
  }
  fly._envConcentration = odorSource.sample(fly.position.x, fly.position.z, elapsed);
  fly._envOdorGrad = odorSource.gradientDir(fly.position.x, fly.position.z);
}

function frogEnv(elapsed) {
  return {
    reactionTime: params.reaction,
    tongueSpeed: params.tongueSpeed,
    tongueRange: params.tongueRange,
    hungerPeriod: params.hunger,
    viewRadius: params.frogView,
    hitRadius: 0.18,
    onTongueSplash: (x, z) => water.addRipple(x, z, 0.55, elapsed),
  };
}

function adjustFlyCount() {
  const target = params.flyCount;
  const aliveOrDrowning = flies.filter((f) => f.state !== 'removed').length;
  if (aliveOrDrowning < target) {
    for (let i = aliveOrDrowning; i < target; i++) spawnFly();
  } else if (aliveOrDrowning > target) {
    // 优先移除已 drowning 的
    let toRemove = aliveOrDrowning - target;
    for (const f of [...flies]) {
      if (toRemove === 0) break;
      if (f.state === 'drowning' || f.state === 'removed') {
        removeFly(f); toRemove--;
      }
    }
    while (toRemove-- > 0 && flies.length) removeFly(flies[0]);
  }
}

// 将 state='removed' 的果蝇从场景移除并计入统计；同时广播致敏
function countCaught() {
  const removed = flies.filter((f) => f.state === 'removed');
  for (const r of removed) {
    stats.caught++;
    // 致敏：青蛙附近 3.5 单位内的其他果蝇 θ 下降 (sens 充1)
    for (const other of flies) {
      if (other === r || other.state !== 'alive') continue;
      const d = Math.hypot(other.position.x - frog.mesh.position.x, other.position.z - frog.mesh.position.z);
      if (d < 3.5) other.gf.sensitize(1.0);
    }
    if (inspector.fly === r) inspector.close();
    removeFly(r);
  }
}

let lastTick = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, clock.getDelta());
  const elapsed = clock.elapsedTime;

  // FPS
  const frameMs = now - stats.lastFrame;
  stats.lastFrame = now;
  stats.fpsSmooth = stats.fpsSmooth * 0.92 + (1000 / Math.max(1, frameMs)) * 0.08;

  // 自动无害扰动调度
  if (toggles.enable_habit_events && elapsed > nextHabitAt) {
    triggerHabituationPulse();
    nextHabitAt = elapsed + 8 + Math.random() * 8;
  }
  // habitPulse 快速衰减（约 30 帧内失效）
  habitPulse = Math.max(0, habitPulse - dt * 3.0);

  adjustFlyCount();

  const fenv = frogEnv(elapsed);
  frog.update(dt, flies, fenv);

  const env = buildEnv(elapsed);
  for (const fly of flies) {
    applyOdorToFly(fly, elapsed);
    env.concentration = fly._envConcentration;
    env.odorGrad = fly._envOdorGrad;
    fly.update(dt, env);
    if (inspector.fly === fly) inspector.record(fly, elapsed);
  }

  countCaught();

  // 若当前检视的 fly 已被青蛙抓住，自动关闭 inspector
  if (inspector.fly && (inspector.fly.state === 'caught' || inspector.fly.state === 'removed')) {
    inspector.close();
  }

  // 荷叶轻微起伏
  for (const pad of lilyPads) {
    const t = pad.userData;
    pad.position.y = 0.05 + Math.sin(elapsed * 1.1 + t.phase) * 0.02;
    pad.rotation.x = -Math.PI / 2 + t.tilt.x + Math.sin(elapsed * 0.9 + t.phase) * 0.01;
    pad.rotation.z = t.tilt.z + Math.cos(elapsed * 0.8 + t.phase) * 0.01;
  }
  // 青蛙跟随荷叶起伏
  frog.mesh.position.y = mainPad.position.y + 0.1;

  // 水面 + 粒子云 uniforms
  water.update(elapsed, camera.position);
  odorSource.update(dt, elapsed);

  // 相机
  if (cameraMode === 'frog') {
    const back = new THREE.Vector3(0, 1.2, -3.5).applyQuaternion(frog.mesh.quaternion);
    const desired = frog.mesh.position.clone().add(back);
    camera.position.lerp(desired, 0.06);
    const look = frog.mesh.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    controls.target.lerp(look, 0.1);
  }
  controls.update();

  updateStatus();
  renderer.render(scene, camera);
  lastTick = now;
}

/* ------------------------------------------------------------------ *
 *                              启动                                    *
 * ------------------------------------------------------------------ */

resize();
resetFlies(params.flyCount);
toast('欢迎来到池塘：左键点果蝇弹开·点水面起涟漪·拖拽旋转·滚轮缩放');
animate();

// 清理：离开页面时释放 GPU 资源
addEventListener('beforeunload', () => {
  renderer.dispose();
});
