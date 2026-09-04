import { useState } from 'react';
import { Badge, Button, LayerCard } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, TraceDetail, TraceSummary } from '@catbots/contracts';

export function TraceTimeline({ botId, traces, api }: {
  botId: string;
  traces: readonly TraceSummary[];
  api: Pick<CatbotsDesktopApi['workbench'], 'getTrace'>;
}) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState(false);
  const inspect = async (traceId: string) => {
    setError(false);
    try {
      setDetail(await api.getTrace({ botId, traceId }));
    } catch {
      setError(true);
    }
  };
  return (
    <section className="trace-section" aria-labelledby="trace-heading">
      <header><h3 id="trace-heading">Execution traces</h3><span>{traces.length} flows logged</span></header>
      {traces.length === 0 ? <p className="backtest-muted">No trigger evaluations were recorded.</p> : (
        <div className="trace-browser">
          <div className="trace-list">
            {traces.map((trace) => (
              <Button key={trace.traceId} type="button" variant="ghost" onClick={() => void inspect(trace.traceId)}>
                <span><strong>{trace.traceId}</strong><small>{trace.summary}</small></span>
                <Badge variant={trace.outcome === 'executed' ? 'success' : trace.outcome === 'failed' ? 'error' : 'secondary'}>{trace.outcome}</Badge>
              </Button>
            ))}
          </div>
          {error ? <p role="alert">This trace could not be loaded.</p> : null}
          {detail === null ? <p className="backtest-muted">Select a flow to inspect every logged decision.</p> : (
            <LayerCard render={<ol aria-label={`Events for ${detail.traceId}`} />} className="trace-timeline">
              {detail.events.map((event) => (
                <li key={event.sequence}>
                  <span className="trace-sequence">{event.sequence}</span>
                  <div><strong>{event.summary}</strong><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>{event.nodeId === undefined ? null : <small>Node {event.nodeId}</small>}</div>
                </li>
              ))}
            </LayerCard>
          )}
        </div>
      )}
    </section>
  );
}
