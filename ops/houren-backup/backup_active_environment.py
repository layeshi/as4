"""Read the running service configuration while the caller holds its deploy lock.

No environment value is logged. There is deliberately no env-file fallback.
"""
import pathlib
import subprocess


def read_active_environment(*, proc_root='/proc', current='/opt/houren/current',
                            service='houren.service', run=subprocess.run):
    proc_root, current = pathlib.Path(proc_root), pathlib.Path(current)

    def active_pid():
        try:
            result = run(['systemctl', 'show', service, '--property=ActiveState', '--property=MainPID'],
                         capture_output=True, text=True, timeout=15, check=False)
        except Exception:
            raise RuntimeError('Cannot read active service status') from None
        if result.returncode != 0:
            raise RuntimeError('Cannot read active service status')
        fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        if fields.get('ActiveState') != 'active':
            raise RuntimeError('Backup requires an active houren service')
        raw = fields.get('MainPID', '')
        if not raw.isascii() or not raw.isdecimal() or int(raw) <= 0:
            raise RuntimeError('Backup requires a positive MainPID')
        return int(raw)

    pid = active_pid()
    try:
        code = current.resolve(strict=True)
        cwd = (proc_root / str(pid) / 'cwd').resolve(strict=True)
    except OSError:
        raise RuntimeError('Cannot verify running service current release') from None
    if not code.is_dir() or cwd != code:
        raise RuntimeError('Running service cwd does not match current release')
    try:
        raw = (proc_root / str(pid) / 'environ').read_bytes()
    except OSError:
        raise RuntimeError('Cannot read running service environment') from None
    env = {}
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        if b'=' not in entry:
            raise RuntimeError('Malformed running service environment')
        key, value = entry.split(b'=', 1)
        key = key.decode('utf-8', errors='surrogateescape')
        if not key or key in env:
            raise RuntimeError('Malformed running service environment')
        env[key] = value.decode('utf-8', errors='surrogateescape')
    if not env.get('DATA_DIR') or not env.get('WORLD_ID'):
        raise RuntimeError('Running service environment lacks DATA_DIR or WORLD_ID')
    if active_pid() != pid:
        raise RuntimeError('Running service changed while reading configuration')
    try:
        if current.resolve(strict=True) != code or (proc_root / str(pid) / 'cwd').resolve(strict=True) != code:
            raise RuntimeError('Current release changed while reading configuration')
    except OSError:
        raise RuntimeError('Current release changed while reading configuration') from None
    return env, code
