"""Bounded, loopback-only learning record export; paths are server-generated."""
import json
from uuid import uuid4


def save_export(data, root):
    if not isinstance(data, dict) or set(data) != {'format', 'content'}:
        raise ValueError('导出内容格式无效')
    file_format, content = data['format'], data['content']
    if file_format not in ('json', 'csv') or not isinstance(content, str) or not content:
        raise ValueError('需要有效的 JSON 或 CSV 记录')
    if file_format == 'json':
        json.loads(content)
    export_id = uuid4().hex
    filename = 'records.json' if file_format == 'json' else 'training.csv'
    relative = f'outputs/l3-learning/{export_id}/{filename}'
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=False)
    path.write_text(content, encoding='utf-8')
    return {'url': f'/api/learning/download/{export_id}/{filename}', 'path': relative}
