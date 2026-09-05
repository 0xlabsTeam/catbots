import { expect, it } from 'vitest';
import { toRendererSafeTraceDetails } from '../src/shared/trace-projection';

it('projects an omitted close percent as 100 through the shared Main/Preview/Paper boundary', () => {
  expect(toRendererSafeTraceDetails('action.proposed', {
    effect: { type: 'execution.close_position', market: 'BTC-PERP', config: {} },
  })).toEqual({ effect: { type: 'execution.close_position', market: 'BTC-PERP', config: { percent: 100 } } });
});

it.each([null, 0, -1, 101, '100'])('does not default an invalid explicit close percent %s', (percent) => {
  expect(toRendererSafeTraceDetails('action.proposed', {
    effect: { type: 'execution.close_position', market: 'BTC-PERP', config: { percent } },
  })).toEqual({});
});
