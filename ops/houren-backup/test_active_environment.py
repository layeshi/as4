import contextlib
import io
import pathlib
import subprocess
import tempfile
import unittest

from backup_active_environment import read_active_environment


class ActiveEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='synthetic-config-')
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.release = self.root / 'release-current'
        self.release.mkdir()
        self.current = self.root / 'current'
        self.current.symlink_to(self.release, target_is_directory=True)
        self.proc = self.root / 'proc'
        self.pid = self.proc / '123'
        self.pid.mkdir(parents=True)
        (self.pid / 'cwd').symlink_to(self.release, target_is_directory=True)
        self.env = {
            'DATA_DIR': '/synthetic/current-data', 'WORLD_ID': 'current-p6',
            'PREMISE': '6', 'PHYSICS': '2', 'HIDDEN_PHYSICS_FILE': '/synthetic/physics-v2.json',
            'FOUNDERS_FILE': '', 'SHELLS_FILE': '', 'PRIVATE_TEST_VALUE': 'private-token=with\nnewline',
        }
        (self.pid / 'environ').write_bytes(b''.join(k.encode() + b'=' + v.encode() + b'\0' for k, v in self.env.items()))
        self.calls = []

    def run_status(self, args, **kwargs):
        self.calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, 'MainPID=123\nActiveState=active\n', '')

    def read(self, run=None):
        return read_active_environment(proc_root=self.proc, current=self.current, run=run or self.run_status)

    def test_actual_running_configuration_and_private_values_are_preserved_without_output(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            env, code = self.read()
        self.assertEqual(env, self.env)
        self.assertEqual(code, self.release.resolve())
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(len(self.calls), 2, 'recheck service identity after reading proc')
        self.assertTrue(all(call[0][0] == 'systemctl' and 'houren.service' in call[0] for call in self.calls))
        self.assertNotIn(self.env['PRIVATE_TEST_VALUE'], repr(self.calls))

    def test_inactive_service_and_zero_or_invalid_pid_are_rejected(self):
        for status in ['ActiveState=inactive\nMainPID=123\n', 'ActiveState=active\nMainPID=0\n', 'ActiveState=active\nMainPID=bad\n']:
            with self.subTest(status=status):
                with self.assertRaisesRegex(RuntimeError, 'active|MainPID'):
                    self.read(lambda args, **kwargs: subprocess.CompletedProcess(args, 0, status, ''))

    def test_missing_proc_environment_is_rejected_without_fallback(self):
        (self.pid / 'environ').unlink()
        with self.assertRaisesRegex(RuntimeError, 'running service environment'):
            self.read()

    def test_cwd_must_point_to_the_current_release(self):
        old = self.root / 'old-release'; old.mkdir()
        (self.pid / 'cwd').unlink(); (self.pid / 'cwd').symlink_to(old, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'current release'):
            self.read()

    def test_main_pid_change_during_read_is_rejected(self):
        count = 0
        def run(args, **kwargs):
            nonlocal count
            count += 1
            return subprocess.CompletedProcess(args, 0, 'ActiveState=active\nMainPID=' + ('123' if count == 1 else '456') + '\n', '')
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.read(run)

    def test_current_release_change_during_read_is_rejected(self):
        count = 0
        def run(args, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                other = self.root / 'other-release'; other.mkdir()
                self.current.unlink(); self.current.symlink_to(other, target_is_directory=True)
            return self.run_status(args, **kwargs)
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            self.read(run)

    def test_missing_data_dir_and_malformed_environment_are_rejected_without_secret_diagnostics(self):
        for raw in [b'PRIVATE_TEST_VALUE=private-token\0', b'PRIVATE_TEST_VALUE=private-token\0broken-secret-entry\0']:
            (self.pid / 'environ').write_bytes(raw)
            with self.assertRaises(RuntimeError) as caught:
                self.read()
            self.assertNotIn('private-token', str(caught.exception))
            self.assertNotIn('broken-secret-entry', str(caught.exception))

    def test_systemctl_failure_does_not_echo_output_or_private_stderr(self):
        with self.assertRaises(RuntimeError) as caught:
            self.read(lambda args, **kwargs: subprocess.CompletedProcess(args, 1, 'private-stdout', 'private-stderr'))
        self.assertNotIn('private', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
