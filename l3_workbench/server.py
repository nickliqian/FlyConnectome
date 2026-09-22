"""Loopback HTTP service and physics-worker supervision (standard library only)."""
import argparse
import base64
from collections import deque
import json
import mimetypes
from pathlib import Path, PurePath
import re
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from .config import validate_command, validate_config
from .learning_exports import save_export

ROOT = Path(__file__).resolve().parent.parent
STATIC = (Path(__file__).parent / 'static').resolve()
# 静态服务允许的扩展名（涵盖工作台、学习模块与池塘 3D 场景所需文件）
STATIC_EXTENSIONS = {'.html', '.css', '.js', '.json', '.ico', '.png', '.svg', '.woff2'}


class Supervisor:
    def __init__(self, worker_python=None):
        self.python = Path(worker_python) if worker_python else ROOT / '.venv-l3/bin/python'
        self.lock = threading.RLock()
        self.process = None
        self.token = secrets.token_urlsafe(32)
        self.state = dict(status='idle', message='点击重置场景，初始化仿真',
                          config=validate_config({}), sample=None, run_id=None)
        self.rows = deque(maxlen=6001)
        self.frame = None
        self.frame_version = 0
        self.error_id = 0
        self.error = None
        self.log = None
        self.reader = None
        self.pending = False
        self.command_id = 0
        self.ack_id = 0
        self.pending_id = None
        self.pending_kind = None
        self.pending_started = False

    def snapshot(self, after=-1):
        with self.lock:
            result = dict(self.state)
            result.update(app='flyconnectome-l3', token=self.token, frame_version=self.frame_version,
                          error=self.error, error_id=self.error_id, pending=self.pending,
                          ack_id=self.ack_id,
                          history=[r for r in self.rows if r['t'] > after])
            return result

    def launch(self):
        if self.process and self.process.poll() is None:
            return
        if self.process:
            if self.reader:
                self.reader.join(timeout=3)
            self.process.stdin.close()
            self.process.stdout.close()
        if not self.python.is_file():
            raise ValueError('找不到 L3 Python 环境，请按 README 安装或指定 --worker-python')
        log_dir = ROOT / 'outputs' / 'l3-workbench'
        log_dir.mkdir(parents=True, exist_ok=True)
        if self.log:
            self.log.close()
        self.log = (log_dir / 'worker.log').open('a')
        self.process = subprocess.Popen([str(self.python), '-u', '-m', 'l3_workbench.worker'],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
            text=True, bufsize=1)
        self.reader = threading.Thread(target=self.read, args=(self.process,), daemon=True)
        self.reader.start()

    def read(self, process):
        for line in process.stdout:
            try:
                self.consume(json.loads(line))
            except (ValueError, KeyError) as error:
                with self.lock:
                    self.error, self.error_id = f'仿真通信异常：{error}', self.error_id + 1
        return_code = process.wait()
        with self.lock:
            if self.process is process:
                self.state.update(status='error', message=f'仿真进程已退出（{return_code}），请重置场景')
                self.pending = False

    def consume(self, item):
        """Apply one worker message, respecting operation boundaries and acknowledgements."""
        with self.lock:
            item = dict(item)
            kind = item.pop('type')
            if kind == 'ack':
                command_id = item.get('command_id')
                if isinstance(command_id, int):
                    self.ack_id = max(self.ack_id, command_id)
                    if command_id == self.pending_id:
                        self.pending = False
                        self.pending_id = None
                return
            if self.pending and not self.pending_started and kind in ('state', 'frame'):
                marker = 'initializing' if self.pending_kind == 'reset' else 'exporting'
                if kind == 'state' and item.get('status') == marker:
                    self.pending_started = True
                else:
                    return  # Ignore telemetry emitted before the pending operation began.
            if kind == 'state':
                old_run = self.state.get('run_id')
                if 'run_id' in item and item['run_id'] != old_run:
                    self.rows.clear()
                    self.frame = None
                self.state.update(item)
                sample = item.get('sample')
                if sample and (not self.rows or sample['t'] > self.rows[-1]['t']):
                    self.rows.append(sample)
            elif kind == 'frame':
                self.frame = base64.b64decode(item['data'])
                self.frame_version += 1
            elif kind == 'error':
                self.error, self.error_id = item['message'], self.error_id + 1

    def submit(self, command):
        command = validate_command(command)
        with self.lock:
            op = command['op']
            status = self.state['status']
            if ('expected_run_id' in command
                    and command['expected_run_id'] != self.state.get('run_id')):
                raise ValueError('实验已改变，已拒绝过期操作，请新建演示')
            if self.pending or status in ('initializing', 'exporting'):
                raise ValueError('正在初始化或导出，请等待完成')
            if op != 'reset' and status not in ('paused', 'running', 'completed'):
                raise ValueError('请先重置场景')
            if op == 'export' and status == 'running':
                raise ValueError('请先暂停再导出')
            if op == 'step' and status == 'running':
                raise ValueError('请先暂停再步进')
            if op == 'reset':
                self.launch()
                self.error = None
                self.state.update(status='initializing', message='正在初始化真实物理仿真',
                                  sample=None, run_id=None, export_url=None,
                                  config=validate_config(command['config']))
                self.rows.clear()
                self.frame = None
                self.pending = True
            elif op == 'export':
                self.state.update(status='exporting', message='正在整理实验结果')
                self.pending = True
            self.command_id += 1
            command_id = self.command_id
            if op in ('reset', 'export'):
                self.pending_id = command_id
                self.pending_kind = op
                self.pending_started = False
            try:
                self.process.stdin.write(json.dumps(dict(command, _id=command_id)) + '\n')
                self.process.stdin.flush()
            except (BrokenPipeError, OSError, AttributeError) as error:
                self.pending = False
                self.state.update(status='error', message='仿真进程连接断开，请重置')
                raise ValueError('仿真连接断开，请重置') from error
            return command_id

    def close(self):
        process = self.process
        if process and process.poll() is None:
            process.stdin.close()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        if self.log:
            self.log.close()
        if process:
            if self.reader:
                self.reader.join(timeout=3)
            process.stdin.close()
            process.stdout.close()


class WorkbenchServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, supervisor):
        self.supervisor = supervisor
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def valid_host(self):
        port = self.server.server_port
        return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}')

    def send_bytes(self, data, content_type, status=200, download=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        if download:
            self.send_header('Content-Disposition', f'attachment; filename="{download}"')
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def json_response(self, data, status=200):
        self.send_bytes(json.dumps(data, ensure_ascii=False, allow_nan=False).encode(),
                        'application/json; charset=utf-8', status)

    def is_static_request(self, path):
        if path == '/':
            return True
        if not path.startswith('/') or '..' in path:
            return False
        if path.startswith('/api/'):
            return False
        return PurePath(path).suffix.lower() in STATIC_EXTENSIONS

    def serve_static(self, path):
        rel = 'index.html' if path == '/' else path.lstrip('/')
        target = (STATIC / rel).resolve()
        # 路径穿越防护：解析后必须仍位于 STATIC 目录内
        try:
            target.relative_to(STATIC)
        except ValueError:
            self.json_response({'error': '页面不存在'}, 404)
            return
        if not target.is_file():
            self.json_response({'error': '页面文件不存在'}, 404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self.send_bytes(target.read_bytes(), content_type + '; charset=utf-8')

    def do_GET(self):
        if not self.valid_host():
            self.json_response({'error': '仅允许本机访问'}, 403)
            return
        url = urlparse(self.path)
        supervisor = self.server.supervisor
        if url.path == '/api/state':
            try:
                after = float(parse_qs(url.query).get('after', ['-1'])[0])
            except ValueError:
                after = -1
            self.json_response(supervisor.snapshot(after))
        elif url.path == '/api/frame':
            with supervisor.lock:
                frame = supervisor.frame
            if frame:
                self.send_bytes(frame, 'image/jpeg')
            else:
                self.json_response({'error': '仿真画面尚未生成'}, 404)
        elif self.is_static_request(url.path):
            self.serve_static(url.path)
        elif re.fullmatch(r'/api/learning/download/[a-f0-9]{32}/(records.json|training.csv)', url.path):
            export_id, filename = url.path.split('/')[-2:]
            path = ROOT / 'outputs/l3-learning' / export_id / filename
            if path.is_file():
                self.send_bytes(path.read_bytes(), 'application/octet-stream',
                                download=f'fly-learning-{export_id[:8]}-{filename}')
            else:
                self.json_response({'error': '导出文件不存在'}, 404)
        elif re.fullmatch(r'/api/download/\d{8}-\d{6}-[a-f0-9]{6}/experiment.zip', url.path):
            path = ROOT / 'outputs/l3-workbench' / url.path.split('/')[3] / 'experiment.zip'
            if path.is_file():
                self.send_bytes(path.read_bytes(), 'application/zip', download=f'l3-{path.parent.name}.zip')
            else:
                self.json_response({'error': '结果不存在，请先导出'}, 404)
        else:
            self.json_response({'error': '页面不存在'}, 404)

    def do_POST(self):
        supervisor = self.server.supervisor
        origin = self.headers.get('Origin')
        valid_origins = {f'http://127.0.0.1:{self.server.server_port}',
                         f'http://localhost:{self.server.server_port}'}
        if (not self.valid_host() or (origin is not None and origin not in valid_origins)
                or not secrets.compare_digest(self.headers.get('X-Session-Token', ''), supervisor.token)):
            self.json_response({'error': '操作来源无效，请刷新本地页面'}, 403)
            return
        if self.path not in ('/api/command', '/api/learning/export'):
            self.json_response({'error': '接口不存在'}, 404)
            return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.json_response({'error': '需要 JSON 格式'}, 415)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            limit = 8 * 1024 * 1024 if self.path == '/api/learning/export' else 16384
            if not 0 < length <= limit:
                raise ValueError('操作内容为空或过大')
            command = json.loads(self.rfile.read(length))
            if self.path == '/api/learning/export':
                self.json_response(save_export(command, ROOT))
                return
            command_id = supervisor.submit(command)
            self.json_response({'accepted': True, 'command_id': command_id})
        except (ValueError, UnicodeError, OSError) as error:
            self.json_response({'error': str(error)}, 400)


def main():
    parser = argparse.ArgumentParser(description='L3 本地仿真工作台')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--worker-python', help='已安装 FlyGym 的 Python 路径')
    parser.add_argument('--open', action='store_true', help='启动后打开浏览器')
    parser.add_argument('--no-initialize', action='store_true', help='等待页面操作后再初始化')
    args = parser.parse_args()
    supervisor = Supervisor(args.worker_python)
    try:
        server = WorkbenchServer(('127.0.0.1', args.port), supervisor)
    except OSError as error:
        if args.open:
            from urllib.request import build_opener, ProxyHandler
            import webbrowser
            try:
                with build_opener(ProxyHandler({})).open(f'http://127.0.0.1:{args.port}/api/state', timeout=2) as response:
                    existing = json.load(response)
                if existing.get('app') == 'flyconnectome-l3':
                    webbrowser.open(f'http://127.0.0.1:{args.port}')
                    return
            except (OSError, ValueError):
                pass
        parser.exit(1, f'无法启动本地服务：{error}。可用 --port 指定其他端口。\n')
    if not args.no_initialize:
        supervisor.submit({'op': 'reset', 'config': {}})
    print(f'仿真工作台：http://127.0.0.1:{server.server_port}  按 Ctrl+C 关闭', flush=True)
    if args.open:
        import webbrowser
        threading.Timer(.5, lambda: webbrowser.open(f'http://127.0.0.1:{server.server_port}')).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        supervisor.close()


if __name__ == '__main__':
    main()
