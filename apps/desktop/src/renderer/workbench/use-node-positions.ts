import { useEffect, useMemo, useState } from 'react';
import type { NodeChange } from '@xyflow/react';
type Positions = Record<string, { x: number; y: number }>;
const prefix = 'catbots.node-layout.v1:';
function read(key: string): Positions {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(prefix + key) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).slice(0, 200).filter(([, point]) => point && Number.isFinite(point.x) && Number.isFinite(point.y)).map(([id, point]) => [id, { x: point.x, y: point.y }]));
  } catch { return {}; }
}
/** Layout is local presentation state, separate from strategy configuration and execution. */
export function useNodePositions(key: string) {
  const initial = useMemo(() => read(key), [key]);
  const [state, setState] = useState({ key, positions: initial });
  const [storageError, setStorageError] = useState('');
  const positions = state.key === key ? state.positions : initial;
  useEffect(() => {
    try { localStorage.setItem(prefix + key, JSON.stringify(positions)); setStorageError(''); }
    catch { setStorageError('Layout could not be saved on this device. You can still move nodes in this session.'); }
  }, [key, positions]);
  return {
    positions, storageError,
    reset: () => setState({ key, positions: {} }),
    onNodesChange(changes: NodeChange[]) {
      const moved = changes.filter(change => change.type === 'position' && change.position && Number.isFinite(change.position.x) && Number.isFinite(change.position.y));
      if (!moved.length) return;
      setState(current => ({ key, positions: { ...(current.key === key ? current.positions : initial), ...Object.fromEntries(moved.flatMap(change => change.type === 'position' && change.position ? [[change.id, change.position]] : [])) } }));
    },
  };
}
