import { useState, type FormEvent } from 'react';
import { Button, LayerCard, Textarea } from '@cloudflare/kumo';
import { PaperPlaneRightIcon, SparkleIcon } from '@phosphor-icons/react';
import type { AgentToolActivity, ChatMessage } from '@catbots/contracts';

export type ChatPanelProps = Readonly<{
  messages: readonly ChatMessage[];
  activity: AgentToolActivity | null;
  sending: boolean;
  onSend(message: string): Promise<void>;
}>;

export function ChatPanel({ messages, activity, sending, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || sending) return;
    setDraft('');
    void onSend(message);
  };
  return (
    <LayerCard render={<section aria-labelledby="chat-panel-title" />} className="chat-panel">
      <header><p className="eyebrow">DESIGN WITH AI</p><h2 id="chat-panel-title">Chat</h2></header>
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty"><SparkleIcon aria-hidden="true" size={24} /><p>Describe the trigger, conditions, risk limits, and action you want.</p></div>
        ) : messages.map((message) => (
          <article key={message.id} className={`chat-message chat-message-${message.role}`}>
            <span>{message.role === 'assistant' ? 'Catbots AI' : 'You'}</span>
            <p>{message.content}</p>
          </article>
        ))}
        {activity === null ? null : <p className="agent-activity" role="status"><SparkleIcon aria-hidden="true" /> {activity.message}</p>}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <Textarea
          label="Message Catbots AI"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Example: Every hour, go long when ETF flow is positive and RSI is below 30…"
          minRows={3}
          maxRows={7}
          autoResize
          disabled={sending}
        />
        <Button type="submit" variant="primary" icon={PaperPlaneRightIcon} loading={sending} disabled={sending || draft.trim().length === 0}>Send</Button>
      </form>
    </LayerCard>
  );
}
