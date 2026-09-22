// 果蝇神经元模型：L1 嗅觉链路 + 尾须 Giant Fiber 逃逸。
// 全部纯 JS，不依赖 Three.js；每只 fly 各持一份实例。

/**
 * OdorCircuit：ORN → PN → LN → KC 四级链路，逐层复现 L1 关键现象。
 *
 *   ORN  r_orn = g_orn * max(0, c - c0)
 *        dA/dt = -A/tau_adapt + b * r_orn          // 适应变量（对持续气味衰减）
 *        out_orn = max(0, r_orn - A)
 *   PN   out_pn = g_pn * out_orn                    // 一级增益
 *   LN   dS/dt = (out_pn - S)/tau_ln                // 局部均值低通
 *        out_ln = out_pn - g_ln * S                 // 侧抑制（减均值 → 提升对比度）
 *   KC   fire = out_ln > kc_theta ? 1 : 0           // 阈值化稀疏编码
 *
 * Ablation 开关：enable_or / enable_adapt / enable_ln 关掉对应级会显著改变行为。
 */
export class OdorCircuit {
  constructor() {
    this.r_orn = 0;      // ORN 瞬时发放率（未适应）
    this.adapt = 0;      // 适应变量 A
    this.out_orn = 0;    // 适应后的 ORN 输出
    this.out_pn = 0;     // PN 输出
    this.ln_state = 0;   // LN 低通状态 S
    this.out_ln = 0;     // 侧抑制后的 PN 信号
    this.fire = 0;       // KC 二值发放（0/1）
    this.concentration = 0;
  }

  step(dt, c, p) {
    this.concentration = c;
    // ---- ORN 层 ----
    if (!p.enable_or) {
      this.r_orn = this.out_orn = this.out_pn = this.out_ln = this.fire = 0;
      this.adapt *= Math.exp(-dt / Math.max(1e-3, p.tau_adapt));
      this.ln_state *= Math.exp(-dt / Math.max(1e-3, p.tau_ln));
      return;
    }
    this.r_orn = p.g_orn * Math.max(0, c - p.c0);
    if (p.enable_adapt) {
      this.adapt += dt * (-this.adapt / Math.max(1e-3, p.tau_adapt) + p.b * this.r_orn);
      if (this.adapt < 0) this.adapt = 0;
    } else {
      // 关闭适应 → A 恒 0
      this.adapt = 0;
    }
    this.out_orn = Math.max(0, this.r_orn - this.adapt);

    // ---- PN 层 ----
    this.out_pn = p.g_pn * this.out_orn;

    // ---- LN 层（一阶低通近似全局均值 → 侧抑制） ----
    const tau_ln = Math.max(1e-3, p.tau_ln);
    this.ln_state += dt * (this.out_pn - this.ln_state) / tau_ln;
    const gLn = p.enable_ln ? p.g_ln : 0;
    this.out_ln = Math.max(0, this.out_pn - gLn * this.ln_state);

    // ---- KC 层（阈值稀疏编码） ----
    this.fire = this.out_ln > p.kc_theta ? 1 : 0;
  }
}

/**
 * GiantFiber：leaky integrate-and-fire + 动态阈值 + 后超极化。
 *
 *   dV/dt = sensI - (V - V_rest)/tau - AHP
 *   dAHP/dt = -AHP/tau_ahp           spike 时 AHP += ahp_kick
 *   spike 判定：V ≥ θ && cooldown ≤ 0 → 复位 V、冷却 cd、AHP 冲击
 *
 * 可塑性（受 enable_plasticity 门控）：
 *   习惯化：每次 subthreshold 感觉输入 → habit 变量 += h_kick，随 tau_plast 衰减；
 *           θ = θ_base + hGain * habit（把阈值抬高）
 *   致敏：外部事件（同伴被抓）→ sens 变量 = 1，随 tau_sens 衰减；
 *         θ = θ_base * (1 - sGain * sens)（把阈值降低）
 * 二者共存时按加性合成：θ = θ_base + hGain*habit - sGain*sens*(θ_base*0.5)
 */
