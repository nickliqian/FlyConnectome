"""L3a straight walking: NeuroMechFly v2 CPG on flat ground, side view video.

The reference locomotion stack (vendored in nmf_ctrl/): a 6-oscillator tripod
CPG drives preprogrammed single-leg step trajectories extracted from real
tethered-walking recordings; adhesion actuators gate foot grip per swing/stance
phase. Run:  MUJOCO_GL=glfw ./.venv-l3/bin/python scripts/l3_walk.py
Output:     l3_walk_side.mp4
"""
import os
import sys
from pathlib import Path
os.environ.setdefault("MUJOCO_GL", "glfw")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import mujoco as mj
import flygym
from flygym.anatomy import BodySegment
from flygym.compose import FlatGroundWorld, ActuatorType
from flygym.utils.math import Rotation3D
from nmf_ctrl import make_locomotion_fly, TurningCPGController

OUT = Path(__file__).resolve().parent.parent

fly = make_locomotion_fly(name="cpg", add_adhesion=True, colorize=True)
cam = fly.add_tracking_camera(name="body_cam", pos_offset=(-0.5, -7.5, 0.0),
                              rotation=Rotation3D("euler", (1.57, 0.0, 0.0)),
                              fovy=30.0)
dof_order = fly.get_actuated_jointdofs_order("position")
world = FlatGroundWorld(half_size=80)
world.add_fly(fly, [0, 0, 0.5], Rotation3D("quat", [1, 0, 0, 0]))
sim = flygym.Simulation(world)

# Adhesion actuators are declared ctrllimited with ctrlrange=[1,100]: a boolean
# "off" (0) gets clamped to 1 and the feet stay glued forever. Open the lower
# bound so swing-phase feet truly release.
adh_ids = [i for i in range(sim.mj_model.nu)
           if "adhesion" in (mj.mj_id2name(sim.mj_model, mj.mjtObj.mjOBJ_ACTUATOR, i) or "")]
sim.mj_model.actuator_ctrlrange[adh_ids, 0] = 0.0
aidx = sim._intern_adhesionactuatorids_by_fly["cpg"]

sim.reset()
rend = sim.set_renderer([cam], camera_res=(240, 320), playback_speed=0.2,
                        output_fps=25)
ctrl = TurningCPGController(timestep=sim.timestep, output_dof_order=dof_order)
sim.set_actuator_inputs("cpg", ActuatorType.POSITION,
                        ctrl.preprogrammed_steps.default_pose_by_dof_order(dof_order))
sim.set_leg_adhesion_states("cpg", np.ones(6))
sim.warmup(duration_s=0.1)

ti = fly.get_bodysegs_order().index(BodySegment("c_thorax"))
p0 = sim.get_body_positions("cpg")[ti, :2].copy()
for _ in range(int(2.0 / sim.timestep)):
    a = ctrl.step(np.array([1.0, 1.0]))          # symmetric descending = straight
    sim.set_actuator_inputs("cpg", ActuatorType.POSITION, a.joint_angles)
    sim.mj_data.ctrl[[aidx[k] for k in range(6)]] = np.where(a.adhesion_onoff, 1.0, 0.0)
    sim.step()
    sim.render_as_needed()

p = sim.get_body_positions("cpg")[ti]
rend.save_video(OUT / "l3_walk_side.mp4")
print(f"walked {np.linalg.norm(p[:2] - p0):.1f} mm in 2 s, thorax z={p[2]:.2f} mm")
