"""Dependency-free configuration validation shared by server and worker."""
from copy import deepcopy
import math
import re

DEFAULTS = dict(targets=[[25.0, 0.0], [25.0, 22.0]], spawn=[0.0, 0.0, 0.0],
                friction=1.0, adhesion=40.0, seed=0, duration=10.0,
                mode='auto', manual=[0.0, 0.0], base=1.0, gain=2.2,
                noise=0.10, occluded=False)
LIVE_FIELDS = {'targets', 'mode', 'manual', 'base', 'gain', 'noise', 'occluded'}


def number(value, low, high, name):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not low <= value <= high):
        raise ValueError(f'{name} 必须为 {low} 到 {high} 之间的有限数值')
    return float(value)


def vector(value, bounds, name):
    if not isinstance(value, list) or len(value) != len(bounds):
        raise ValueError(f'{name} 需要 {len(bounds)} 个数值')
    return [number(v, lo, hi, name) for v, (lo, hi) in zip(value, bounds)]


def validate_config(data, base=None, live=False):
    if not isinstance(data, dict):
        raise ValueError('配置必须是 JSON 对象')
    allowed = LIVE_FIELDS if live else DEFAULTS.keys()
    if data.keys() - allowed:
        raise ValueError('未知参数或需要重置的参数：' + ', '.join(sorted(data.keys() - allowed)))
    out = deepcopy(DEFAULTS if base is None else base)
    out.update(deepcopy(data))
    targets = out['targets']
    if not isinstance(targets, list) or not 1 <= len(targets) <= 8:
        raise ValueError('目标点数量必须为 1 到 8')
    out['targets'] = [vector(t, [(-70, 70), (-70, 70)], '目标坐标') for t in targets]
    out['spawn'] = vector(out['spawn'], [(-60, 60), (-60, 60), (-180, 180)], '出生位置／朝向')
    out['manual'] = vector(out['manual'], [(-1.5, 1.5)] * 2, '手动信号')
    for key, low, high in [('friction', 0.1, 3), ('adhesion', 0, 80),
                           ('duration', 0.1, 60), ('base', 0, 1.5),
                           ('gain', 0, 5), ('noise', 0, 1)]:
        out[key] = number(out[key], low, high, key)
    seed = number(out['seed'], 0, 2147483647, '随机种子')
    if seed != int(seed):
        raise ValueError('随机种子必须为整数')
    out['seed'] = int(seed)
    if out['mode'] not in ('auto', 'manual'):
        raise ValueError('控制模式必须是 auto 或 manual')
    if not isinstance(out['occluded'], bool):
        raise ValueError('罗盘遮挡必须为布尔值')
    return out


def validate_command(data):
    if not isinstance(data, dict):
        raise ValueError('指令必须是 JSON 对象')
    data = deepcopy(data)
    expected_run_id = data.pop('expected_run_id', None)
    if expected_run_id is not None and (not isinstance(expected_run_id, str)
            or not re.fullmatch(r'\d{8}-\d{6}-[a-f0-9]{6}', expected_run_id)):
        raise ValueError('实验编号格式无效')
    op = data.get('op')
    fields = {'start': set(), 'pause': set(), 'step': set(), 'export': set(),
              'reset': {'config'}, 'update': {'config'}, 'view': {'view'}}
    if not isinstance(op, str) or op not in fields:
        raise ValueError('未知操作')
    if data.keys() != fields[op] | {'op'}:
        raise ValueError('操作参数不完整或包含未知字段')
    if op == 'reset':
        validate_config(data['config'])
    if op == 'update':
        validate_config(data['config'], live=True)
    if op == 'view' and data['view'] not in ('top', 'side', 'follow'):
        raise ValueError('未知视角')
    if expected_run_id is not None:
        if op not in ('start', 'pause', 'step', 'view', 'update', 'export'):
            raise ValueError('此操作不支持实验编号校验')
        data['expected_run_id'] = expected_run_id
    return data
