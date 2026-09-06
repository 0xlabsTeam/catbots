import { useState } from 'react';
import type { ChatFlowDraft, MarketSnapshot } from '@catbots/contracts';
import type { FlowRun } from '@catbots/strategy-runtime/node-examples';
type Config = Record<string, unknown>;
export type NodeRunRecord = { run: FlowRun; snapshot: MarketSnapshot; documentKey: string };
export const flowDocumentKey = (draft: ChatFlowDraft) => JSON.stringify(draft.document);
export function useFlowWorkspaceState() {
  const [market, setMarket] = useState('ETH-PERP');
  const [edits, setEdits] = useState<Record<string, { config: Config; base: string }>>({});
  const [results, setResults] = useState<Record<string, NodeRunRecord>>({});
  const [history, setHistory] = useState<NodeRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [lastRun, setLastRun] = useState<NodeRunRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return {
    market, setMarket, edits, results, history, selectedRunId, setSelectedRunId, lastRun, running, setRunning, errors,
    setError(id: string, error: string) { setErrors(previous => ({ ...previous, [id]: error })); },
    edit(id: string, config: Config, base: Config) {
      setEdits(previous => ({ ...previous, [id]: { config, base: previous[id]?.base ?? JSON.stringify(base) } }));
    },
    reset(id: string) { setEdits(previous => { const next = { ...previous }; delete next[id]; return next; }); },
    saved(id: string, submitted: Config) {
      setEdits(previous => {
        if (JSON.stringify(previous[id]?.config) !== JSON.stringify(submitted)) return previous;
        const next = { ...previous }; delete next[id]; return next;
      });
    },
    record(result: NodeRunRecord) {
      setHistory(previous => [result, ...previous.filter(item => item.run.runId !== result.run.runId)].slice(0, 20));
      setSelectedRunId(result.run.runId);
      setLastRun(result);
      setResults(previous => ({ ...previous, ...Object.fromEntries(result.run.trace.map(trace => [trace.nodeId, result])) }));
    },
  };
}
export type FlowWorkspaceState = ReturnType<typeof useFlowWorkspaceState>;
