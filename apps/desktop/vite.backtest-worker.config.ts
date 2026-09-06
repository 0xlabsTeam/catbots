import { defineConfig } from 'vite';
export default defineConfig({build:{lib:{entry:'src/main/backtest/flow-backtest-worker.ts',fileName:'flow-backtest-worker',formats:['cjs']},rollupOptions:{external:['node:worker_threads']}}});
