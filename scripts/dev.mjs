import { spawn } from 'node:child_process';
const mode = process.argv[2] ?? 'desktop';
if (!['desktop', 'web', 'all'].includes(mode)) throw new Error('Use desktop, web, or all');
const child = spawn('pnpm', ['--filter', '@catbots/desktop', 'start'], {
  stdio: 'inherit',
  env: { ...process.env, CATBOTS_WEB: mode === 'desktop' ? '0' : '1', CATBOTS_WEB_ONLY: mode === 'web' ? '1' : '0' },
});
child.on('error', () => { console.error('Could not start pnpm. Install pnpm and use Node 22.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
