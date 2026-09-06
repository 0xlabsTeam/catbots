import { Dialog, LayerCard } from '@cloudflare/kumo';
import type { CatbotsDesktopApi, StrategyRevision } from '@catbots/contracts';

import { LegacyNodeConfiguration } from './LegacyNodeConfiguration';

type NodeView = StrategyRevision['nodes'][number];

export function InspectorPanel({ node, revision, disabled, onSave, nodeApi, onClose }: { onClose?(): void; node: NodeView | null; nodeApi?: CatbotsDesktopApi['nodes']; revision?: StrategyRevision | null; disabled?: boolean; onSave?: (config: Record<string, unknown>) => Promise<void> }) {
  if (node && revision) return <Dialog.Root open onOpenChange={open => { if (!open) onClose?.(); }}><Dialog className="node-editor-dialog" aria-label="Node editor"><Dialog.Title className="sr-only">Node details</Dialog.Title><LegacyNodeConfiguration key={`${node.id}:${revision.version}`} nodeApi={nodeApi} node={node} revision={revision} disabled={disabled} onSave={onSave} onClose={onClose} /></Dialog></Dialog.Root>;
  return <LayerCard className="inspector-panel"><h2>Inspector</h2><p>Select a node to open its Input, Parameters and Output.</p></LayerCard>;
}
