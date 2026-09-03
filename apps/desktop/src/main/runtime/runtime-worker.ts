import { parentPort } from 'electron';

// M0 only proves the supervised utility-process boundary. It intentionally performs
// no strategy evaluation, backtests, exchange access, or network activity.
parentPort.postMessage({ type: 'ready' });

parentPort.on('message', (message: unknown) => {
  if (isShutdownMessage(message)) process.exit(0);
});

function isShutdownMessage(message: unknown): message is { type: 'shutdown' } {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'shutdown';
}
