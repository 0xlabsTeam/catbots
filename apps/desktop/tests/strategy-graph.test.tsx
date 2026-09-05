// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StrategyRevision } from '@catbots/contracts';

const flow = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));
vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    flow.props = props;
    const StrategyNode = (props.nodeTypes as { strategy: React.ComponentType<{ data: Record<string, unknown> }> }).strategy;
    return <>
      <button onClick={() => (props.onNodeClick as Function)?.({}, (props.nodes as unknown[])[0])}>Flow canvas</button>
      {(props.nodes as Array<{ id: string; data: Record<string, unknown> }>).map((node) => <StrategyNode key={node.id} data={node.data} />)}
      {props.children as React.ReactNode}
    </>;
  },
  Background: () => <div data-testid="flow-background" />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => <div data-testid="flow-controls" />,
  Handle: () => null,
  MiniMap: () => <div data-testid="flow-minimap" />,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
}));

import { buildStrategyGraph } from '../src/renderer/workbench/graph-model';
import { StrategyGraph } from '../src/renderer/workbench/StrategyGraph';

const revision: StrategyRevision = {
  botId: '018f3f75-89ab-7def-8123-456789abcdef',
  strategyId: 'strategy',
  version: 1,
  name: 'ETF momentum',
  status: 'draft',
  createdAt: '2026-09-04T00:00:00.000Z',
  approvedAt: null,
  nodes: [
    { id: 'trigger', kind: 'trigger', type: 'trigger.interval', version: 1, title: 'Interval', summary: 'Every 1h' },
    { id: 'condition', kind: 'condition', type: 'predicate.compare', version: 1, title: 'Compare', summary: 'ETF flow > 0' },
    { id: 'condition-2', kind: 'condition', type: 'predicate.position', version: 1, title: 'Position', summary: 'Current market is flat' },
    { id: 'action', kind: 'action', type: 'execution.open_position', version: 1, title: 'Open position', summary: 'Open long' },
  ],
  edges: [
    { id: 'e1', source: 'trigger', sourcePort: 'activation', target: 'condition', targetPort: 'activation' },
    { id: 'e2', source: 'trigger', sourcePort: 'activation', target: 'condition-2', targetPort: 'activation' },
    { id: 'e3', source: 'condition', sourcePort: 'result', target: 'action', targetPort: 'condition' },
  ],
};

afterEach(() => { cleanup(); flow.props = undefined; });

describe('strategy graph', () => {
  it('projects deterministic left-to-right positions without mutating the revision', () => {
    const before = structuredClone(revision);
    const graph = buildStrategyGraph(revision);

    expect(graph.nodes.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: 'trigger', position: { x: 0, y: 0 } },
      { id: 'condition', position: { x: 320, y: 0 } },
      { id: 'condition-2', position: { x: 320, y: 150 } },
      { id: 'action', position: { x: 640, y: 0 } },
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ id: 'e1', source: 'trigger', target: 'condition' }),
      expect.objectContaining({ id: 'e2', source: 'trigger', target: 'condition-2' }),
      expect.objectContaining({ id: 'e3', source: 'condition', target: 'action' }),
    ]);
    expect(revision).toEqual(before);
  });

  it('renders a read-only selectable React Flow canvas with navigation aids', () => {
    const onSelectNode = vi.fn();
    render(<StrategyGraph revision={revision} onSelectNode={onSelectNode} />);

    expect(flow.props).toMatchObject({
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: true,
      fitView: true,
    });
    expect(screen.getByTestId('flow-controls')).toBeTruthy();
    expect(screen.getByTestId('flow-background')).toBeTruthy();
    expect(screen.getByTestId('flow-minimap')).toBeTruthy();
    expect(screen.getByText('All active perpetual markets')).toBeTruthy();
    expect(screen.getAllByTestId('strategy-node').map((node) => node.dataset.kind)).toEqual([
      'trigger', 'condition', 'condition', 'action',
    ]);
    expect(screen.queryByText('Market scope', { selector: '[data-testid="strategy-node"] *' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flow canvas' }));
    expect(onSelectNode).toHaveBeenCalledWith(revision.nodes[0]);
  });
});
