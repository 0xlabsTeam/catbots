import { Collapsible, Button, Badge, LayerCard } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, StrategyRevision } from '@catbots/contracts';

import { LegacyNodeConfiguration } from './LegacyNodeConfiguration';
import { nodeLabel, readableRule } from './graph-model';

type NodeView = StrategyRevision['nodes'][number];

export function InspectorPanel({ node, revision, disabled, onSave, nodeApi }: { node: NodeView | null; nodeApi?: CatbotsDesktopApi['nodes']; revision?: StrategyRevision | null; disabled?: boolean; onSave?: (config: Record<string, unknown>) => Promise<void> }) {
  return (
    <LayerCard render={<aside aria-labelledby="inspector-title" />} className="inspector-panel">
      <p className="eyebrow">SELECTION</p>
      {node === null ? (
        <><h2 id="inspector-title">Inspector</h2><p className="inspector-empty">Select a node in the flow to understand what it does.</p></>
      ) : (
        <>
          <div className="inspector-heading"><h2 id="inspector-title">{nodeLabel(node)}</h2><Badge variant="secondary">{node.kind}</Badge></div>
          <dl>
            <div><dt>Rule</dt><dd>{readableRule(node.summary)}</dd></div>
          </dl>
          <Collapsible.Root className="inspector-technical"><Collapsible.Trigger render={<Button variant="ghost" size="sm" />}>Technical details</Collapsible.Trigger><Collapsible.Panel><dl>
            <div><dt>Node ID</dt><dd><code>{node.id}</code></dd></div>
            <div><dt>Type</dt><dd>{node.type}</dd></div>
            <div><dt>Definition</dt><dd>v{node.version}</dd></div>
          </dl></Collapsible.Panel></Collapsible.Root>
          {revision && <LegacyNodeConfiguration key={`${node.id}:${revision.version}`} nodeApi={nodeApi} node={node} revision={revision} disabled={disabled} onSave={onSave} />}
        </>
      )}
    </LayerCard>
  );
}
