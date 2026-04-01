// Binary patcher - finds Claude Code binary, patches salt, handles codesign

import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { readlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir, platform } from 'os';
import { ORIGINAL_SALT } from './companion.mjs';

function resolveSymlink(p) {
  try { return readlinkSync(p); } catch { return p; }
}

function xdgData() {
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
}

function findClaudeBinary() {
  const home = homedir();
  const os = platform();
  const ext = os === 'win32' ? '.exe' : '';

  // 1. Native install (claude /install) - most common
  const candidates = [
    join(home, '.local', 'bin', 'claude' + ext),
  ];

  // 2. Legacy local npm install
  candidates.push(join(home, '.claude', 'local', 'claude'));

  // 3. Linux package managers (deb, rpm, pacman, apk)
  candidates.push('/usr/bin/claude');

  // 4. npm global
  candidates.push('/usr/local/bin/claude');

  // 5. Homebrew
  if (os === 'darwin') {
    candidates.push('/opt/homebrew/bin/claude');              // Apple Silicon
    candidates.push('/usr/local/bin/claude');                  // Intel (already above, deduped by existsSync)
  }

  // 6. Version managers
  candidates.push(
    join(home, '.volta', 'bin', 'claude'),
    join(home, '.local', 'share', 'pnpm', 'claude'),
    join(home, '.yarn', 'bin', 'claude'),
    join(home, '.bun', 'bin', 'claude'),
    join(home, '.npm', 'bin', 'claude'),
  );

  // 7. mise / asdf
  const miseDir = join(xdgData(), 'mise', 'installs');
  if (existsSync(miseDir)) {
    try {
      for (const tool of readdirSync(miseDir)) {
        const toolDir = join(miseDir, tool);
        for (const ver of readdirSync(toolDir).sort().reverse()) {
          const bin = join(toolDir, ver, 'bin', 'claude');
          if (existsSync(bin)) candidates.push(bin);
        }
      }
    } catch {}
  }
  const asdfDir = join(home, '.asdf', 'installs');
  if (existsSync(asdfDir)) {
    try {
      for (const tool of readdirSync(asdfDir)) {
        const toolDir = join(asdfDir, tool);
        for (const ver of readdirSync(toolDir).sort().reverse()) {
          const bin = join(toolDir, ver, 'bin', 'claude');
          if (existsSync(bin)) candidates.push(bin);
        }
      }
    } catch {}
  }

  // 8. Windows-specific
  if (os === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    candidates.push(
      join(home, '.local', 'bin', 'claude.exe'),
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'claude'),
      join(localAppData, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
      join(localAppData, 'Programs', 'claude-code', 'claude.exe'),
    );
  }

  for (const p of candidates) {
    if (existsSync(p)) return resolveSymlink(p);
  }

  // 9. Fall back to `which claude` / `where claude`
  try {
    const cmd = os === 'win32' ? 'where claude' : 'which claude';
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (result && existsSync(result)) return resolveSymlink(result);
  } catch {}

  // 10. Check versioned installs directly (XDG-aware)
  const versionsDir = join(xdgData(), 'claude', 'versions');
  if (existsSync(versionsDir)) {
    try {
      const versions = readdirSync(versionsDir)
        .filter(v => existsSync(join(versionsDir, v, 'claude' + ext)))
        .sort()
        .reverse();
      if (versions.length > 0) {
        return join(versionsDir, versions[0], 'claude' + ext);
      }
    } catch {}
  }

  return null;
}

function getConfigPath() {
  const p1 = join(homedir(), '.claude.json');
  if (existsSync(p1)) return p1;
  const p2 = join(homedir(), '.claude', '.config.json');
  if (existsSync(p2)) return p2;
  return null;
}

export function getUserId() {
  const configPath = getConfigPath();
  if (!configPath) return null;
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon';
}

export function getCurrentSalt() {
  const binary = findClaudeBinary();
  if (!binary || !existsSync(binary)) return ORIGINAL_SALT;
  const content = readFileSync(binary);
  if (content.includes(Buffer.from(ORIGINAL_SALT))) return ORIGINAL_SALT;
  const saltFile = binary + '.salt';
  if (existsSync(saltFile)) return readFileSync(saltFile, 'utf8');
  return ORIGINAL_SALT;
}

export function patch(newSalt) {
  if (newSalt.length !== ORIGINAL_SALT.length) {
    throw new Error(`Salt must be exactly ${ORIGINAL_SALT.length} characters (got ${newSalt.length})`);
  }

  const binary = findClaudeBinary();
  if (!binary || !existsSync(binary)) {
    throw new Error('Claude Code binary not found. Is Claude Code installed?');
  }

  const backup = binary + '.bak';

  // Backup on first patch
  if (!existsSync(backup)) {
    copyFileSync(binary, backup);
  }

  // Always patch from the clean backup
  copyFileSync(backup, binary);

  // Read binary, replace all occurrences of the salt
  let content = readFileSync(binary);
  const oldBuf = Buffer.from(ORIGINAL_SALT);
  const newBuf = Buffer.from(newSalt);
  let replaced = 0;

  let idx = content.indexOf(oldBuf);
  while (idx !== -1) {
    newBuf.copy(content, idx);
    replaced++;
    idx = content.indexOf(oldBuf, idx + newBuf.length);
  }

  if (replaced === 0) {
    throw new Error('Salt string not found in binary - unexpected format');
  }

  writeFileSync(binary, content);
  if (platform() !== 'win32') {
    execSync(`chmod +x "${binary}"`);
  }

  // Re-sign on macOS
  if (platform() === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${binary}" 2>/dev/null`, { stdio: 'ignore' });
      execSync(`codesign -s - "${binary}"`, { stdio: 'ignore' });
    } catch {
      // codesign failure is non-fatal on some setups
    }
  }

  // Save salt for tracking
  writeFileSync(binary + '.salt', newSalt);

  // Clear companion from config to force re-hatch
  const configPath = getConfigPath();
  if (configPath) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.companion) {
      delete config.companion;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  return { binary, backup, replaced };
}

export function restore() {
  const binary = findClaudeBinary();
  if (!binary) throw new Error('Claude Code binary not found');

  const backup = binary + '.bak';
  if (!existsSync(backup)) {
    return { message: 'No backup found - binary is original.' };
  }

  copyFileSync(backup, binary);
  if (platform() !== 'win32') {
    execSync(`chmod +x "${binary}"`);
  }

  if (platform() === 'darwin') {
    try {
      execSync(`codesign --remove-signature "${binary}" 2>/dev/null`, { stdio: 'ignore' });
      execSync(`codesign -s - "${binary}"`, { stdio: 'ignore' });
    } catch {}
  }

  const saltFile = binary + '.salt';
  if (existsSync(saltFile)) unlinkSync(saltFile);

  // Clear companion
  const configPath = getConfigPath();
  if (configPath) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (config.companion) {
      delete config.companion;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  return { message: 'Restored. Restart Claude Code.' };
}