export class GiantFiber {
  constructor() {
    this.V = 0;
    this.ahp = 0;
    this.cool = 0;                // 不应期剩余（秒）
    this.habit = 0;               // 习惯化状态量（0~2）
    this.sens = 0;                // 致敏状态量（0~1）
    this.theta = 1.0;             // 当前阈值（每帧根据可塑性重算）
    this.spikeFlag = false;       // 本帧是否 spike（供主循环消费）
    this.lastSpikeTime = -999;
    this.spikeTimes = [];         // 供检视器画 spike 竖线，最多保留 ~40 条
  }

  /**
   * @param {number} dt
   * @param {number} sensI  当前感觉电流（>=0；单位与 θ_base 同尺度）
   * @param {object} p      参数字典，见 pond.js 中的 gfParams
   * @param {number} time   仿真已运行秒数（用于记录 spike 时刻）
   */
  step(dt, sensI, p, time) {
    this.spikeFlag = false;

    // 阈值可塑性
    if (p.enable_plasticity) {
      // 每次 subthreshold 感觉输入都轻微抬高 habit（越刺激越"麻木"）
      if (sensI > 0.05 && this.V < this.theta) {
        this.habit += p.h_kick * dt * 6;
      }
      // 时间衰减：habit 慢慢回到 0；sens 慢慢回到 0
      this.habit *= Math.exp(-dt / Math.max(1e-3, p.tau_habit));
      this.sens *= Math.exp(-dt / Math.max(1e-3, p.tau_sens));
      const hEff = Math.min(1.2, this.habit);
      const sEff = Math.min(1.0, this.sens);
      this.theta = p.theta_base * (1 - p.s_gain * sEff) + p.h_gain * hEff;
      if (this.theta < p.theta_base * 0.3) this.theta = p.theta_base * 0.3;
    } else {
      this.habit *= Math.exp(-dt / Math.max(1e-3, p.tau_habit));
      this.sens *= Math.exp(-dt / Math.max(1e-3, p.tau_sens));
      this.theta = p.theta_base;
    }

    if (!p.enable_gf) {
      // 消融：整个 LIF 冻结；主循环会检测到 enable_gf=false 并回退到旧概率逃逸
      return;
    }

    // 膜电位积分
    const drive = sensI - (this.V - 0) / p.tau - this.ahp;
    this.V += dt * drive;
    if (this.V < 0) this.V = 0;

    // AHP 衰减
    this.ahp *= Math.exp(-dt / Math.max(1e-3, p.tau_ahp));

    // 不应期
    if (this.cool > 0) {
      this.cool -= dt;
      return;
    }

    // spike 判定：全或无
    if (this.V >= this.theta) {
      this.V = 0;
      this.ahp += p.ahp_kick;
      this.cool = p.refractory;
      this.spikeFlag = true;
      this.lastSpikeTime = time;
      this.spikeTimes.push(time);
      if (this.spikeTimes.length > 60) this.spikeTimes.shift();
    }
  }

  /** 外部事件：目睹同伴被抓 → 致敏。 */
  sensitize(amount = 1) {
    this.sens = Math.min(1.5, this.sens + amount);
  }

  /** 外部事件：subthreshold 无害扰动 → 直接给一点电流（若启用可塑性会自然累积习惯化）。 */
  poke(sensI) {
    if (this.V < this.theta) this.habit += 0.05;
  }
}

/**
 * 一组默认参数；实际值由 pond.js 的 params 面板覆盖。
 */
export const defaultNeuronParams = {
  // ---- OdorCircuit ----
  enable_or: true, enable_adapt: true, enable_ln: true,
  g_orn: 3.0, c0: 0.02, tau_adapt: 2.0, b: 0.5,
  g_pn: 1.4, g_ln: 0.55, tau_ln: 0.45, kc_theta: 0.35,
  k_odor: 6.5,

  // ---- GiantFiber ----
  enable_gf: true, enable_plasticity: true,
  tau: 0.06, tau_ahp: 0.4, ahp_kick: 0.55,
  theta_base: 1.0, refractory: 0.55,
  g_tongue: 3.2, tongue_input_radius: 1.2,
  h_gain: 0.55, h_kick: 0.02, tau_habit: 20,
  s_gain: 0.5, tau_sens: 8,
};
