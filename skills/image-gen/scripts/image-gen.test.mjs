import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, linkSync, symlinkSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./image-gen.mjs', import.meta.url));
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'image-gen-test-')));
const bin = join(dir, 'bin'); mkdirSync(bin);
const home = join(dir, 'codex home');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX/AAAZ4gk3AAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg==', 'base64');
const input = join(dir, 'input image.png'); writeFileSync(input, png);
const mock = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), mode = process.env.MOCK_MODE, base = process.env.MOCK_DIR;
if (args[0] === 'login' && args[1] === 'status') {
  if (mode === 'loginfail') { console.error('not logged in SECRET_PROVIDER_TOKEN'); process.exit(1); }
  if (mode === 'loginunknown') process.exit(1);
  if (mode === 'loginempty') process.exit(0);
  console.log('logged in SECRET_PROVIDER_TOKEN'); process.exit(0);
}
fs.writeFileSync(path.join(base, 'args.json'), JSON.stringify(args));
if (mode === 'authfail') { console.error('not authenticated SECRET_PROVIDER_TOKEN'); process.exit(2); }
if (mode === 'fail') { console.error('SECRET_PROVIDER_TOKEN'); process.exit(2); }
if (mode === 'hang') { setTimeout(() => {}, 10000); return; }
const png = Buffer.from('${png.toString('base64')}', 'base64');
const image = Buffer.concat([png, Buffer.from('generated')]);
const sid = '12345678-1234-1234-1234-123456789abc';
if (path.basename(process.argv[1]).startsWith('codex')) {
  const out = args[args.indexOf('--output-last-message') + 1];
  const explicit = mode === 'codex-explicit' ? path.join(process.env.CODEX_HOME, 'generated_images', sid, 'result with spaces.png') : mode === 'codex-bad-path' ? path.join(base, 'missing.png') : '';
  fs.writeFileSync(out, JSON.stringify({ok: mode !== 'reported-failure', generatedImagePath:explicit, message:'', sessionId:sid}));
  if (mode !== 'no-session') console.error('session id: ' + sid);
  const folder = path.join(process.env.CODEX_HOME, 'generated_images', sid);
  if (mode === 'codex-file' || mode === 'codex-multiple' || mode === 'codex-explicit' || mode === 'codex-bad-path') {
    fs.mkdirSync(folder, {recursive:true}); fs.writeFileSync(path.join(folder, 'result with spaces.png'), image);
    if (mode === 'codex-multiple') fs.writeFileSync(path.join(folder, 'second.png'), image);
  }
  if (mode === 'inline' || mode === 'inline-old' || mode === 'inline-evil' || mode === 'inline-corrupt') {
    const logs = path.join(process.env.CODEX_HOME, 'sessions', '2026'); fs.mkdirSync(logs, {recursive:true});
    const event = {timestamp: mode === 'inline-old' ? '2020-01-01T00:00:00Z' : new Date().toISOString(), type:'event_msg', payload:{type:'image_generation_end', call_id:'../../escape', result:image.toString('base64')}};
    fs.writeFileSync(path.join(logs, sid + '.jsonl'), JSON.stringify(event) + (mode === 'inline-corrupt' ? '\\n{broken' : ''));
  }
} else {
  let target = path.join(base, 'generated image.png');
  if (mode === 'input') target = process.env.MOCK_INPUT;
  else if (mode === 'old') target = process.env.MOCK_OLD;
  else if (mode === 'hardlink') target = process.env.MOCK_LINK;
  else if (mode === 'invalid') fs.writeFileSync(target, 'not an image');
  else if (mode === 'copy-input') fs.writeFileSync(target, png);
  else if (mode !== 'missing') fs.writeFileSync(target, image);
  if (mode === 'io-mixed') console.log('[' + 'a' + '](' + target + ')\\n[' + 'b' + '](' + path.join(base, 'missing.png') + ')');
  else if (mode === 'multiple') { const other = path.join(base, 'second.png'); fs.writeFileSync(other, image); console.log('[' + 'a' + '](' + target + ')\\n[' + 'b' + '](' + other + ')'); }
  else if (mode === 'prose') console.log('Generated: [' + 'image' + '](' + target + ')');
  else if (mode === 'fenced') console.log('\\x60\\x60\\x60json\\n' + JSON.stringify({ok:true, generatedImagePath:target}) + '\\n\\x60\\x60\\x60');
  else console.log(JSON.stringify({ok:mode !== 'reported-failure', generatedImagePath:target}));
}
`;
for (const name of ['codex', 'agy']) { const p = join(bin, name); writeFileSync(p, mock); chmodSync(p, 0o755); }
const old = join(dir, 'old.png'); writeFileSync(old, png); utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
const hardlink = join(dir, 'hardlink.png'); linkSync(input, hardlink);
after(() => rmSync(dir, { recursive: true, force: true }));
function invoke(args, mode = 'success', options = {}) {
  rmSync(home, { recursive: true, force: true });
  rmSync(join(dir, 'generated image.png'), { force: true });
  if (options.setup) options.setup();
  return spawnSync(process.execPath, [script, ...args], {
    input: options.prompt ?? 'a small cat', encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: options.path ?? bin, CODEX_HOME: home, MOCK_DIR: dir, MOCK_MODE: mode, MOCK_INPUT: input, MOCK_OLD: old, MOCK_LINK: hardlink, ...options.env },
  });
}
function success(result, provider) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output).sort(), ['path', 'provider']);
  assert.equal(output.provider, provider);
  assert.ok(readFileSync(output.path).subarray(0, 8).equals(png.subarray(0, 8)));
  return output;
}
function failure(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim());
  assert.doesNotMatch(result.stderr, /SECRET_PROVIDER_TOKEN/);
}
test('probe checks availability and Codex login without exposing output or generating', () => {
  rmSync(join(dir, 'args.json'), { force: true });
  const r = invoke(['probe']); assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { codex: { available: true, login: 'authenticated' }, agy: { available: true, login: 'unknown' } });
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET_PROVIDER_TOKEN/);
  assert.throws(() => readFileSync(join(dir, 'args.json')));
  for (const mode of ['loginfail', 'loginunknown']) {
    const failedProbe = invoke(['probe'], mode);
    assert.equal(failedProbe.status, 0);
    assert.equal(JSON.parse(failedProbe.stdout).codex.login, 'unknown');
    assert.equal(JSON.parse(failedProbe.stdout).codex.loginError, 'probe_failed');
    assert.doesNotMatch(failedProbe.stdout + failedProbe.stderr, /SECRET_PROVIDER_TOKEN/);
  }
  assert.equal(JSON.parse(invoke(['probe'], 'loginempty').stdout).codex.login, 'unknown');
  const missing = invoke(['probe'], 'success', { path: join(dir, 'absent') });
  assert.deepEqual(JSON.parse(missing.stdout), { codex: { available: false, login: 'unknown' }, agy: { available: false, login: 'unknown' } });
});
test('explicit selection required; no automatic resolution or fallback', () => {
  failure(invoke(['generate']));
  failure(invoke(['generate', '--provider', 'auto']));
  failure(invoke(['generate', '--provider', 'codex'], 'success', { path: join(dir, 'absent') }));
  failure(invoke(['generate', '--provider', 'agy'], 'success', { prompt: '  ' }));
});
test('agy JSON, fenced JSON and markdown paths with spaces', () => {
  for (const mode of ['success', 'fenced', 'prose']) {
    const r = invoke(['generate', '--provider', 'agy', '--image', input, '--model', 'model-name'], mode);
    success(r, 'agy');
    const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
    assert.ok(args.includes(dirname(input))); assert.ok(args.includes('model-name'));
    assert.ok(!args.some(a => /dangerously|skip-permissions/.test(a)));
  }
});
test('reports provider failure without exposing authentication diagnostics', () => {
  const result = invoke(['generate', '--provider', 'agy'], 'authfail');
  failure(result);
  assert.match(result.stderr, /Provider process failed/);
});
test('rejects provider failures, stale, input, hardlinked, missing and invalid files', () => {
  for (const mode of ['fail', 'reported-failure', 'old', 'input', 'hardlink', 'copy-input', 'missing', 'invalid', 'multiple', 'io-mixed']) failure(invoke(['generate', '--provider', 'agy', '--image', input], mode));
});
test('Codex session file result and inline result are verified', () => {
  for (const mode of ['codex-file', 'codex-explicit', 'inline', 'inline-evil']) {
    const r = invoke(['generate', '--provider', 'codex', '--image', input, '--model', 'model-name'], mode);
    const output = success(r, 'codex');
    assert.ok(output.path.startsWith(join(home, 'generated_images', '12345678-1234-1234-1234-123456789abc')));
    const args = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
    assert.ok(args.includes(input)); assert.ok(args.includes('model-name'));
    assert.ok(!args.some(a => /dangerously|bypass|full-auto/.test(a)));
  }
});
test('Codex refuses missing session, ambiguous files, stale inline and reported failures', () => {
  for (const mode of ['no-session', 'codex-multiple', 'codex-bad-path', 'inline-old', 'inline-corrupt', 'reported-failure', 'fail']) failure(invoke(['generate', '--provider', 'codex'], mode));
});
test('rejects a symlinked generated_images root', () => {
  const external = join(dir, 'external'); mkdirSync(external, { recursive: true });
  const result = invoke(['generate', '--provider', 'codex'], 'inline', { setup() {
    mkdirSync(home, { recursive: true }); symlinkSync(external, join(home, 'generated_images'), 'dir');
  } });
  failure(result); assert.throws(() => readFileSync(join(external, '12345678-1234-1234-1234-123456789abc')));
});
test('timeout terminates provider without exposing its output', () => {
  failure(invoke(['generate', '--provider', 'agy'], 'hang', { env: { IMAGE_GEN_TIMEOUT_MS: '100' } }));
});
