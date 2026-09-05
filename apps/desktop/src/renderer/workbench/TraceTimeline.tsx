import { useRef, useState } from 'react';
import { Badge, Button, LayerCard } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, TraceDetail, TraceSummary } from '@catbots/contracts';

export function TraceTimeline({ botId, revisionVersion, traces, api }: {
  botId: string;
  revisionVersion: number;
  traces: readonly TraceSummary[];
  api: Pick<CatbotsDesktopApi['workbench'], 'getTrace'>;
}) {
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState(false);
  const requestSequence = useRef(0);
  const inspect = async (traceId: string) => {
    const request = ++requestSequence.current;
    setError(false);
    setDetail(null);
    try {
      const next = await api.getTrace({ botId, traceId });
      if (request === requestSequence.current) setDetail(next);
    } catch {
      if (request === requestSequence.current) setError(true);
    }
  };
  const groups = groupTraces(traces);
  return (
    <section className="trace-section" aria-labelledby="trace-heading">
      <header><h3 id="trace-heading">Execution traces</h3><span>{groups.length} runs · {traces.length} market evaluations</span></header>
      {traces.length === 0 ? <p className="backtest-muted">No trigger evaluations were recorded.</p> : (
        <div className="trace-browser">
          <div className="trace-run-list">
            {groups.map((group, index) => {
              const expanded = expandedParentId === group.parentTraceId;
              const panelId = `trace-run-${index}`;
              return <div className="trace-run" key={group.parentTraceId}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => {
                    requestSequence.current += 1;
                    setExpandedParentId(expanded ? null : group.parentTraceId);
                    setDetail(null);
                    setError(false);
                  }}
                >
                  <span><strong>{runKind(group.parentTraceId)} run</strong><small>{new Date(group.occurredAt).toLocaleString()} · {group.traces.length} market{group.traces.length === 1 ? '' : 's'}</small></span>
                  <Badge variant={outcomeVariant(group.outcome)}>{group.outcome}</Badge>
                </Button>
                {expanded ? <div id={panelId} className="trace-run-detail">
                  <dl>
                    <div><dt>Strategy revision</dt><dd>v{revisionVersion}</dd></div>
                    <div><dt>Universe revision</dt><dd>{universeRevision(group.parentTraceId)}</dd></div>
                  </dl>
                  <div className="trace-market-list" role="group" aria-label="Market evaluations">
                    {group.traces.map((trace) => (
                      <Button
                        key={trace.traceId}
                        type="button"
                        variant="ghost"
                        aria-pressed={detail?.traceId === trace.traceId}
                        onClick={() => void inspect(trace.traceId)}
                      >
                        <span><strong>{trace.market}</strong><small>{trace.summary}</small></span>
                        <Badge variant={outcomeVariant(trace.outcome)}>{trace.outcome}</Badge>
                      </Button>
                    ))}
                  </div>
                </div> : null}
              </div>;
            })}
          </div>
          {error ? <p role="alert">This trace could not be loaded.</p> : null}
          {detail === null ? <p className="backtest-muted">Select a run, then choose a market evaluation to inspect every logged decision.</p> : (
            <section className="trace-market-detail" aria-labelledby="trace-market-heading">
              <div><p className="eyebrow">MARKET CHILD TRACE</p><h4 id="trace-market-heading">{detail.market} evaluation</h4></div>
              <LayerCard render={<ol aria-label={`Events for ${detail.market}`} />} className="trace-timeline">
                {detail.events.map((event) => (
                  <li key={event.sequence}>
                    <span className="trace-sequence">{event.sequence}</span>
                    <div>
                      <span className="trace-event-heading"><Badge variant="secondary">{eventCategory(event.type)}</Badge><strong>{event.summary}</strong></span>
                      <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
                      {event.nodeId === undefined ? null : <small>Node {event.nodeId}</small>}
                    </div>
                  </li>
                ))}
              </LayerCard>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

type TraceGroup = Readonly<{
  parentTraceId: string;
  occurredAt: string;
  outcome: TraceSummary['outcome'];
  traces: TraceSummary[];
}>;

function groupTraces(traces: readonly TraceSummary[]): TraceGroup[] {
  const groups = new Map<string, TraceSummary[]>();
  for (const trace of traces) groups.set(trace.parentTraceId, [...(groups.get(trace.parentTraceId) ?? []), trace]);
  return [...groups.entries()].map(([parentTraceId, children]) => ({
    parentTraceId,
    occurredAt: children[0]!.occurredAt,
    outcome: aggregateOutcome(children),
    traces: children,
  }));
}

function aggregateOutcome(traces: readonly TraceSummary[]): TraceSummary['outcome'] {
  for (const outcome of ['failed', 'rejected', 'unknown', 'executed', 'skipped'] as const) {
    if (traces.some((trace) => trace.outcome === outcome)) return outcome;
  }
  return 'unknown';
}

function outcomeVariant(outcome: TraceSummary['outcome']): 'success' | 'error' | 'secondary' {
  return outcome === 'executed' ? 'success' : outcome === 'failed' || outcome === 'rejected' ? 'error' : 'secondary';
}

function runKind(parentTraceId: string): 'Event' | 'Interval' | 'Trigger' {
  if (parentTraceId.includes(':event:')) return 'Event';
  if (parentTraceId.includes(':interval:')) return 'Interval';
  return 'Trigger';
}

function universeRevision(parentTraceId: string): string {
  const marker = ':universe:';
  const start = parentTraceId.lastIndexOf(marker);
  if (start < 0) return 'Not recorded';
  const encoded = parentTraceId.slice(start + marker.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function eventCategory(type: string): 'Condition' | 'Action' | 'Risk' | 'Execution' | 'Trigger' | 'Flow' {
  if (type.startsWith('condition.')) return 'Condition';
  if (type.startsWith('action.')) return 'Action';
  if (type.startsWith('risk.')) return 'Risk';
  if (type.startsWith('execution.')) return 'Execution';
  if (type.startsWith('trigger.')) return 'Trigger';
  return 'Flow';
}
