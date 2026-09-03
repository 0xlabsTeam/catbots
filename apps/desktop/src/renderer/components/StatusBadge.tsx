import { Badge, type BadgeVariant } from '@cloudflare/kumo';
import type { BotStatus } from '@catbots/contracts';

const statusPresentation: Record<BotStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'neutral' },
  paper: { label: 'Paper', variant: 'success' },
  live: { label: 'Live', variant: 'error' },
  paused: { label: 'Paused', variant: 'warning' },
  stopped: { label: 'Stopped', variant: 'neutral' },
  error: { label: 'Error', variant: 'error' },
  recovering: { label: 'Recovering', variant: 'warning' },
};

export function StatusBadge({ status }: { status: BotStatus }) {
  const presentation = statusPresentation[status];
  return <Badge variant={presentation.variant} appearance="dot">{presentation.label}</Badge>;
}
