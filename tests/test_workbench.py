import importlib.util
import math
import unittest


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('l3_workbench'), 'Workbench package must exist')
        from l3_workbench.config import validate_config, validate_command
        self.config = validate_config
        self.command = validate_command

    def test_rejects_nonfinite_or_outside_world_targets(self):
        for value in (math.nan, math.inf, 71, -71, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.config({'targets': [[value, 0]]})

    def test_requires_nonempty_bounded_targets(self):
        for targets in ([], [[0]], [[0, 0]] * 9, 'invalid'):
            with self.subTest(targets=targets), self.assertRaises(ValueError):
                self.config({'targets': targets})

    def test_live_updates_do_not_change_scene_or_mutate_base(self):
        base = self.config({})
        changed = self.config({'noise': 0.2, 'targets': [[12, 8]]}, base, live=True)
        self.assertEqual(changed['targets'], [[12.0, 8.0]])
        self.assertEqual(base['targets'], [[25.0, 0.0], [25.0, 22.0]])
        with self.assertRaises(ValueError):
            self.config({'friction': 0.4}, base, live=True)

    def test_rejects_bad_settings(self):
        for data in ({'unknown': 1}, {'seed': 1.5}, {'duration': 61},
                     {'manual': [2, 0]}, {'mode': 'fly'}, {'occluded': 'false'},
                     {'spawn': [0, 0, math.nan]}):
            with self.subTest(data=data), self.assertRaises(ValueError):
                self.config(data)

    def test_command_contract_rejects_unknown_operations(self):
        for value in ({'op': 'delete'}, {'op': 'view', 'view': 'unknown'}, [],
                      {'op': 'start', 'unexpected': 4}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.command(value)
        self.assertEqual(self.command({'op': 'pause'}), {'op': 'pause'})


if __name__ == '__main__':
    unittest.main()
