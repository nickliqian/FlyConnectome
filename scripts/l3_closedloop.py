"""L3 embodied closed loop: CX ring-attractor heading -> descending signal -> CPG turn.

Architecture (mirrors the L2 demo's central complex, now closing the loop through a
real body in MuJoCo):

  eye      : a compass beacon ("sun") at fixed world angle B. The eye measures the
             beacon *relative to the body axis*, beta = wrap(B - yaw) + sensor noise.
  CX (EB)  : 16-unit ring attractor. Fuses (a) idiothetic angular-velocity input
             (self-motion integration) with (b) the allothetic compass cue
             cue = wrap(B - beta) to maintain an internal heading estimate psi.
  plan     : desired heading = bearing to the current goal point (target switching).
  turn cmd : err = wrap(goal - psi)  ->  descending signal [left, right].
             The asymmetry gain is auto-calibrated by a short open-loop probe.
  body     : NeuroMechFly v2 CPG (vendored nmf_ctrl) drives the 42 leg DOFs +
             adhesion gating in flygym 2.0.1 / MuJoCo 3.6.

Outputs: l3_steer_top.mp4 (top view), l3_traj.png (trajectory + internal signals).
"""
import os
import sys
from pathlib import Path
os.environ.setdefault("MUJOCO_GL", "glfw")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import numpy as np, mujoco as mj, flygym, imageio.v2 as imageio
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from flygym.anatomy import BodySegment
from flygym.compose import FlatGroundWorld, ActuatorType
from flygym.utils.math import Rotation3D
from nmf_ctrl import make_locomotion_fly, TurningCPGController, RingAttractor

plt.rcParams["font.sans-serif"] = ["Hiragino Sans GB", "Arial Unicode MS", "STHeiti"]
plt.rcParams["axes.unicode_minus"] = False

OUT = str(Path(__file__).resolve().parent.parent)
WRAP = lambda a: (a + np.pi) % (2 * np.pi) - np.pi


# ------------------------------------------------------------------- build world
def build(spawn_z=0.5):
    fly = make_locomotion_fly(name="cpg", add_adhesion=True, colorize=True)
    top = fly.add_tracking_camera(name="top_cam", pos_offset=(0, 0, 11.0),
                                  rotation=Rotation3D("euler", (0.0, 0, 0)),
                                  fovy=45.0)
    dof_order = fly.get_actuated_jointdofs_order("position")
    world = FlatGroundWorld(half_size=80)
    world.add_fly(fly, [0, 0, spawn_z], Rotation3D("quat", [1, 0, 0, 0]))
    sim = flygym.Simulation(world)
    return fly, sim, top, dof_order


fly, sim, top, dof_order = build()
# adhesion actuators clamp ctrl to [1,100]; open the lower bound so swing feet release
adh_ids = [i for i in range(sim.mj_model.nu)
           if "adhesion" in (mj.mj_id2name(sim.mj_model, mj.mjtObj.mjOBJ_ACTUATOR, i) or "")]
sim.mj_model.actuator_ctrlrange[adh_ids, 0] = 0.0
aidx = sim._intern_adhesionactuatorids_by_fly["cpg"]
ti = fly.get_bodysegs_order().index(BodySegment("c_thorax"))

ctrl = TurningCPGController(timestep=sim.timestep, output_dof_order=dof_order)
ADH_ON = 1.0


def settle():
    sim.reset()
    ctrl.reset(seed=0)
    ctrl.set_descending_signal(np.array([0.8, 0.8]))
    sim.set_actuator_inputs("cpg", ActuatorType.POSITION,
                            ctrl.preprogrammed_steps.default_pose_by_dof_order(dof_order))
    sim.set_leg_adhesion_states("cpg", np.ones(6))
    sim.warmup(duration_s=0.1)


def drive(a):
    sim.set_actuator_inputs("cpg", ActuatorType.POSITION, a.joint_angles)
    sim.mj_data.ctrl[[aidx[k] for k in range(6)]] = np.where(a.adhesion_onoff, ADH_ON, 0.0)


