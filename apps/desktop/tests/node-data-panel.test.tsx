// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NodeDataPanel, observedFields } from '../src/renderer/workbench/NodeDataPanel';
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('pages records without dropping data from JSON and navigates to the input source', () => {
  const navigate = vi.fn();
  const value = Array.from({length: 43}, (_,index) => ({label:`record-${index}`, close:index}));
  render(<NodeDataPanel direction="input" onSelectNode={navigate} ports={[{name:'candles',type:'candles',value:{type:'candles',quality:'ready',value},connections:[{nodeId:'source',label:'Market candles',port:'candles'}]}]} />);
  expect(screen.getAllByRole('row')).toHaveLength(21);
  expect(screen.queryByText('record-20')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Next records'}));
  expect(screen.getByText('record-20')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'JSON'}));
  expect(document.querySelector('pre')?.textContent).toContain('record-42');
  fireEvent.click(screen.getByRole('button',{name:'From Market candles · candles'}));
  expect(navigate).toHaveBeenCalledWith('source');
});
it('shows unknown results distinctly from false and zero values', () => {
  const {rerender} = render(<NodeDataPanel direction="output" ports={[{name:'result',type:'condition',value:{type:'condition',quality:'ready',value:false},connections:[]}]} />);
  expect(screen.getByText('false')).toBeTruthy();
  rerender(<NodeDataPanel direction="output" ports={[{name:'result',type:'condition',value:{type:'condition',quality:'unavailable',value:null,reason:'Insufficient candles'},connections:[]}]} />);
  expect(screen.getByText('Insufficient candles')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});
it('describes nested fields without flattening away their data types', () => {
  expect(observedFields({price: 0, position: null, fills: [{quantity:1}]})).toContainEqual({path:'$.fills[0].quantity',type:'number'});
  expect(observedFields({position: null})).toContainEqual({path:'$.position',type:'null'});
});
