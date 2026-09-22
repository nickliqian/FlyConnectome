"""Opt-in real MuJoCo smoke test: L3_INTEGRATION=1 python -m unittest discover -s tests."""
import csv
import io
import json
import math
import os
from pathlib import Path
import time
import unittest
import zipfile

from l3_workbench.server import Supervisor, ROOT


@unittest.skipUnless(os.environ.get('L3_INTEGRATION') == '1', '需要真实物理与 GLFW 渲染')
class PhysicsIntegrationTests(unittest.TestCase):
    def test_pause_live_intervention_export_and_reproducible_reset(self):
        supervisor = Supervisor()
        self.addCleanup(supervisor.close)

        def wait(predicate, timeout=150):
            until = time.monotonic()+timeout
            while time.monotonic()<until:
                state = supervisor.snapshot()
                if state['status'] == 'error':
                    self.fail(state['message'])
                if state['error']:
                    self.fail(state['error'])
                if predicate(state):
                    return state
                time.sleep(.1)
            self.fail(f'Timed out: {supervisor.snapshot()["status"]}')

        config = {'duration': .6, 'seed': 7}
        supervisor.submit({'op':'reset','config':config})
        initial = wait(lambda s:s['status']=='paused' and s['frame_version']>0)
        print('真实仿真初始化与渲染完成', flush=True)
        self.assertTrue(math.isfinite(initial['turn_rate']))
        # A missing tracked body must never silently read MuJoCo body index -1 (a leg).
        self.assertGreater(initial['sample']['z'], .5)
        self.assertLess(abs(initial['sample']['yaw_deg']), 1)
        initial_position = [initial['sample'][k] for k in ('x','y','yaw_deg')]
        supervisor.submit({'op':'step','expected_run_id':initial['run_id']})
        stepped = wait(lambda s:s['status']=='paused' and s['sample']['t']>=.1)
        self.assertAlmostEqual(stepped['sample']['t'], .1)
        time.sleep(.3)
        self.assertEqual(supervisor.snapshot()['sample']['t'], .1)
        supervisor.submit({'op':'update','config':{'occluded':True,'mode':'manual','manual':[.8,-.4],'targets':[[20,15]]}})
        wait(lambda s:s['config']['occluded'])
        supervisor.submit({'op':'step'})
        changed = wait(lambda s:s['status']=='paused' and s['sample']['t']>=.2)
        self.assertAlmostEqual(changed['sample']['left'], .8)
        self.assertAlmostEqual(changed['sample']['right'], -.4)
        self.assertTrue(changed['sample']['occluded'])
        self.assertEqual(len(changed['sample']['contacts']),6)
        self.assertEqual(len(changed['sample']['cx']),16)
        self.assertGreater(changed['path_length'],0)
        supervisor.submit({'op':'view','view':'top'})
        wait(lambda s:s['view']=='top')
        supervisor.submit({'op':'start'})
        wait(lambda s:s['status']=='running' and s['sample']['t']>=.3)
        supervisor.submit({'op':'pause'})
        paused=wait(lambda s:s['status']=='paused')
        stopped_time=paused['sample']['t']
        time.sleep(.3)
        self.assertEqual(supervisor.snapshot()['sample']['t'],stopped_time)
        supervisor.submit({'op':'start'})
        done = wait(lambda s:s['status']=='completed')
        self.assertAlmostEqual(done['sample']['t'],.6)
        supervisor.submit({'op':'export'})
        exported=wait(lambda s:bool(s.get('export_url')))
        archive=ROOT/'outputs/l3-workbench'/exported['run_id']/'experiment.zip'
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(set(z.namelist()),{'telemetry.csv','events.jsonl','experiment.json','simulation.mp4'})
            records=list(csv.DictReader(io.StringIO(z.read('telemetry.csv').decode())))
            self.assertEqual(len(records),61)
            self.assertAlmostEqual(float(records[-1]['t']),.6)
            self.assertGreater(len(z.read('simulation.mp4')),5000)
            metadata=json.loads(z.read('experiment.json'))
            self.assertEqual(metadata['initial_config']['seed'],7)
            self.assertTrue(metadata['current_config']['occluded'])
            events=[json.loads(line) for line in z.read('events.jsonl').splitlines()]
            update=next(e for e in events if e['op']=='update')
            self.assertAlmostEqual(update['t'],.1)
        print('步进、暂停、即时干预、结束与视频导出通过',flush=True)
        supervisor.submit({'op':'reset','config':config})
        again=wait(lambda s:s['status']=='paused' and s['run_id']!=initial['run_id'])
        for key,value in zip(('x','y','yaw_deg'),initial_position):
            self.assertAlmostEqual(again['sample'][key],value,places=6)
        self.assertAlmostEqual(again['sample']['t'],0)
        print('相同随机种子重置可复现',flush=True)


if __name__ == '__main__':
    unittest.main()
