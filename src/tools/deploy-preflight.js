// Read-only deployment gate. Do not import Runtime: opening a world repairs logs.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** POSIX DAC against the service identity, irrespective of the caller's UID. */
export function posixAccess(stat, identity, mask) {
  const shift = stat.uid === identity.uid ? 6 : identity.groups.includes(stat.gid) ? 3 : 0;
  return (((stat.mode >> shift) & 7) & mask) === mask;
}
const integer = n => Number.isSafeInteger(n) && n >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function deployPreflight({ releaseDir, dataDir, worldId, configFiles = [], serviceUid, serviceGid, serviceGroups = [], expectedVersion, expectedHash, contentManifest, manifestFile } = {}) {
  const checks = [];
  const fail = (target, code) => checks.push({ target, code });
  if (!integer(serviceUid) || !integer(serviceGid) || !Array.isArray(serviceGroups) || !serviceGroups.every(integer) || !releaseDir || !dataDir || typeof worldId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(worldId) || !Array.isArray(configFiles) || !configFiles.every(f => typeof f === 'string')) {
    return { ok: false, checks: [{ target: 'options', code: 'invalid_options' }] };
  }
  const identity = { uid: serviceUid, groups: [...new Set([serviceGid, ...serviceGroups])] };
  const world = join(resolve(dataDir), worldId);
  const traversed = new Set();
  function parents(path, target) {
    let dir = dirname(resolve(path));
    while (true) {
      if (!traversed.has(dir)) {
        traversed.add(dir);
        try {
          const s = statSync(dir);
          if (!s.isDirectory() || !posixAccess(s, identity, 1)) fail(target, 'untraversable');
        } catch { fail(target, 'missing_parent'); }
      }
      if (dir === parse(dir).root) break;
      dir = dirname(dir);
    }
  }
  function readable(path, target, { required = true, writable = false, privateMode = false, owned = false } = {}) {
    parents(path, target);
    if (!existsSync(path)) { if (required) fail(target, 'missing'); return false; }
    try {
      parents(realpathSync(path), target);
      const s = statSync(path);
      if (!s.isFile()) { fail(target, 'not_file'); return false; }
      if (!posixAccess(s, identity, 4)) fail(target, 'unreadable');
      if (writable && !posixAccess(s, identity, 2)) fail(target, 'unwritable');
      if (owned && s.uid !== serviceUid) fail(target, 'wrong_owner');
      if ((s.mode & 0o002) || (privateMode && (s.mode & 0o077))) fail(target, 'unsafe_mode');
      return true;
    } catch { fail(target, 'unreadable'); return false; }
  }
  try {
    parents(join(world, 'snapshot.json'), 'world');
    const s = statSync(world);
    if (!s.isDirectory() || !posixAccess(s, identity, 3)) fail('world', 'unwritable');
    if (s.uid !== serviceUid) fail('world', 'wrong_owner');
    if (s.mode & 0o002) fail('world', 'unsafe_mode');
  } catch { fail('world', 'missing'); }
  let version = null; let hash = null; let commandN = null;
  const pkg = join(resolve(releaseDir), 'package.json');
  if (readable(pkg, 'release')) {
    try {
      const v = JSON.parse(readFileSync(pkg, 'utf8')).version;
      if (typeof v !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(v)) fail('release', 'invalid_release_version');
      else version = v;
    } catch { fail('release', 'invalid_release'); }
  }
  if (expectedVersion !== undefined && version !== expectedVersion) fail('release', 'release_version_mismatch');
  if (expectedHash !== undefined) {
    try {
      const revision = join(resolve(releaseDir), 'REVISION');
      if (existsSync(revision)) {
        readable(revision, 'release_revision');
        hash = readFileSync(revision, 'utf8').trim();
      } else {
        hash = execFileSync('git', ['-C', resolve(releaseDir), 'rev-parse', 'HEAD'], { encoding: 'utf8', env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      }
      if (!/^[a-f0-9]{7,64}$/.test(hash)) { hash = null; fail('release', 'invalid_release_hash'); }
      if (hash !== expectedHash) fail('release', 'release_hash_mismatch');
    } catch { fail('release', 'release_hash_unavailable'); }
  }
  let manifest = contentManifest;
  let contentVerified;
  if (manifestFile !== undefined) {
    if (typeof manifestFile !== 'string' || !readable(manifestFile, 'content_manifest')) fail('content_manifest', 'invalid_manifest');
    else {
      try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); }
      catch { fail('content_manifest', 'invalid_manifest'); }
    }
  }
  if (contentManifest !== undefined || manifestFile !== undefined) {
    const before = checks.length;
    if (!object(manifest) || Object.keys(manifest).length === 0 || Object.keys(manifest).length > 10000) fail('content_manifest', 'invalid_manifest');
    else {
      let root;
      try { root = realpathSync(resolve(releaseDir)); } catch { fail('content_manifest', 'invalid_release'); }
      for (const [i, [relative, sha]] of Object.entries(manifest).entries()) {
        const target = `content_${i}`;
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(relative) || relative.split('/').some(p => ['', '.', '..'].includes(p))) { fail(target, 'invalid_manifest_path'); continue; }
        if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha)) { fail(target, 'invalid_manifest_hash'); continue; }
        const path = join(resolve(releaseDir), relative);
        if (!readable(path, target)) continue;
        try {
          if (!root || !realpathSync(path).startsWith(`${root}/`)) { fail(target, 'release_path_escape'); continue; }
          if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha) fail(target, 'content_hash_mismatch');
        } catch { fail(target, 'unreadable'); }
      }
    }
    contentVerified = checks.length === before && !checks.some(c => c.target === 'content_manifest');
  }
  for (let i = 0; i < configFiles.length; i++) {
    const path = configFiles[i];
    if (readable(path, `config_${i}`) && path.endsWith('.json')) {
      try { if (!object(JSON.parse(readFileSync(path, 'utf8')))) fail(`config_${i}`, 'invalid_config'); } catch { fail(`config_${i}`, 'invalid_config'); }
    }
  }
  let snapshot = null;
  const snapFile = join(world, 'snapshot.json');
  if (readable(snapFile, 'snapshot', { writable: true, owned: true })) {
    try {
      const s = JSON.parse(readFileSync(snapFile, 'utf8'));
      if (!object(s) || s.id !== worldId || typeof s.seed !== 'string' || !integer(s.commandN) || !object(s.clock) || !integer(s.clock.tick) || !object(s.counters) || !integer(s.counters.event) || !object(s.agents) || (s.physics !== undefined && ![1, 2].includes(s.physics))) fail('snapshot', 'invalid_snapshot');
      else { snapshot = s; commandN = s.commandN; }
    } catch { fail('snapshot', 'invalid_snapshot'); }
  }
  function logTail(name, target, key) {
    const path = join(world, name);
    if (!readable(path, target, { writable: true, owned: true })) return null;
    try {
      const text = readFileSync(path, 'utf8');
      if (text && !text.endsWith('\n')) { fail(target, 'truncated_tail'); return null; }
      let last = 0;
      for (const line of text.split('\n')) {
        if (!line) continue;
        const row = JSON.parse(line);
        if (!object(row) || row[key] !== last + 1 || !integer(row.tick) || typeof row.type !== 'string' || (key === 'n' && !object(row.payload))) { fail(target, 'invalid_continuity'); return null; }
        last = row[key];
      }
      return last;
    } catch { fail(target, 'invalid_jsonl'); return null; }
  }
  const commands = logTail('commands.jsonl', 'commands', 'n');
  const events = logTail('events.jsonl', 'events', 'seq');
  if (snapshot && commands !== null && commands < snapshot.commandN) fail('commands', 'snapshot_ahead');
  if (snapshot && events !== null && events < snapshot.counters.event) fail('events', 'snapshot_ahead');
  for (const name of ['runners.enc', 'runners.key', 'runner.key.enc']) readable(join(world, name), name, { required: false, owned: true, privateMode: true });
  return { ok: checks.length === 0, checks, version, hash, commandN, ...(contentVerified !== undefined ? { contentVerified } : {}) };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]; const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('invalid_options');
    if (key === '--config-file') (args.configFiles ||= []).push(value);
    else args[key.slice(2)] = value;
  }
  let uid; let gid; let groups;
  if (args['service-user']) {
    const name = args['service-user'];
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name)) throw new Error('invalid_service_user');
    const id = flag => execFileSync('id', [flag, name], { encoding: 'utf8', env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    uid = Number(id('-u')); gid = Number(id('-g')); groups = id('-G').split(/\s+/).map(Number);
  } else {
    uid = args.uid === undefined ? undefined : Number(args.uid);
    gid = args.gid === undefined ? undefined : Number(args.gid);
    groups = args.groups ? args.groups.split(',').map(Number) : [];
  }
  if (!args['expected-version'] || !args['expected-hash']) throw new Error('expected_release_required');
  const result = deployPreflight({ releaseDir: args['release-dir'], dataDir: args['data-dir'], worldId: args['world-id'], configFiles: args.configFiles, serviceUid: uid, serviceGid: gid, serviceGroups: groups, expectedVersion: args['expected-version'], expectedHash: args['expected-hash'], manifestFile: args['manifest-file'] });
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch { console.error(JSON.stringify({ ok: false, checks: [{ target: 'options', code: 'invalid_cli_or_identity' }] })); process.exitCode = 2; }
}
