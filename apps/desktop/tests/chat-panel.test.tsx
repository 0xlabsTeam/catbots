// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../src/renderer/workbench/ChatPanel';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('Chat composer', () => {
  it('restores drafts separately for each bot', async () => {
    const user = userEvent.setup();
    const props = { messages: [], activity: null, sending: false, onSend: vi.fn() };
    const first = render(<ChatPanel {...props} botId="one" />);
    await user.type(screen.getByRole('textbox'), 'My rule');
    first.unmount();
    const second = render(<ChatPanel {...props} botId="two" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    second.unmount();
    render(<ChatPanel {...props} botId="one" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My rule');
  });

  it('offers Stop while running and retry only prepares the draft', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn(async () => undefined);
    const onSend = vi.fn(async () => { throw new Error('failed'); });
    const view = render(<ChatPanel messages={[]} activity={null} sending onSend={onSend} onStop={onStop} />);
    await user.click(screen.getByRole('button', { name: 'Stop agent' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    view.rerender(<ChatPanel messages={[]} activity={null} sending={false} onSend={onSend} onStop={onStop} />);
    await user.type(screen.getByRole('textbox'), 'Try this{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Review & retry' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Try this');
  });

  it('sends with Enter, preserves line breaks and does not send during IME composition', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<ChatPanel messages={[]} activity={null} sending={false} onSend={onSend} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'Entry');
    await user.keyboard('{Shift>}{Enter}{/Shift}Exit');
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('Entry\nExit');
  });

  it('keeps the next draft while the previous request completes', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSend = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<ChatPanel messages={[]} activity={null} sending={false} onSend={onSend} />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(input, 'First{Enter}');
    expect(input.value).toBe('');
    await user.type(input, 'Next{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByLabelText('Sending your message')).toBeNull());
    expect(input.value).toBe('Next');
  });

  it('fills suggestions without sending automatically', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel messages={[]} activity={null} sending={false} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: 'Explore building blocks' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('triggers');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('replaces transient streamed text with the saved reply and renders Kumo tables', () => {
    const props = { activity: null, onSend: vi.fn() };
    const view = render(<ChatPanel {...props} messages={[]} sending streamingText="Working on **entry**" />);
    expect(screen.getByLabelText('Agent response in progress').textContent).toContain('Working on entry');
    view.rerender(<ChatPanel {...props} sending={false} streamingText="Working on **entry**" messages={[{ id: 'done', botId: 'b', role: 'assistant', content: '| Rule | Value |\n| --- | --- |\n| RSI | 30 |', createdAt: '2026-09-06T00:00:00Z' }]} />);
    expect(screen.queryByLabelText('Agent response in progress')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Rule' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'RSI' })).toBeTruthy();
  });

  it('renders formatted responses without executing HTML or rendering remote images', () => {
    const { container } = render(<ChatPanel messages={[{id:'a',botId:'b',role:'assistant',content:'**Entry rule**\n\n- Funding below zero\n\n<script>alert(1)</script>\n\n![tracking](https://example.com/pixel)',createdAt:'2026-09-06T00:00:00Z'}]} activity={null} sending={false} onSend={vi.fn()} />);
    expect(container.querySelector('strong')?.textContent).toBe('Entry rule');
    expect(container.querySelector('li')?.textContent).toBe('Funding below zero');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.chat-prose img')).toBeNull();
  });
});
