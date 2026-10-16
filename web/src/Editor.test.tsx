// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {Editor} from './Editor';
import {emptyRoute} from './model';
import {translator} from './i18n';
afterEach(cleanup);
it('keeps invalid geometry from being sent to the server',async()=>{
  const save=vi.fn();const d=emptyRoute();d.line='2';d.name='Test';
  render(<Editor document={d} setDocument={vi.fn()} previous={null} knownStops={[]} mode={null} setMode={vi.fn()} save={save} close={vi.fn()} t={translator('es')}/>);
  fireEvent.click(screen.getByRole('button',{name:'Guardar borrador'}));
  expect(save).not.toHaveBeenCalled();expect(await screen.findByRole('alert')).toBeTruthy();
});
it('sets exchange direction on the selected membership, without mutating input',()=>{
  const d=emptyRoute();d.geometry.coordinates=[[7.6,45],[7.61,45]];d.direction='ritorno';
  d.stops=[{id:crypto.randomUUID(),code:'10',name:'Stop',coordinates:[7.6,45],offsetM:0,exchange:false,exchangeDirection:null,notes:''}];
  const set=vi.fn();render(<Editor document={d} setDocument={set} previous={null} knownStops={[]} mode={null} setMode={vi.fn()} save={vi.fn()} close={vi.fn()} t={translator('it')}/>);
  fireEvent.click(screen.getByLabelText('Posto cambio'));
  expect(set.mock.calls[0][0].stops[0].exchangeDirection).toBe('ritorno');expect(d.stops[0].exchange).toBe(false);
});
it('requires an explicit change-post direction when the imported route direction is unconfirmed',()=>{
  const d=emptyRoute();d.geometry.coordinates=[[7.6,45],[7.61,45]];d.direction='none';
  d.stops=[{id:crypto.randomUUID(),code:'10',name:'Stop',coordinates:[7.6,45],offsetM:0,exchange:false,exchangeDirection:null,notes:''}];
  const set=vi.fn();render(<Editor document={d} setDocument={set} previous={null} knownStops={[]} mode={null} setMode={vi.fn()} save={vi.fn()} close={vi.fn()} t={translator('es')}/>);
  fireEvent.click(screen.getByLabelText('Posto cambio'));
  expect(set.mock.calls[0][0].stops[0].exchangeDirection).toBeNull();
});
