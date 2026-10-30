#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdtemp, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const MAX_IMAGE = 50 * 1024 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const fail = message => { throw new Error(message); };

async function executable(name) {
  const extensions = process.platform === 'win32' ? ['.exe', '.com'] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const path = resolve(dir, name + ext);
      try {
        if ((await stat(path)).isFile()) { await access(path, constants.X_OK); return path; }
      } catch {}
    }
  }
  return null;
}

function format(data) {
  if (data.length >= 33 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let offset = 8, header = false, pixels = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
      if (length > data.length - offset - 12) break;
      if (offset === 8 && type === 'IHDR' && length === 13 && data.readUInt32BE(offset + 8) && data.readUInt32BE(offset + 12)) header = true;
      if (type === 'IDAT') pixels = true;
      if (type === 'IEND' && length === 0) return header && pixels ? '.png' : null;
      offset += length + 12;
    }
  }
  if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255 && data[data.length - 2] === 255 && data[data.length - 1] === 217) return '.jpg';
  if (data.length >= 20 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && data.readUInt32LE(4) + 8 === data.length && /^(VP8 |VP8L|VP8X)$/.test(data.toString('ascii', 12, 16))) return '.webp';
  return null;
}
const hash = data => createHash('sha256').update(data).digest('hex');
function expand(path) {
  if (path.startsWith('file://')) return fileURLToPath(path);
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return resolve(path);
}
function inside(path, parent) {
  const rel = relative(parent, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}
async function inspect(path) {
  const resolved = await realpath(path);
  const handle = await open(resolved, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE) fail('Image is not a readable supported-size regular file.');
    const data = await handle.readFile();
    if (data.length !== info.size || !format(data)) fail('Image has an unsupported or invalid signature.');
    return { path: resolved, info, digest: hash(data), data };
  } finally { await handle.close(); }
}
async function validate(path, inputs, started, requiredRoot) {
  const image = await inspect(path);
  if (image.info.birthtimeMs < started || image.info.mtimeMs < started) fail('Image is not demonstrably new.');
  if (requiredRoot && !inside(image.path, await realpath(requiredRoot))) fail('Image is outside the current session directory.');
  if (inputs.some(i => i.path === image.path || (i.info.dev === image.info.dev && i.info.ino === image.info.ino) || i.digest === image.digest)) fail('Image matches an input image.');
  return image.path;
}

