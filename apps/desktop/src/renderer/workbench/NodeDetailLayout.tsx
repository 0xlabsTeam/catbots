import { useState, type ReactNode } from 'react';
import { Tabs } from '@cloudflare/kumo';
/** Shared n8n-style detail layout for packaged and legacy nodes, with one pane on small screens. */
export function NodeDetailLayout({ header, input, parameters, output, footer }: { header: ReactNode; input: ReactNode; parameters: ReactNode; output: ReactNode; footer?: ReactNode }) {
  const [panel, setPanel] = useState('parameters');
  return <section className={`node-detail-layout node-detail-show-${panel}`}>
    {header}
    <div className="node-detail-mobile-tabs"><Tabs value={panel} onValueChange={setPanel} tabs={[{ value: 'input', label: 'Input' }, { value: 'parameters', label: 'Parameters' }, { value: 'output', label: 'Output' }]} /></div>
    <div className="node-detail-panes"><div className="node-detail-input">{input}</div><div className="node-detail-parameters">{parameters}</div><div className="node-detail-output">{output}</div></div>
    {footer}
  </section>;
}
