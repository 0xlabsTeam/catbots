# SOL 1m directional research — 6 September 2026

Status: **not profitable; research only, no live deployment**.

The packaged `strategy.directional` node owns one net position, accepts either direction, waits for confirmed fills, handles partial fills/cancellations, and emits reduce-only exits. It uses fixed quote sizing, EMA/RSI direction, entry ATR for close-based exits, a maximum holding time and cooldown. The controller can run on Testnet with backend exits at each evaluation while the app remains open. Mainnet remains blocked until exchange-native protection support is implemented. Stopping the app/bot leaves positions open. Research results below use the original $100 order size; the user-authorized Testnet configuration later uses $15 with a $20 order limit.

## Experiment

27 predeclared combinations: EMA (5/13, 9/21, 12/36), RSI thresholds (50,55,60), reward/risk (1.5,2,3). All use ATR14, stop 2 ATR, minimum ATR 0.08%, 30 minute maximum hold, 5 minute cooldown, $100 orders on $1,000 initial capital.

Source: Hyperliquid Mainnet closed candles and historical funding. Range: 2026-09-03 16:00 UTC to 2026-09-06 16:00 UTC. First 48 hours for ranking; final 24 hours tested once after freezing the selected parameters. No candidate was profitable in training. The saved candidate is the least losing eligible candidate, not a successful strategy.

Costs: 4.5 bps fee per fill, 2 bps adverse slippage per fill. Stress: 5 bps slippage. The replay uses next-bar fills; ATR stops are evaluated at candle closes, not exchange-native intrabar triggers. No leverage, liquidation, lot-size or order-book model. Final equity includes any open position marked to the last close.

| Period | Net USDC | Return | Closed trades | Long / short entries |
| --- | ---: | ---: | ---: | ---: |
| Training | -9.3627 | -0.9363% | 36 | 13 / 23 |
| Holdout | -5.0623 | -0.5062% | 27 | 19 / 9 |
| Holdout, higher slippage | -5.5048 | -0.5505% | 29 | 19 / 10 |

The ordinary holdout ends with a simulated open long; its mark-to-market value is included, without a final liquidation fee. The stress run ends flat. This small recent sample is insufficient to establish long-term profitability. Testnet execution would not establish Mainnet profitability either.

`report.json` retains every candidate and selection methodology; `workflow.json` is the saved strategy. `scripts/research/sol-1m.ts` reruns the experiment over the most recent 72 hours, using the production replay and cached loader, and writes the dataset and results to `/tmp/catbots-sol1m-research`. Re-running later uses different dates and must be treated as a new experiment.
