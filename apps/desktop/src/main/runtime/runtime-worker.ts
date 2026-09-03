// M0 only proves the supervised utility-process boundary. It intentionally performs
// no strategy evaluation, backtests, exchange access, or network activity.
process.parentPort?.postMessage({ type: 'ready' });

process.parentPort?.on('message', (event: unknown) => {
  if (isRuntimeShutdownEvent(event)) process.exit(0);
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
