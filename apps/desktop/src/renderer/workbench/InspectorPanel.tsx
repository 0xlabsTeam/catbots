import { Badge, LayerCard } from '@cloudflare/kumo';
import type { StrategyRevision } from '@catbots/contracts';

type NodeView = StrategyRevision['nodes'][number];

export function InspectorPanel({ node }: { node: NodeView | null }) {
  return (
    <LayerCard render={<aside aria-labelledby="inspector-title" />} className="inspector-panel">
      <p className="eyebrow">SELECTION</p>
      {node === null ? (
        <><h2 id="inspector-title">Inspector</h2><p className="inspector-empty">Select a node in the flow to understand what it does.</p></>
      ) : (
        <>
          <div className="inspector-heading"><h2 id="inspector-title">{node.title}</h2><Badge variant="secondary">{node.kind}</Badge></div>
          <dl>
            <div><dt>Rule</dt><dd>{node.summary}</dd></div>
            <div><dt>Node ID</dt><dd><code>{node.id}</code></dd></div>
            <div><dt>Type</dt><dd>{node.type}</dd></div>
            <div><dt>Definition</dt><dd>v{node.version}</dd></div>
          </dl>
          <p className="inspector-note">Change this rule by describing the update in Chat. The visual flow is read-only.</p>
        </>
      )}
    </LayerCard>
  );
}
