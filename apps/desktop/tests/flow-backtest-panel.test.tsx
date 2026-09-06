// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import type {ChatFlowDraft,FlowBacktestJob} from '@catbots/contracts';
import {FlowBacktestPanel} from '../src/renderer/workbench/FlowBacktestPanel';
beforeEach(()=>{sessionStorage.clear();Element.prototype.scrollIntoView=vi.fn();vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const draft:ChatFlowDraft={botId:'00000000-0000-4000-8000-000000000001',version:4,status:'valid',updatedAt:new Date().toISOString(),document:{schemaVersion:'3.0',nodes:[],edges:[]}};
const job:FlowBacktestJob={id:'00000000-0000-4000-8000-000000000002',botId:draft.botId,version:4,status:'loading',progress:0,cacheHit:false};
it('starts a pinned flow job and reports provider coverage failures without sample fallback',async()=>{
  const command=vi.fn(async(input:any)=>({packages:[],backtest:input.action==='backtest_flow'?job:{...job,status:'failed' as const,error:'History is incomplete'}}));
  render(<FlowBacktestPanel draft={draft} api={{command}}/>);fireEvent.click(screen.getByRole('button',{name:'Run historical backtest'}));
  await screen.findByText('History is incomplete');expect(command.mock.calls[0][0]).toMatchObject({action:'backtest_flow',botId:draft.botId,version:4,settings:{market:'ETH-PERP',timeframe:'1h'}});expect(screen.queryByText('Final equity')).toBeNull();
});
it('resumes a stored job and sends cancellation through the node API',async()=>{
  sessionStorage.setItem(`catbots.backtest-job:${draft.botId}`,job.id);
  const command=vi.fn(async(input:any)=>({packages:[],backtest:input.action==='cancel_backtest'?{...job,status:'cancelled' as const}:job}));
  render(<FlowBacktestPanel draft={draft} api={{command}}/>);fireEvent.click(await screen.findByRole('button',{name:'Cancel backtest'}));
  await waitFor(()=>expect(command).toHaveBeenCalledWith({action:'cancel_backtest',botId:draft.botId,jobId:job.id}));
});
it('blocks runs when configurations are unsaved',()=>{
  render(<FlowBacktestPanel draft={draft} disabled api={{command:vi.fn()}}/>);expect((screen.getByRole('button',{name:'Run historical backtest'}) as HTMLButtonElement).disabled).toBe(true);
});
