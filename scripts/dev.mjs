/**
 * Starts the AeroHydro-PINN backend (port 8000) and frontend (port 5173) together.
 *
 *   npm run dev        (from the repository root)
 *
 * A service whose port is already in use is assumed to be running and is not
 * started twice. Ctrl+C stops everything this script started.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const python = path.join(root, 'backend', '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');

const portInUse = (port) =>
  new Promise((resolve) => {
    const sock = net.connect({ port, host: 'localhost' });
    sock.once('connect', () => (sock.destroy(), resolve(true)));
    sock.once('error', () => resolve(false));
  });

const children = [];
function run(name, color, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, shell: isWin && cmd === 'npm', env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${tag}stopped${code ? ` (exit ${code})` : ''}`));
  children.push(child);
}

const stopAll = () => {
  for (const c of children) {
    if (c.exitCode === null) {
      if (isWin) spawn('taskkill', ['/pid', String(c.pid), '/T', '/F']);
      else c.kill('SIGINT');
    }
  }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

if (!fs.existsSync(python)) {
  console.error(`Backend environment not found at ${python}.\nRun .\\start-local.ps1 once (it installs everything), then use npm run dev.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'frontend', 'node_modules'))) {
  console.error('Frontend dependencies missing. Run:  cd frontend && npm install');
  process.exit(1);
}
const envFile = path.join(root, 'frontend', '.env.local');
if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, 'VITE_API_BASE_URL=http://localhost:8000\n');

if (await portInUse(8000)) console.log('\x1b[36m[backend]\x1b[0m already running on http://127.0.0.1:8000 - not starting another copy');
else run('backend', 36, python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], path.join(root, 'backend'));

if (await portInUse(5173)) console.log('\x1b[32m[frontend]\x1b[0m already running on http://localhost:5173 - not starting another copy');
else run('frontend', 32, 'npm', ['run', 'dev', '--', '--port', '5173', '--strictPort'], path.join(root, 'frontend'));

console.log('\n  Open  http://localhost:5173   (Ctrl+C to stop)\n');
if (!children.length) process.exit(0);