def yaw_of():
    q = sim.get_body_rotations("cpg")[ti]          # (w,x,y,z)
    w, x, y, z = q
    return np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


# ---------------------------------------------- open-loop probe: calibrate turn gain
settle()
y0 = yaw_of()
PROBE = np.array([1.0, -0.6])                      # left fwd / right back asymmetry
for _ in range(int(0.6 / sim.timestep)):
    drive(ctrl.step(PROBE))
    sim.step()
dyaw = WRAP(yaw_of() - y0)
c_rate = dyaw / 0.6 / (PROBE[0] - PROBE[1])        # rad/s per unit asymmetry
print(f"probe: dyaw={np.degrees(dyaw):+.1f}deg  c_rate={c_rate:+.3f} rad/s per asym")

# ------------------------------------------------------------- closed-loop steering
settle()
rend = sim.set_renderer([top], camera_res=(300, 300), playback_speed=0.4, output_fps=25)

cx = RingAttractor()
rng = np.random.default_rng(0)
B = 0.0                                            # compass beacon at world +X
targets = [np.array([25.0, 0.0]), np.array([25.0, 22.0])]
goal_i = 0
BASE, KP, AMAX = 1.0, 2.2, 1.7
DROPOUT = (1.2, 2.2)                               # compass occluded -> idiothetic only

# CX + descending command run on a 10 ms control cycle: per-step yaw deltas
# (dt=1e-4 s) are pure physics jitter and would flood the attractor's
# angular-velocity input. CPG + physics keep stepping at full rate in between.
CYC = 100
cyc_dt = CYC * sim.timestep

rec = dict(t=[], x=[], y=[], yaw=[], psi=[], goal=[], dl=[], dr=[])
yaw_prev, t = yaw_of(), 0.0
desc = np.array([BASE, BASE])
arrived = False
rv_f = 0.0  # low-passed angular velocity: strips the 7.4 Hz stride yaw wobble
T_END = 6.5
for k in range(int(T_END / sim.timestep)):
    t = k * sim.timestep
    if k % CYC == 0:
        pos = sim.get_body_positions("cpg")[ti]
        yaw = yaw_of()
        rot_vel = WRAP(yaw - yaw_prev) / cyc_dt
        yaw_prev = yaw
        rv_f += (cyc_dt / 0.12) * (rot_vel - rv_f)
        beta = WRAP(B - yaw) + rng.normal(0, 0.10)  # eye: beacon rel. to body + noise
        cue = WRAP(B - beta)
        wc = 0.0 if DROPOUT[0] <= t < DROPOUT[1] else None
        psi = cx.step(cyc_dt, rv_f, cue, w_cue=wc)

        goal = targets[goal_i]
        if np.linalg.norm(goal - pos[:2]) < 8.0 and goal_i == 0:
            goal_i = 1
            goal = targets[1]
        goal_dir = np.arctan2(goal[1] - pos[1], goal[0] - pos[0])
        err = WRAP(goal_dir - psi)                 # internal estimate, not true yaw
        if goal_i == 1 and np.linalg.norm(goal - pos[:2]) < 4.0:
            arrived = True                         # halt at the goal, don't orbit
        if arrived:
            desc = np.zeros(2)
        else:
            asym = np.clip(KP * err / c_rate, -AMAX, AMAX)
            new = np.clip(np.array([BASE + asym / 2, BASE - asym / 2]), -1.5, 1.5)
            desc = 0.65 * desc + 0.35 * new        # smooth stride-frequency chatter
        rec["t"].append(t); rec["x"].append(pos[0]); rec["y"].append(pos[1])
        rec["yaw"].append(yaw); rec["psi"].append(psi); rec["goal"].append(goal_dir)
        rec["dl"].append(desc[0]); rec["dr"].append(desc[1])

    drive(ctrl.step(desc))
    sim.step()
    sim.render_as_needed()

pos = sim.get_body_positions("cpg")[ti]
rend.save_video(f"{OUT}/l3_steer_top.mp4")
fr = rend.frames[list(rend.frames.keys())[0]]
idx = np.linspace(0, len(fr) - 1, 9).astype(int)
sheet = np.concatenate([fr[j] for j in idx], axis=1)
imageio.imwrite("/Users/nick/.qoderworkcn/workspace/mtyl9411ieeo4j1y/sheet_steer.png", sheet)

