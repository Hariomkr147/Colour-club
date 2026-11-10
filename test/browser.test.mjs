import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

test('background refresh preserves unchanged history nodes and updates changed results', () => {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '10', writes: 0, html: '',
      get innerHTML() { return this.html; },
      set innerHTML(value) { this.html = value; this.writes++; },
      classList: { toggle() {}, add() {} },
      addEventListener() {}, setAttribute() {},
    });
    return nodes.get(selector);
  }
  const context = createContext({
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} },
    sessionStorage: { getItem: () => null },
    performance: { now: () => 0 },
    fetch: () => new Promise(() => {}),
    AbortSignal, setInterval() {},
    location: { hash: '' },
  });
  runInContext(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  runInContext('state = {user: null, history: [], bets: []}; renderHistory()', context);
  const history = node('#history-content');
  const initial = history.writes;
  runInContext('renderHistory(); renderHistory()', context);
  assert.equal(history.writes, initial);
  runInContext("state.history = [{id:'30-1000',start:1000,result:3}]; renderHistory()", context);
  assert.equal(history.writes, initial + 1);
  assert.match(history.innerHTML, /3, green/);
  runInContext("historyTab='bets'; renderHistory()", context);
  const signedOut = history.writes;
  runInContext('renderHistory()', context);
  assert.equal(history.writes, signedOut);
  runInContext("state.user={id:1}; state.bets=[{room:30,selection:'GREEN',stake:1000,result:null,payout:null,created:1000}]; renderHistory()", context);
  const pending = history.writes;
  runInContext('renderHistory()', context);
  assert.equal(history.writes, pending);
  runInContext('state.bets[0].result=3; state.bets[0].payout=2000; renderHistory()', context);
  assert.equal(history.writes, pending + 1);
  assert.match(history.innerHTML, /20 pts/);
});
