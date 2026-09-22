"""Persistent physics worker. GLFW lives exclusively on this process's main thread."""
import base64
import contextlib
import csv
from datetime import datetime
import io
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
import traceback
import uuid
import zipfile

os.environ.setdefault('MUJOCO_GL', 'glfw')

from .config import validate_config, validate_command

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / 'outputs' / 'l3-workbench'


def emit(kind, **data):
    sys.__stdout__.write(json.dumps(dict(type=kind, **data), allow_nan=False) + '\n')
    sys.__stdout__.flush()


class Experiment:
    def __init__(self, config):
        # Heavy imports stay in the worker, never in the HTTP process.
        import numpy as np
        import mujoco as mj
        import flygym
        from flygym.anatomy import BodySegment
        from flygym.compose import FlatGroundWorld, ActuatorType
        from flygym.compose.physics import ContactParams
        from flygym.utils.math import Rotation3D
        from nmf_ctrl import make_locomotion_fly, TurningCPGController, RingAttractor

        self.np, self.mj, self.actuator = np, mj, ActuatorType.POSITION
        self.config = validate_config(config)
        c = self.config
        self.status = 'initializing'
        self.message = '正在构建果蝇身体和地面'
        self.run_id = datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6]
        self.path = RUNS / self.run_id
        self.path.mkdir(parents=True)
        (self.path / 'frames').mkdir()
        self.renderer = None
        self.csv_file = None
        self.view = 'follow'
        self.frame_no = 0
        self.export_url = None
        self.events = []
        self.initial_config = validate_config(config)
        fly = make_locomotion_fly(name='cpg', add_adhesion=True,
                                  adhesion_gain=c['adhesion'], colorize=True)
        # The camera reference also preserves the thorax body during static fusion.
        # Without it FlyGym 2.0.1 resolves the fused thorax to -1 (the last leg body).
        top_camera = fly.add_tracking_camera(name='workbench_top', pos_offset=(0, 0, 11),
            rotation=Rotation3D('euler', (0., 0., 0.)), fovy=45.)
        dofs = fly.get_actuated_jointdofs_order('position')
        world = FlatGroundWorld(half_size=80)
        x, y, angle = c['spawn']
        world.add_fly(fly, [x, y, 0.5],
                      Rotation3D('quat', [np.cos(np.deg2rad(angle)/2), 0, 0,
                                          np.sin(np.deg2rad(angle)/2)]),
                      ground_contact_params=ContactParams(sliding_friction=c['friction']))
        self.sim = flygym.Simulation(world)
        thorax_name = fly.bodyseg_to_mjcfbody[BodySegment('c_thorax')].full_identifier
        self.body_id = mj.mj_name2id(self.sim.mj_model, mj.mjtObj.mjOBJ_BODY, thorax_name)
        self.top_camera_id = mj.mj_name2id(self.sim.mj_model, mj.mjtObj.mjOBJ_CAMERA,
                                           top_camera.full_identifier)
        if self.body_id < 0 or self.top_camera_id < 0:
            raise RuntimeError('编译模型缺少胸部或跟随相机，无法读取可靠的导航反馈')
        self.legs = list(fly.get_legs_order())
        ids = [i for i in range(self.sim.mj_model.nu)
               if 'adhesion' in (mj.mj_id2name(self.sim.mj_model, mj.mjtObj.mjOBJ_ACTUATOR, i) or '')]
        self.sim.mj_model.actuator_ctrlrange[ids, 0] = 0
        indices = self.sim._intern_adhesionactuatorids_by_fly['cpg']
        self.adh_ids = [indices[k] for k in range(6)]
        self.ctrl = TurningCPGController(timestep=self.sim.timestep, output_dof_order=dofs)

        def settle():
            self.sim.reset()
            self.ctrl.reset(seed=c['seed'])
            self.sim.set_actuator_inputs('cpg', self.actuator,
                self.ctrl.preprogrammed_steps.default_pose_by_dof_order(dofs))
            self.sim.set_leg_adhesion_states('cpg', np.ones(6))
            self.sim.warmup(duration_s=0.1)

        settle()
        emit('state', status='initializing', message='正在标定转向响应（0.6 秒仿真）', run_id=self.run_id)
        yaw0 = self.yaw()
        for _ in range(round(0.6 / self.sim.timestep)):
            self.drive(self.ctrl.step(np.array([1.0, -0.6])))
            self.sim.step()
        self.turn_rate = self.wrap(self.yaw() - yaw0) / 0.6 / 1.6
        if abs(self.turn_rate) < 0.02 or not np.isfinite(self.turn_rate):
            raise RuntimeError('转向标定响应过小。请使用默认摩擦与粘附参数重置场景。')
        settle()
        self.cx = RingAttractor()
        self.cx._shift(self.yaw())
        self.rng = np.random.default_rng(c['seed'])
        self.cycles = 0
        self.cycle_steps = round(0.01 / self.sim.timestep)
        self.dt = self.cycle_steps * self.sim.timestep
        self.t = 0.0
        self.active_wall = 0.0
        self.path_length = 0.0
        self.yaw_prev = self.yaw()
        self.rv = 0.0
        self.goal_i = 0
        self.arrived = False
        self.desc = np.zeros(2)
        self.adhesion = np.ones(6, dtype=bool)
        self.pos_prev = self.position().copy()
        self.speed = 0.0
        self.error_sq = 0.0
        self.samples = 0
        self.renderer = mj.Renderer(self.sim.mj_model, height=400, width=640)
        self.camera = mj.MjvCamera()
        self.camera.type = mj.mjtCamera.mjCAMERA_FREE
        self.csv_file = (self.path / 'telemetry.csv').open('w', newline='')
        self.writer = csv.DictWriter(self.csv_file, fieldnames=[
            't', 'x', 'y', 'z', 'yaw_deg', 'psi_deg', 'goal_deg', 'error_deg',
            'speed_mm_s', 'distance_mm', 'left', 'right', 'occluded', 'goal_index',
            'contacts', 'adhesion', 'phases', 'cx'])
        self.writer.writeheader()
        self.status, self.message = 'paused', '准备就绪，点击开始运行'
        self.log_event('created', c)
        self.publish(record=True)
        self.render(record=True)

    @staticmethod
    def wrap(a):
        import numpy as np
        return float((a + np.pi) % (2 * np.pi) - np.pi)

    def position(self):
        return self.sim.mj_data.xpos[self.body_id]

    def yaw(self):
        w, x, y, z = self.sim.mj_data.xquat[self.body_id]
        return float(self.np.arctan2(2 * (w*z + x*y), 1 - 2 * (y*y + z*z)))

    def drive(self, action):
        self.sim.set_actuator_inputs('cpg', self.actuator, action.joint_angles)
        self.sim.mj_data.ctrl[self.adh_ids] = self.np.where(action.adhesion_onoff, 1., 0.)
        self.adhesion = action.adhesion_onoff

    def log_event(self, op, data=None):
        event = dict(t=self.t, op=op, data=data, wall_time=datetime.now().isoformat())
        self.events.append(event)
        with (self.path / 'events.jsonl').open('a') as f:
            f.write(json.dumps(event) + '\n')
        self.save_config()

    def save_config(self):
        import importlib.metadata as metadata
        data = dict(initial_config=self.initial_config, current_config=self.config,
                    run_id=self.run_id, turn_rate=self.turn_rate, physics_dt=self.sim.timestep,
                    control_dt=self.dt, video_fps=25,
                    versions={p: metadata.version(p) for p in ('flygym', 'mujoco', 'numpy')},
                    note='罗盘由真实体姿加噪声生成；位置来自仿真真值。视频每 0.04 秒仿真采样。')
        (self.path / 'experiment.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))

    def tick(self):
        start = time.perf_counter()
        np, c = self.np, self.config
        pos = self.position()
        yaw = self.yaw()
        rv = self.wrap(yaw - self.yaw_prev) / self.dt
        self.yaw_prev = yaw
        self.rv += self.dt / 0.12 * (rv - self.rv)
        cue = self.wrap(yaw + self.rng.normal(0, c['noise']))
        psi = self.cx.step(self.dt, self.rv, cue, w_cue=0.0 if c['occluded'] else None)
        goal = np.array(c['targets'][self.goal_i])
        distance = np.linalg.norm(goal - pos[:2])
        if distance < 8 and self.goal_i < len(c['targets']) - 1:
            self.goal_i += 1
            goal = np.array(c['targets'][self.goal_i])
        self.arrived = bool(self.goal_i == len(c['targets']) - 1 and np.linalg.norm(goal - pos[:2]) < 4)
        if c['mode'] == 'manual':
            self.desc = np.array(c['manual'])
        elif self.arrived:
            self.desc = np.zeros(2)
        else:
            error = self.wrap(np.arctan2(goal[1]-pos[1], goal[0]-pos[0]) - psi)
            asym = np.clip(c['gain'] * error / self.turn_rate, -1.7, 1.7)
            desired = np.clip([c['base'] + asym/2, c['base'] - asym/2], -1.5, 1.5)
            self.desc = 0.65 * self.desc + 0.35 * desired
        for _ in range(self.cycle_steps):
            self.drive(self.ctrl.step(self.desc))
            self.sim.step()
        if not np.isfinite(self.sim.mj_data.qpos).all():
            raise RuntimeError('物理状态出现非有限数值，请重置并减小控制强度')
        self.cycles += 1
        self.t = round(self.cycles * self.dt, 8)
        pos = self.position().copy()
        distance = float(np.linalg.norm(pos[:2] - self.pos_prev[:2]))
        self.path_length += distance
        self.speed += 0.08 * (distance/self.dt - self.speed)
        self.pos_prev = pos
        self.error_sq += self.wrap(self.cx.psi() - self.yaw()) ** 2
        self.samples += 1
        if self.t >= c['duration'] - self.dt / 2:
            self.status, self.message = 'completed', '已达到实验时长，可导出结果或重置'
        self.active_wall += time.perf_counter() - start
        self.publish(record=True)
        if self.cycles % 4 == 0:
            render_start = time.perf_counter()
            self.render(record=True)
            self.active_wall += time.perf_counter() - render_start

    def publish(self, record=False):
        np = self.np
        pos, yaw, psi = self.position(), self.yaw(), self.cx.psi()
        goal = np.array(self.config['targets'][self.goal_i])
        goal_angle = np.arctan2(goal[1]-pos[1], goal[0]-pos[0])
        contacts = self.sim.get_ground_contact_info('cpg')[0].astype(bool).tolist()
        phases = (self.ctrl.cpg_network.curr_phases % (2*np.pi)).tolist()
        sample = dict(t=self.t, x=float(pos[0]), y=float(pos[1]), z=float(pos[2]),
            yaw_deg=float(np.degrees(yaw)), psi_deg=float(np.degrees(psi)),
            goal_deg=float(np.degrees(goal_angle)), error_deg=float(np.degrees(self.wrap(psi-yaw))),
            speed_mm_s=self.speed, distance_mm=float(np.linalg.norm(goal-pos[:2])),
            left=float(self.desc[0]), right=float(self.desc[1]), occluded=self.config['occluded'],
            goal_index=self.goal_i, contacts=contacts, adhesion=self.adhesion.tolist(),
            phases=phases, cx=self.cx.r.tolist())
        if record:
            row = {k: json.dumps(v) if isinstance(v, list) else v for k, v in sample.items()}
            self.writer.writerow(row)
            if self.cycles % 10 == 0:
                self.csv_file.flush()
        emit('state', status=self.status, message=self.message, run_id=self.run_id,
             config=self.config, sample=sample, view=self.view, arrived=self.arrived,
             legs=self.legs, path_length=self.path_length, active_wall=self.active_wall,
             speed_ratio=self.t / max(self.active_wall, 1e-6), turn_rate=self.turn_rate,
             rmse_deg=float(np.degrees(np.sqrt(self.error_sq/max(1, self.samples)))),
             export_url=self.export_url, frames=self.frame_no)

    def render(self, record=False):
        from PIL import Image
        pos = self.position()
        self.camera.lookat[:] = pos
        self.camera.distance = 11 if self.view == 'top' else 9
        self.camera.elevation = {'top': -90, 'side': -8, 'follow': -30}[self.view]
        self.camera.azimuth = 90 if self.view != 'follow' else 135
        self.renderer.update_scene(self.sim.mj_data,
                                   camera=self.top_camera_id if self.view == 'top' else self.camera)
        rgb = self.renderer.render()
        buf = io.BytesIO()
        Image.fromarray(rgb).save(buf, format='JPEG', quality=82)
        data = buf.getvalue()
        if record:
            (self.path / 'frames' / f'{self.frame_no:06d}.jpg').write_bytes(data)
            self.frame_no += 1
        emit('frame', data=base64.b64encode(data).decode(), run_id=self.run_id)

    def export(self):
        import imageio.v2 as imageio
        self.status, self.message = 'exporting', '正在整理数据并编码视频'
        self.publish()
        self.csv_file.flush()
        self.save_config()
        video = self.path / 'simulation.mp4'
        with imageio.get_writer(video, fps=25, codec='libx264', macro_block_size=16) as writer:
            for filename in sorted((self.path / 'frames').glob('*.jpg')):
                writer.append_data(imageio.imread(filename))
        archive = self.path / 'experiment.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for name in ('telemetry.csv', 'events.jsonl', 'experiment.json', 'simulation.mp4'):
                z.write(self.path / name, name)
        self.export_url = f'/api/download/{self.run_id}/experiment.zip'
        self.status = 'completed' if self.t >= self.config['duration'] - self.dt/2 else 'paused'
        self.message = '导出完成，包含视频、数据、参数及干预事件'
        self.publish()

    def close(self):
        if self.csv_file:
            self.csv_file.close()
        if self.renderer:
            self.renderer.close()


def run():
    commands = queue.Queue(maxsize=128)

    def receive():
        for line in sys.stdin:
            try:
                commands.put(json.loads(line))
            except ValueError:
                emit('error', message='无法解析操作')
        commands.put({'op': 'shutdown'})

    threading.Thread(target=receive, daemon=True).start()
    exp = None
    pending_steps = 0
    while True:
        try:
            command = commands.get(timeout=0 if exp and (exp.status == 'running' or pending_steps) else 0.1)
        except queue.Empty:
            command = None
        if command:
            command_id = command.pop('_id', None)
            op = command.get('op')
            if op == 'shutdown':
                break
            try:
                validate_command(command)
                expected_run_id = command.get('expected_run_id')
                if expected_run_id is not None and (exp is None or exp.run_id != expected_run_id):
                    raise ValueError('实验已改变，已拒绝过期操作')
                if op == 'reset':
                    if exp:
                        exp.close()
                    exp = None
                    pending_steps = 0
                    emit('state', status='initializing', message='正在重建场景', sample=None,
                         export_url=None, run_id=None)
                    exp = Experiment(command['config'])
                elif exp is None:
                    raise ValueError('请先重置场景')
                elif op == 'update':
                    exp.config = validate_config(command['config'], exp.config, live=True)
                    if 'targets' in command['config']:
                        exp.goal_i, exp.arrived = 0, False
                    exp.export_url = None
                    exp.log_event(op, command['config'])
                elif op == 'view':
                    exp.view = command['view']
                    exp.log_event(op, {'view': exp.view})
                    exp.render()
                elif op == 'pause':
                    pending_steps = 0
                    if exp.status != 'completed':
                        exp.status, exp.message = 'paused', '已暂停，物理状态保持不变'
                    exp.log_event(op)
                elif op in ('start', 'step'):
                    if exp.t >= exp.config['duration'] - exp.dt/2:
                        raise ValueError('本次实验已结束，请重置后再运行')
                    exp.export_url = None
                    exp.status, exp.message = 'running', '正在运行真实物理仿真'
                    pending_steps = round(0.1/exp.dt) if op == 'step' else 0
                    exp.log_event(op)
                elif op == 'export':
                    if exp.status == 'running':
                        raise ValueError('请先暂停再导出')
                    exp.log_event(op)
                    exp.export()
                if exp:
                    exp.publish()
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                if op == 'reset':
                    emit('state', status='error', message=str(error))
                elif exp and exp.status == 'exporting':
                    exp.status, exp.message = 'paused', '导出失败，可重试'
                    exp.publish()
                emit('error', message=str(error))
            emit('ack', command_id=command_id)
        if exp and exp.status == 'running':
            try:
                exp.tick()
                if pending_steps:
                    pending_steps -= 1
                    if pending_steps == 0 and exp.status != 'completed':
                        exp.status, exp.message = 'paused', '步进完成'
                        exp.render()
                        exp.publish()
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                exp.status, exp.message = 'error', str(error)
                emit('state', status='error', message=str(error))
    if exp:
        exp.close()


if __name__ == '__main__':
    # Libraries may print on import. Reserve stdout for the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        run()