# ------------------------------------------------------------------------ figure
rec = {k: np.array(v) for k, v in rec.items()}
# unwrap angles for plotting (avoid +-180 deg sawtooth), align to yaw's branch
rec["yaw"] = np.unwrap(rec["yaw"])
rec["psi"] = np.unwrap(rec["psi"]) + (rec["yaw"][0] - np.unwrap(rec["psi"])[0])
rec["goal"] = np.unwrap(rec["goal"]) + (rec["yaw"][0] - np.unwrap(rec["goal"])[0])
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.6))
ax1.plot(rec["x"], rec["y"], "-", color="#4f8ff7", lw=2, label="胸节轨迹")
ax1.plot(rec["x"][0], rec["y"][0], "o", color="#3fb950", ms=9, label="起点")
for i, tg in enumerate(targets):
    ax1.plot(tg[0], tg[1], "*", color="#f85149", ms=18, label=f"目标 T{i+1}")
    ax1.annotate(f"T{i+1}", tg + 2, color="#f85149", fontsize=12, weight="bold")
q = np.linspace(0, len(rec["x"]) - 1, 14).astype(int)
ax1.quiver(rec["x"][q], rec["y"][q], np.cos(rec["yaw"][q]), np.sin(rec["yaw"][q]),
           color="#8b949e", scale=28, width=0.004)
ax1.axvspan(0, 0, color="none")
ax1.set_aspect("equal"); ax1.grid(alpha=0.3)
ax1.set_xlabel("x (mm)"); ax1.set_ylabel("y (mm)")
ax1.set_title("具身闭环导航：CX 航向估计 → 下行信号 → CPG 转向")
ax1.legend(loc="upper left", fontsize=9)

ax2.plot(rec["t"], np.degrees(rec["yaw"]), color="#8b949e", lw=1.2, label="真实航向")
ax2.plot(rec["t"], np.degrees(rec["psi"]), color="#4f8ff7", lw=2, label="CX 内部估计 ψ")
ax2.plot(rec["t"], np.degrees(rec["goal"]), "--", color="#f85149", lw=1.4, label="目标航向")
ax2.axvspan(*DROPOUT, color="#f85149", alpha=0.12)
ax2.text(np.mean(DROPOUT), 100, "罗盘遮挡\n纯自运动积分", ha="center", fontsize=8,
         color="#f85149")
ax2.set_xlabel("时间 (s)"); ax2.set_ylabel("航向 (deg)")
ax2.set_title("环形吸引子航向融合（蓝=内部估计）")
ax2.legend(fontsize=9, loc="lower left")
axb = ax2.twinx()
axb.plot(rec["t"], rec["dl"], color="#3fb950", lw=0.9, alpha=0.8, label="下行 左")
axb.plot(rec["t"], rec["dr"], color="#d29922", lw=0.9, alpha=0.8, label="下行 右")
axb.set_ylabel("下行信号 [左, 右]", fontsize=9)
axb.legend(fontsize=8, loc="upper right")
fig.tight_layout()
fig.savefig(f"{OUT}/l3_traj.png", dpi=150)

d1 = np.linalg.norm(targets[0] - pos[:2])
e = WRAP(rec["psi"] - rec["yaw"])
on = ~((rec["t"] >= DROPOUT[0]) & (rec["t"] < DROPOUT[1]))
m = (rec["t"] >= DROPOUT[0]) & (rec["t"] < DROPOUT[1])
print(f"end pos=({pos[0]:.1f},{pos[1]:.1f}) dist_to_T2={np.linalg.norm(targets[1]-pos[:2]):.1f}mm")
print(f"psi-yaw RMSE (cue on) = {np.degrees(np.sqrt(np.mean(e[on]**2))):.1f} deg; "
      f"dropout drift = {np.degrees(e[m][-1] - e[m][0]):+.1f} deg; frames={len(fr)}")
