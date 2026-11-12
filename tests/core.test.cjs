const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const core = html.match(/<script id="lockout-core">([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({});
vm.runInContext(core + '\nthis.model = Lockout;', context);
const M = context.model;
const plain = x => JSON.parse(JSON.stringify(x));
const counts = data => plain(M.evaluate(data).counts);
const account = (id, methods) => ({ id, name: id, methods });
const status = data => M.evaluate(data).accounts.map(a => a.status).join(',');
const m = (kind, extra = {}) => ({ kind, ...extra });

test('normal: fictional sample gives 7 → 4 → 2 → 1, with Unknown separate', () => {
  let data = M.sample();
  const expected = [
    { locked: 7, available: 1, unknown: 1 },
    { locked: 4, available: 4, unknown: 1 },
    { locked: 2, available: 6, unknown: 1 },
    { locked: 1, available: 7, unknown: 1 }
  ];
  assert.deepEqual(counts(data), expected[0]);
  const fixes = M.proposals(data);
  fixes.forEach((fix, i) => {
    const before = M.evaluate(data);
    data = M.apply(data, fix, true);
    assert.deepEqual(counts(data), expected[i + 1]);
    assert.equal(M.rescued(before, M.evaluate(data)), [3, 2, 1][i]);
  });
  assert.equal(M.evaluate(data).accounts.find(a => a.id === 'bank').status, 'Locked out');
  assert.equal(M.evaluate(data).accounts.find(a => a.id === 'wallet').status, 'Unknown');
});

test('normal: all six application orders reach the same final result', () => {
  const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for (const order of permutations) {
    const base = M.sample(), fixes = M.proposals(base);
    let data = base, rescued = 0;
    for (const i of order) {
      const before = M.evaluate(data);
      data = M.apply(data, fixes[i], true);
      rescued += M.rescued(before, M.evaluate(data));
    }
    assert.deepEqual(counts(data), { locked: 1, available: 7, unknown: 1 });
    assert.equal(rescued, 6);
  }
});

test('normal: phone present is a separate scenario, not the displayed Before', () => {
  assert.deepEqual(plain(M.evaluate(M.sample(), { phoneLost: false }).counts), { locked: 0, available: 8, unknown: 1 });
});

test('normal: fixed point follows a reversed multi-account recovery chain', () => {
  const data = [
    account('third', [m('email', { dependency: 'second', secondFactor: 'none' })]),
    account('second', [m('email', { dependency: 'first', secondFactor: 'none' })]),
    account('first', [m('passphrase')])
  ];
  assert.equal(status(data), 'Available,Available,Available');
});

test('normal: removing a fix and resetting reconstruct the original result', () => {
  const base = M.sample(), original = JSON.stringify(base), fixes = M.proposals(base);
  const all = fixes.reduce((d,f) => M.apply(d,f,true), base);
  assert.equal(counts(all).locked, 1);
  const withoutBackup = fixes.slice(1).reduce((d,f) => M.apply(d,f,true), base);
  assert.equal(counts(withoutBackup).locked, 4);
  assert.equal(counts(base).locked, 7);
  assert.equal(JSON.stringify(base), original, 'input is never mutated');
});

test('ambiguous: jobs requires email AND the phone factor', () => {
  const base = M.sample(), data = M.apply(base, M.proposals(base)[0], true);
  const jobs = M.evaluate(data).accounts.find(a => a.id === 'jobs');
  assert.equal(jobs.status, 'Locked out');
  assert.match(jobs.chain, /AND second factor on Phone/);
  assert.equal(M.evaluate(data).accounts.find(a => a.id === 'email').status, 'Available');
});

test('ambiguous: pure dependency cycles are Unknown; a real independent path resolves them', () => {
  const data = [account('a',[m('email',{dependency:'b',secondFactor:'none'})]),account('b',[m('email',{dependency:'a',secondFactor:'none'})])];
  assert.equal(status(data), 'Unknown,Unknown');
  assert.equal(status(M.alternate(data,'b',m('passphrase'))), 'Available,Available');
  assert.equal(status([account('a',[m('email',{dependency:'a',secondFactor:'none'})])]), 'Unknown');
});

test('ambiguous: failed path plus unspecified path remains Unknown', () => {
  assert.equal(status([account('a',[m('sms'),m('unknown')])]), 'Unknown');
  assert.equal(status([account('a',[m('passphrase'),m('unknown')])]), 'Available');
});

test('ambiguous: dismissed flag is not a rescue; a complete alternate path may be', () => {
  const base = M.sample(), before = M.evaluate(base);
  const dismissed = M.alternate(base,'bank',null);
  assert.deepEqual(counts(dismissed), { locked: 6, available: 1, unknown: 2 });
  assert.equal(M.rescued(before,M.evaluate(dismissed)), 0);
  const unconfirmed = M.alternate(base,'bank',m('other'));
  assert.equal(M.evaluate(unconfirmed).accounts[0].status, 'Unknown');
  const supplied = M.alternate(base,'bank',m('backup',{store:'printed'}));
  assert.equal(M.evaluate(supplied).accounts[0].status, 'Available');
  assert.equal(M.rescued(before,M.evaluate(supplied)), 1);
  assert.equal(counts(base).locked, 7);
});

test('ambiguous: synced or inaccessible other device does not imply Available', () => {
  for (const attrs of [{},{exists:true},{exists:true,independent:'unknown'}]) {
    assert.equal(status([account('a',[m('device_passkey',attrs)])]), 'Unknown');
  }
  assert.equal(status([account('a',[m('device_passkey',{exists:true,independent:false})])]), 'Locked out');
  assert.equal(status([account('a',[m('device_passkey',{exists:true,independent:true})])]), 'Available');
});

test('ambiguous: manager needs both accessible storage and an unlock method', () => {
  assert.equal(status([account('a',[m('manager',{store:'device',independent:true,unlock:'unknown'})])]), 'Unknown');
  assert.equal(status([account('a',[m('manager',{store:'device',independent:true,unlock:'phone'})])]), 'Locked out');
  assert.equal(status([account('a',[m('manager',{store:'device',independent:true,unlock:'memorized'})])]), 'Available');
  assert.equal(status([account('a',[m('manager',{store:'device',independent:true,unlock:'account',dependency:'a'})])]), 'Unknown');
  assert.equal(status([account('a',[m('manager',{store:'printed',unlock:'memorized'})])]), 'Unknown');
});

test('ambiguous: unconfirmed proposals do not rescue accounts', () => {
  const base = M.sample(), fixes = M.proposals(base);
  const after = fixes.reduce((d,f)=>M.apply(d,f,false),base);
  assert.deepEqual(counts(after), {locked:1,available:1,unknown:7});
  assert.equal(M.rescued(M.evaluate(base),M.evaluate(after)),0);
});

test('ambiguous: overlapping and repeated fixes do not double-count rescued accounts', () => {
  const base = [account('a',[m('phone_passkey'),m('backup',{store:'phone'})])];
  const fixes = M.proposals(base);
  const once = M.apply(base,fixes[0],true), twice = M.apply(once,fixes[1],true);
  assert.equal(M.rescued(M.evaluate(base),M.evaluate(once)),1);
  assert.equal(M.rescued(M.evaluate(once),M.evaluate(twice)),0);
  assert.equal(M.rescued(M.evaluate(once),M.evaluate(M.apply(once,fixes[0],true))),0);
});

test('failure: invalid collections and duplicate identifiers return an explicit error', () => {
  for (const data of [null,{},[null],[{id:'a'}],[account('a',[]),account('a',[])]]) {
    const result = M.evaluate(data);
    assert.equal(result.ok,false);
    assert.equal(result.counts.available,0);
    assert.match(result.error,/Invalid/);
  }
});

test('failure: malformed, empty, unsupported, or incomplete methods remain Unknown', () => {
  for (const methods of [null,{},[],[null],[{}],[m('future-method')],[m('backup')],[m('email',{dependency:'missing',secondFactor:'none'})]]) {
    assert.equal(status([account('a',methods)]),'Unknown');
  }
  assert.equal(status([account('a',[m('email',{dependency:'removed',secondFactor:'none'})])]),'Unknown');
});

test('failure: special internal keys cannot inherit a working dependency', () => {
  assert.equal(status([account('a',[m('email',{dependency:'toString',secondFactor:'none'})])]),'Unknown');
  assert.equal(status([account('__proto__',[m('passphrase')]),account('a',[m('email',{dependency:'__proto__',secondFactor:'none'})])]),'Available,Available');
});

test('offline artifact: no external loads, network APIs, persistent storage, or inline event attributes', () => {
  assert.doesNotMatch(html, /<(?:script|img|iframe|link)[^>]+(?:src|href)\s*=/i);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\s*[.(]/);
  assert.doesNotMatch(html, /\son(?:click|change|submit|load)\s*=/i);
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/Nothing leaves your device\. No sign-up\. No cost\./);
  assert.match(html,/<html lang="en">/);
  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('static accessibility: unique IDs, explicit input labels, dialog names and live status', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const [,id] of html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)) assert.ok(html.includes('for="'+id+'"'));
  assert.match(html,/role="status" aria-live="polite"/);
  assert.match(html,/<dialog[^>]+aria-labelledby=/);
  assert.match(html,/:focus-visible/);
  assert.match(html,/@media\(max-width:700px\)/);
});

test('static accessibility: all three text colors exceed 4.5:1 on white', () => {
  function luminance(hex) {
    const channels=hex.match(/../g).map(s=>parseInt(s,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  }
  for(const name of ['text','muted','blue']) {
    const hex=html.match(new RegExp('--'+name+':#([0-9a-f]{6})'))[1];
    assert.ok(1.05/(luminance(hex)+.05)>=4.5,name+' contrast');
  }
});
