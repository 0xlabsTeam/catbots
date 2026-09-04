// M0 only proves the supervised utility-process boundary. It intentionally performs
// no strategy evaluation, backtests, exchange access, or network activity.
process.parentPort?.postMessage({ type: 'ready' });

const activeDeployments = new Set<string>();

process.parentPort?.on('message', (event: unknown) => {
  if (isRuntimeShutdownEvent(event)) process.exit(0);
  if (typeof event !== 'object' || event === null || !('data' in event)) return;
  const activeBots = applyRuntimeWorkerCommand(activeDeployments, (event as { data?: unknown }).data);
  if (activeBots !== undefined) process.parentPort?.postMessage({ type: 'runtime-status', activeBots });
});

export function isRuntimeShutdownEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || !('data' in event)) return false;
  return isShutdownMessage((event as { data?: unknown }).data);
}

function isShutdownMessage(message: unknown): message is { type: 'shutdown' } {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'shutdown';
}

export function applyRuntimeWorkerCommand(active: Set<string>, message: unknown): number | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const candidate = message as { type?: unknown; deploymentId?: unknown };
  if (!['deployment:start', 'deployment:pause', 'deployment:stop'].includes(String(candidate.type))
    || typeof candidate.deploymentId !== 'string' || candidate.deploymentId.trim().length === 0) return undefined;
  if (candidate.type === 'deployment:start') active.add(candidate.deploymentId);
  else active.delete(candidate.deploymentId);
  return active.size;
}
