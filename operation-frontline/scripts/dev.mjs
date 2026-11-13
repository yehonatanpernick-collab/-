#!/usr/bin/env node
// Starts the game server and the Vite client together for local development.
import { spawn } from 'node:child_process';
const run = (name, args) => {
  const p = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (code) => { console.log(`[${name}] exited (${code})`); process.exit(code ?? 0); });
  return p;
};
const procs = [run('server', ['run', 'dev', '-w', 'server']), run('client', ['run', 'dev', '-w', 'client'])];
process.on('SIGINT', () => { for (const p of procs) p.kill('SIGINT'); });
