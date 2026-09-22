import json
import threading
import io
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from l3_workbench.server import Supervisor, WorkbenchServer


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.supervisor = Supervisor()
        cls.server = WorkbenchServer(('127.0.0.1', 0), cls.supervisor)
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.client = build_opener(ProxyHandler({}))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.supervisor.close()

    def request(self, path, data=None, headers=None):
        request = Request(self.base+path, data=data, headers=headers or {})
        try:
            with self.client.open(request, timeout=5) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def test_state_can_be_read_without_initializing_physics(self):
        status, data = self.request('/api/state')
        self.assertEqual(status, 200)
        result = json.loads(data)
        self.assertEqual(result['status'], 'idle')
        self.assertEqual(result['history'], [])
        self.assertIsNone(self.supervisor.process)

    def test_learning_resources_are_available(self):
        for path in ('/learning.html', '/learning.css', '/learning.js', '/learning-core.js'):
            with self.subTest(path=path):
                status, data = self.request(path)
                self.assertEqual(status, 200)
                self.assertGreater(len(data), 100)

    def test_pond_resources_are_available(self):
        for path in ('/pond.html', '/pond.css', '/pond.js', '/pond-water.js',
                     '/pond-behavior.js', '/pond-neuron.js', '/pond-odor.js',
                     '/pond-inspector.js',
                     '/vendor/three.module.js',
                     '/vendor/addons/controls/OrbitControls.js'):
            with self.subTest(path=path):
                status, data = self.request(path)
                self.assertEqual(status, 200)
                self.assertGreater(len(data), 100)

    def test_static_directory_traversal_blocked(self):
        for path in ('/vendor/../../../README.md', '/vendor/..%2f..%2fREADME.md',
                     '/../server.py', '/vendor/addons/../../../l3_workbench/worker.py'):
            with self.subTest(path=path):
                status, _ = self.request(path)
                self.assertEqual(status, 404)

    def test_learning_export_saves_and_downloads_exact_record(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        headers = {'Content-Type': 'application/json', 'X-Session-Token': self.supervisor.token}
        with tempfile.TemporaryDirectory() as directory, patch('l3_workbench.server.ROOT', Path(directory)):
            payload = json.dumps({'format': 'json', 'content': '{"rounds":600}'}).encode()
            status, data = self.request('/api/learning/export', payload, headers)
            self.assertEqual(status, 200)
            result = json.loads(data)
            status, downloaded = self.request(result['url'])
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(downloaded), {'rounds': 600})
            self.assertTrue((Path(directory) / result['path']).is_file())
            status, _ = self.request('/api/learning/export', payload)
            self.assertEqual(status, 403)
            for invalid in ({'format': '../evil', 'content': 'data'},
                            {'format': 'json', 'content': 'not-json'},
                            {'format': 'csv', 'content': ''}):
                status, _ = self.request('/api/learning/export', json.dumps(invalid).encode(), headers)
                self.assertEqual(status, 400)

    def test_rejects_cross_origin_and_missing_write_token(self):
        data = json.dumps({'op': 'reset', 'config': {}}).encode()
        for headers in ({'Content-Type': 'application/json'},
                        {'Content-Type': 'application/json',
                         'X-Session-Token': self.supervisor.token,
                         'Origin': 'https://untrusted.example'}):
            with self.subTest(headers=list(headers)):
                status, _ = self.request('/api/command', data, headers)
                self.assertEqual(status, 403)
        self.assertIsNone(self.supervisor.process)

    def test_rejects_unknown_host(self):
        status, _ = self.request('/api/state', headers={'Host': 'untrusted.example'})
        self.assertEqual(status, 403)

    def test_does_not_expose_source_or_arbitrary_paths(self):
        for path in ('/../README.md', '/README.md', '/.venv-l3/pyvenv.cfg',
                     '/api/download/../../README.md'):
            with self.subTest(path=path):
                status, _ = self.request(path)
                self.assertEqual(status, 404)

    def test_rejects_bad_config_before_starting_worker(self):
        status, _ = self.request('/api/command', b'{"op":"reset","config":{"duration":999}}',
            {'Content-Type': 'application/json', 'X-Session-Token': self.supervisor.token})
        self.assertEqual(status, 400)
        self.assertIsNone(self.supervisor.process)

    def test_rejects_control_before_initialization(self):
        with self.assertRaisesRegex(ValueError, '重置'):
            self.supervisor.submit({'op': 'start'})


class PendingOperationTests(unittest.TestCase):
    def test_inflight_state_cannot_release_reset_or_export_lock(self):
        from unittest.mock import Mock
        for op, old_status in [('reset', 'running'), ('export', 'paused')]:
            with self.subTest(op=op):
                supervisor = Supervisor()
                process = Mock()
                process.poll.return_value = None
                process.stdin = io.StringIO()
                supervisor.process = process
                supervisor.state.update(status=old_status, run_id='old-run')
                command = {'op': op, 'config': {'noise': .3}} if op == 'reset' else {'op': op}
                supervisor.submit(command)
                supervisor.consume({'type':'state','status':old_status,'run_id':'old-run'})
                self.assertTrue(supervisor.snapshot()['pending'])
                self.assertEqual(supervisor.snapshot()['status'], 'initializing' if op=='reset' else 'exporting')
                with self.assertRaises(ValueError):
                    supervisor.submit({'op':'reset','config':{}})

    def test_guarded_control_rejects_a_replaced_experiment(self):
        from unittest.mock import Mock
        supervisor = Supervisor()
        process = Mock()
        process.stdin = io.StringIO()
        supervisor.process = process
        supervisor.state.update(status='paused', run_id='20260917-100000-bbbbbb')
        with self.assertRaisesRegex(ValueError, '实验已改变'):
            supervisor.submit({'op': 'start', 'expected_run_id': '20260917-100000-aaaaaa'})
        self.assertEqual(process.stdin.getvalue(), '')
        supervisor.submit({'op': 'start', 'expected_run_id': '20260917-100000-bbbbbb'})
        self.assertIn('expected_run_id', process.stdin.getvalue())

    def test_only_matching_acknowledgement_unlocks_operation(self):
        from unittest.mock import Mock
        supervisor=Supervisor()
        process=Mock()
        process.poll.return_value=None
        process.stdin=io.StringIO()
        supervisor.process=process
        command_id=supervisor.submit({'op':'reset','config':{'noise':.3}})
        self.assertEqual(supervisor.snapshot()['config']['noise'],.3)
        supervisor.consume({'type':'ack','command_id':command_id-1})
        self.assertTrue(supervisor.snapshot()['pending'])
        supervisor.consume({'type':'state','status':'initializing','run_id':None})
        supervisor.consume({'type':'state','status':'paused','run_id':'new-run'})
        self.assertTrue(supervisor.snapshot()['pending'])
        supervisor.consume({'type':'ack','command_id':command_id})
        self.assertFalse(supervisor.snapshot()['pending'])
        self.assertEqual(supervisor.snapshot()['ack_id'],command_id)


if __name__ == '__main__':
    unittest.main()
