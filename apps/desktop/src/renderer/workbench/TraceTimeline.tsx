import { useEffect, useRef, useState } from 'react';
import { Badge, Button, LayerCard } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, TraceDetail, TraceSummary } from '@catbots/contracts';

export function TraceTimeline({ backtestId, botId, revisionVersion, traces, api }: {
  backtestId: string;
  botId: string;
  revisionVersion: number;
  traces: readonly TraceSummary[];
  api: Pick<CatbotsDesktopApi['workbench'], 'getTrace'>;
}) {
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState(false);
  const requestSequence = useRef(0);
  const traceSetKey = traces.map((trace) => [
    trace.parentTraceId, trace.traceId, trace.market, trace.outcome, trace.occurredAt, trace.summary,
  ].join('\u0000')).join('\u0001');
  useEffect(() => {
    requestSequence.current += 1;
    setExpandedParentId(null);
    setSelectedTraceId(null);
    setDetail(null);
    setError(false);
  }, [backtestId, botId, revisionVersion, traceSetKey]);
  const inspect = async (traceId: string) => {
    const request = ++requestSequence.current;
    setError(false);
    setDetail(null);
    setSelectedTraceId(traceId);
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
                    setSelectedTraceId(null);
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
                        aria-pressed={selectedTraceId === trace.traceId}
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
                      <TraceEventFacts event={event} />
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

type TraceEvent = TraceDetail['events'][number];
type EventFact = Readonly<{ label: string; value: string }>;

function TraceEventFacts({ event }: { event: TraceEvent }) {
  const facts = eventFacts(event);
  if (facts.length === 0) return null;
  return <dl className="trace-event-details">{facts.map((fact) => (
    <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
  ))}</dl>;
}

function eventFacts(event: TraceEvent): EventFact[] {
  if (event.type === 'condition.evaluated') return conditionFacts(event.details);
  if (event.type === 'action.proposed') return actionFacts(event.details);
  if (event.type === 'risk.approved' || event.type === 'risk.rejected') {
    const rules = safeTokenList(event.details.violatedRuleIds ?? event.details.riskRuleIds);
    return [
      { label: 'Decision', value: event.type === 'risk.approved' ? 'Approved' : 'Rejected' },
      ...(rules.length === 0 ? [] : [{ label: 'Rules', value: rules.join(', ') }]),
    ];
  }
  if (event.type.startsWith('execution.')) {
    return [{ label: 'Outcome', value: titleCase(event.type.slice('execution.'.length).replaceAll('_', ' ')) }];
  }
  return [];
}

function conditionFacts(details: TraceEvent['details']): EventFact[] {
  const result = details.result;
  const reason = safeToken(details.reason);
  const inputs = Array.isArray(details.inputs)
    ? details.inputs.slice(0, 3).flatMap((value) => {
      const input = record(value);
      const ref = safeToken(input?.ref);
      const field = safeToken(input?.field);
      return ref === undefined ? [] : [`${ref}${field === undefined ? '' : `.${field}`}`];
    })
    : [];
  return [
    ...(result === true || result === false || result === 'unknown'
      ? [{ label: 'Result', value: result === 'unknown' ? 'Unknown' : titleCase(String(result)) }]
      : []),
    ...(reason === undefined ? [] : [{ label: 'Reason', value: reason }]),
    ...(inputs.length === 0 ? [] : [{ label: 'Inputs', value: inputs.join(', ') }]),
  ];
}

function actionFacts(details: TraceEvent['details']): EventFact[] {
  const effect = record(details.effect);
  const config = record(effect?.config);
  if (effect === undefined || config === undefined) return [];
  const type = effect.type === 'execution.open_position' ? 'Open position'
    : effect.type === 'execution.close_position' ? 'Close position'
      : undefined;
  const side = config.side === 'long' || config.side === 'short' ? titleCase(config.side) : undefined;
  const size = record(config.size);
  const sizeValue = typeof size?.value === 'number' && Number.isFinite(size.value) ? size.value : undefined;
  const sizeDescription = size?.type === 'quote' && sizeValue !== undefined
    ? `${formatNumber(sizeValue, true)} quote`
    : size?.type === 'equity_percent' && sizeValue !== undefined
      ? `${formatNumber(sizeValue)}% equity`
      : typeof config.percent === 'number' && Number.isFinite(config.percent)
        ? `${formatNumber(config.percent)}% of position`
        : undefined;
  const leverage = typeof config.leverage === 'number' && Number.isFinite(config.leverage)
    ? `${formatNumber(config.leverage)}×`
    : undefined;
  return [
    ...(type === undefined ? [] : [{ label: 'Proposal', value: type }]),
    ...(side === undefined ? [] : [{ label: 'Side', value: side }]),
    ...(sizeDescription === undefined ? [] : [{ label: 'Size', value: sizeDescription }]),
    ...(leverage === undefined ? [] : [{ label: 'Leverage', value: leverage }]),
  ];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === 'string'
    && /^[a-z0-9_.:-]{1,80}$/i.test(value)
    && !/authorization|api[-_]?key|private[-_]?key|secret|password|credential/i.test(value)
    ? value
    : undefined;
}

function safeTokenList(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 3).flatMap((item) => safeToken(item) ?? []) : [];
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatNumber(value: number, currency = false): string {
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value);
  return currency ? `$${formatted}` : formatted;
}