function run(command, args, stdin, timeout) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', size = 0, reason = '';
    const kill = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch {} };
    let escalation;
    const stop = why => { if (reason) return; reason = why; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 1000); escalation.unref(); };
    const timer = setTimeout(() => stop('Provider timed out.'), timeout);
    const collect = (chunk, stream) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_OUTPUT) return stop('Provider output exceeded the limit.');
      if (stream === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => collect(c, 'stdout'));
    child.stderr.on('data', c => collect(c, 'stderr'));
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); clearTimeout(escalation); reject(new Error('Unable to start provider.')); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(escalation);
      if (reason) return reject(new Error(reason));
      if (code !== 0) {
        return reject(new Error('Provider process failed.'));
      }
      resolveRun({ stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function parseJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  try { const result = JSON.parse(fenced ? fenced[1] : trimmed); return result && typeof result === 'object' && !Array.isArray(result) ? result : null; } catch { return null; }
}
function candidates(text) {
  const out = [];
  const json = parseJson(text);
  if (json && json.ok === false) fail('Provider reported failure.');
  if (json && typeof json.generatedImagePath === 'string' && json.generatedImagePath.trim()) out.push(json.generatedImagePath.trim());
  if (!json) {
    for (const m of text.matchAll(/\[[^\]]*\]\((file:\/\/[^)]+|(?:\/|~\/)[^)]+\.(?:png|jpe?g|webp))\)|["'`]((?:file:\/\/|\/|~\/)[^"'`\n]+?\.(?:png|jpe?g|webp))["'`]|(?:^|\n)\s*((?:file:\/\/|\/|~\/)[^\n\r]+?\.(?:png|jpe?g|webp))\s*(?=$|\n)/gi)) out.push(m[1] || m[2] || m[3]);
  }
  return [...new Set(out)];
}
async function walk(dir, depth = 0) {
  if (depth > 12) fail('Provider output directory is too deep.');
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (entries.length > 10000) fail('Provider output directory is too large.');
  const results = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await walk(path, depth + 1));
    else if (entry.isFile()) results.push(path);
    if (results.length > 10000) fail('Provider output directory is too large.');
  }
  return results;
}
async function checkGeneratedRoot(parent) {
  if ((await lstat(parent)).isSymbolicLink()) fail('Cannot safely identify the Codex generated_images root.');
  const generatedRoot = await realpath(parent);
  if (generatedRoot !== join(await realpath(root), 'generated_images')) fail('Cannot safely identify the Codex generated_images root.');
}
async function checkSessionDir(sessionDir) {
  const parent = dirname(sessionDir);
  await checkGeneratedRoot(parent);
  const generatedRoot = await realpath(parent);
  const actual = await realpath(sessionDir);
  if (actual !== join(generatedRoot, sessionDir.split(/[\\/]/).pop())) fail('Cannot safely identify the Codex session directory.');
}
async function inlineImage(sessionId, started, inputs, sessionDir) {
  const files = (await walk(join(root, 'sessions'))).filter(p => p.endsWith('.jsonl') && p.includes(sessionId));
  if (files.length !== 1) fail('Cannot uniquely identify the Codex session log.');
  const info = await stat(files[0]);
  if (info.size > MAX_IMAGE * 4) fail('Codex session log is too large.');
  const records = (await readFile(files[0], 'utf8')).split('\n');
  const images = [];
  for (const line of records) {
    if (!line.trim()) continue;
    let record; try { record = JSON.parse(line); } catch { fail('Codex session log contains invalid JSONL.'); }
    const payload = record?.payload;
    const timestamp = Date.parse(record?.timestamp);
    if (record?.type !== 'event_msg' || payload?.type !== 'image_generation_end' || typeof payload.call_id !== 'string' || !payload.call_id || typeof payload.result !== 'string' || !Number.isFinite(timestamp) || timestamp < started) continue;
    const raw = payload.result.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    if (!raw || raw.length > MAX_IMAGE * 4 / 3 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) continue;
    const data = Buffer.from(raw, 'base64');
    const extension = format(data);
    if (extension && data.length <= MAX_IMAGE && !inputs.some(i => i.digest === hash(data))) images.push({ data, extension });
  }
  if (images.length !== 1) fail('Cannot uniquely identify an inline Codex image.');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(dirname(sessionDir), { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await checkGeneratedRoot(dirname(sessionDir));
  await mkdir(sessionDir, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  await checkSessionDir(sessionDir);
  const path = join(sessionDir, `inline-${randomUUID()}${images[0].extension}`);
  await writeFile(path, images[0].data, { flag: 'wx', mode: 0o600 });
  try { return await validate(path, inputs, started, sessionDir); } catch (e) { await rm(path, { force: true }); throw e; }
}

async function generate(provider, model, imagePaths, prompt) {
  const command = await executable(provider);
  if (!command) fail('Selected provider is not available on PATH.');
  const inputs = [];
  for (const path of imagePaths) inputs.push(await inspect(expand(path)));
  const timeoutValue = process.env.IMAGE_GEN_TIMEOUT_MS;
  const timeout = timeoutValue === undefined ? 900000 : Number(timeoutValue);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600000) fail('Invalid IMAGE_GEN_TIMEOUT_MS.');
  const started = Date.now();
  const instruction = [
    provider === 'codex' ? 'Use the built-in $imagegen skill/tool; do not use API fallback scripts.' : 'Use your image generation capability.',
    'Generate exactly one raster image. Do not copy, move, rename, edit or delete the generated image.',
    'Return only JSON: {"ok":true,"generatedImagePath":"/absolute/path/to/image.png","message":"","sessionId":""}.',
    'For an inline-only Codex result use an empty generatedImagePath. Do not return input images. On failure set ok to false.',
    ...inputs.map((i, n) => `Reference image ${n + 1}: ${i.path}`),
    'User prompt:', prompt,
  ].join('\n');
  if (provider === 'agy') {
    const args = ['--print-timeout', `${Math.ceil(timeout / 1000)}s`];
    for (const dir of new Set(inputs.map(i => dirname(i.path)))) args.push('--add-dir', dir);
    if (model) args.push('--model', model);
    args.push('--print', instruction);
    const { stdout } = await run(command, args, '', timeout);
    const paths = [];
    for (const candidate of candidates(stdout)) {
      paths.push(await validate(expand(candidate), inputs, started));
    }
    const unique = [...new Set(paths)];
    if (unique.length !== 1) fail('Cannot uniquely validate a new provider image.');
    return unique[0];
  }
  const temp = await mkdtemp(join(tmpdir(), 'image-gen-'));
  try {
    const schema = join(temp, 'schema.json'), result = join(temp, 'result.json');
    await writeFile(schema, JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean' }, generatedImagePath: { type: 'string' }, message: { type: 'string' }, sessionId: { type: 'string' } }, required: ['ok', 'generatedImagePath', 'message', 'sessionId'], additionalProperties: false }));
    const args = ['exec', '--skip-git-repo-check', '--color', 'never', '--output-schema', schema, '--output-last-message', result, '--cd', process.cwd()];
    if (model) args.push('--model', model);
    for (const input of inputs) args.push('--image', input.path);
    args.push('-');
    const output = await run(command, args, instruction, timeout);
    let resultText;
    try { const info = await stat(result); if (info.size > MAX_OUTPUT) fail('Provider result exceeded the limit.'); resultText = await readFile(result, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; resultText = output.stdout; }
    const parsed = parseJson(resultText);
    if (!parsed || typeof parsed.ok !== 'boolean' || typeof parsed.generatedImagePath !== 'string') fail('Cannot parse Codex result.');
    if (!parsed.ok) fail('Provider reported failure.');
    const ids = [...new Set([...`${output.stderr}\n${output.stdout}`.matchAll(/session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/gi)].map(m => m[1].toLowerCase()))];
    if (ids.length !== 1 || !UUID.test(ids[0])) fail('Cannot uniquely identify the Codex session.');
    const sessionDir = join(root, 'generated_images', ids[0]);
    const found = [];
    try { await checkSessionDir(sessionDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (parsed.generatedImagePath.trim()) {
      return await validate(expand(parsed.generatedImagePath.trim()), inputs, started, sessionDir);
    }
    for (const path of await walk(sessionDir)) {
      if (/\.(?:png|jpe?g|webp)$/i.test(path)) found.push(await validate(path, inputs, started, sessionDir));
    }
    const unique = [...new Set(found)];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) fail('Cannot uniquely identify the Codex image.');
    return await inlineImage(ids[0], started, inputs, sessionDir);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === 'probe') {
    const [codex, agy] = await Promise.all([executable('codex'), executable('agy')]);
    let login = 'unknown', loginError;
    if (codex) {
      try {
        const status = await run(codex, ['login', 'status'], '', 5000);
        if (status.stdout.trim() || status.stderr.trim()) login = 'authenticated';
      } catch { loginError = 'probe_failed'; }
    }
    console.log(JSON.stringify({ codex: { available: !!codex, login, ...(loginError && { loginError }) }, agy: { available: !!agy, login: 'unknown' } }));
    return;
  }
  if (args.shift() !== 'generate') fail('Usage: probe | generate --provider codex|agy [--image path ...] [--model model]');
  let provider, model; const images = [];
  while (args.length) {
    const option = args.shift(), value = args.shift();
    if (!value || value.startsWith('--')) fail('Invalid command options.');
    if (option === '--provider' && provider === undefined) provider = value;
    else if (option === '--model' && model === undefined) model = value;
    else if (option === '--image') images.push(value);
    else fail('Invalid command options.');
  }
  if (provider !== 'codex' && provider !== 'agy') fail('Explicit --provider codex or agy is required.');
  let prompt = '', bytes = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { bytes += Buffer.byteLength(chunk); if (bytes > 1024 * 1024) fail('Prompt exceeds the size limit.'); prompt += chunk; }
  if (!prompt.trim()) fail('Prompt must not be empty.');
  const path = await generate(provider, model, images, prompt);
  console.log(JSON.stringify({ provider, path }));
}
main().catch(error => {
  const safe = error instanceof Error && /^(Usage:|Invalid command options\.|Explicit --provider|Prompt |Invalid IMAGE_GEN_TIMEOUT_MS\.|Selected provider |Image |Provider |Cannot |Codex session log )/.test(error.message) ? error.message : 'Image generation failed; provider output or file could not be safely verified.';
  console.error(safe);
  process.exitCode = 1;
});
