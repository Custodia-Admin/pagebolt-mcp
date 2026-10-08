// saveTo handling: contain writes to an allowed root, create the parent folder,
// and NEVER report success unless the bytes are on disk.

import { mkdirSync, writeFileSync, statSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, delimiter } from 'node:path';

/** Roots saveTo may write under: the server's CWD plus PAGEBOLT_MCP_SAVE_ROOT (path-delimited list). */
export function allowedRoots(env = process.env, cwd = process.cwd()) {
  const extra = (env.PAGEBOLT_MCP_SAVE_ROOT || '').split(delimiter).map((s) => s.trim()).filter(Boolean);
  return [cwd, ...extra.map((p) => resolve(p))];
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith('..'));
}

function realOfNearestExisting(p) {
  let cur = p;
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return realpathSync(cur);
}

/**
 * Resolve and validate a saveTo path (no filesystem writes).
 * Throws an Error whose message tells the caller exactly what to change.
 */
export function resolveSavePath(userPath, defaultName, { env = process.env, cwd = process.cwd() } = {}) {
  const resolved = resolve(cwd, userPath || defaultName);
  const roots = allowedRoots(env, cwd);
  if (!roots.some((r) => inside(r, resolved))) {
    throw new Error(
      `saveTo "${userPath}" resolves to ${resolved}, outside the allowed folder(s): ${roots.join(', ')}. ` +
      'Use a path under the MCP server\'s working directory, or set PAGEBOLT_MCP_SAVE_ROOT=<dir> in the MCP server\'s env to allow another folder.',
    );
  }
  return resolved;
}

/**
 * Make sure `abs` can be written: create the parent folder recursively, refuse
 * directories, and re-check containment after symlinks are resolved.
 * Throws on any problem. Call this BEFORE paying for a render.
 */
export function prepareSaveTarget(abs, { env = process.env, cwd = process.cwd() } = {}) {
  const dir = dirname(abs);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`saveTo: cannot create parent folder ${dir} (${err.code || err.message}).`);
  }
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    throw new Error(`saveTo: ${abs} is a directory; give a file path such as ${abs}/recording.mp4.`);
  }
  const realDir = realOfNearestExisting(dir);
  const realRoots = allowedRoots(env, cwd).map((r) => { try { return realpathSync(r); } catch { return r; } });
  if (!realRoots.some((r) => inside(r, realDir))) {
    throw new Error(`saveTo: ${dir} resolves through a symlink to ${realDir}, outside the allowed folder(s).`);
  }
}

/**
 * Write the file and verify it. Returns { path, bytes } with the absolute path
 * and the size read back from disk. Throws if the file is not there afterwards.
 */
export function writeVerified(abs, buffer) {
  try {
    writeFileSync(abs, buffer);
  } catch (err) {
    throw new Error(`saveTo: writing ${abs} failed (${err.code || err.message}).`);
  }
  let size;
  try {
    size = statSync(abs).size;
  } catch {
    throw new Error(`saveTo: ${abs} was written but cannot be read back.`);
  }
  if (size !== buffer.length) {
    throw new Error(`saveTo: ${abs} is ${size} bytes on disk but ${buffer.length} were expected (disk full?).`);
  }
  return { path: abs, bytes: size };
}
