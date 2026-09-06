import { parentPort, workerData } from 'node:worker_threads';
import { replayFlowBacktest } from '@catbots/strategy-runtime';
try {
  const result=replayFlowBacktest(workerData.document,workerData.settings,workerData.data,progress=>parentPort?.postMessage({progress}));
  parentPort?.postMessage({result});
} catch(error){parentPort?.postMessage({error:error instanceof Error?error.message:'Replay failed'});}
