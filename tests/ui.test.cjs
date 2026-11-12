// A small in-memory DOM double exercises actual event handlers in Node.
// It does not render a browser, measure layout, or validate native dialog behavior.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

class Element {
  constructor(tag,doc){this.tagName=tag;this.doc=doc;this.children=[];this.attrs={};this.events={};this.dataset={};this._text='';this._value=undefined;this.className='';this.hidden=false;this.disabled=false;this.open=false;}
  get id(){return this.attrs.id||'';} set id(v){this.attrs.id=v;}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(v){this._text=String(v);this.children=[];}
  append(...els){els.forEach(e=>{if(e.parent)e.parent.children=e.parent.children.filter(c=>c!==e);e.parent=this;this.children.push(e);});}
  replaceChildren(...els){this.children.forEach(c=>c.parent=null);this.children=[];this._text='';this.append(...els);}
  get value(){if(this.tagName==='select'){const match=this.children.find(o=>o.value===this._value);return match?match.value:this._value===undefined?(this.children[0]?.value||''):'';}return this._value??this.attrs.value??'';}
  set value(v){this._value=String(v);}
  get selectedIndex(){return this.children.findIndex(o=>o.value===this.value);}
  set selectedIndex(i){this._value=this.children[i]?.value;}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=v;if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;if(k==='hidden')this.hidden=true;if(k==='disabled')this.disabled=true;}
  getAttribute(k){return this.attrs[k];}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  fire(type){if(type==='click'&&this.disabled)return;for(const fn of this.events[type]||[])fn({target:this,preventDefault(){}});}
  focus(){this.doc.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){const result=[];for(const c of this.children){if(selector==='[data-close]'?c.dataset.close:selector===c.tagName)result.push(c);result.push(...c.querySelectorAll(selector));}return result;}
  get classList(){return {contains:k=>this.className.split(/\s+/).includes(k),toggle:k=>{const has=this.className.split(/\s+/).includes(k);this.className=has?this.className.split(/\s+/).filter(x=>x!==k).join(' '):this.className+' '+k;return !has;}};}
}
function boot(){
  const doc={createElement(tag){return new Element(tag,this);}};
  doc.root=new Element('root',doc);
  doc.getElementById=id=>{function find(el){if(el.id===id)return el;for(const c of el.children){const result=find(c);if(result)return result;}return null;}return find(doc.root);};
  doc.querySelectorAll=s=>doc.root.querySelectorAll(s);
  const source=html.match(/<body>([\s\S]*?)<script id="lockout-core">/)[1];
  const stack=[doc.root];
  for(const token of source.match(/<[^>]+>|[^<]+/g)){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token.startsWith('<')){
      const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;
      const el=doc.createElement(tag);
      for(const a of token.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){if(a[1]===tag)continue;el.setAttribute(a[1],a[2]??'');}
      stack.at(-1).append(el);
      if(!['input','br','hr','meta','link'].includes(tag))stack.push(el);
    }else stack.at(-1)._text+=token;
  }
  const context=vm.createContext({document:doc,window:{matchMedia:()=>({matches:false})}});
  for(const [,code] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))vm.runInContext(code,context);
  const get=id=>{const el=doc.getElementById(id);assert.ok(el,'Element exists: '+id);return el;};
  return {get,click:id=>get(id).fire('click'),submit:id=>get(id).fire('submit'),select:(id,v)=>{get(id).value=v;get(id).fire('change');},doc};
}

test('normal UI: sample entry, three actual apply handlers, undo, reset and all-accounts toggle',()=>{
  const {get,click}=boot();
  assert.equal(get('results').hidden,true);
  click('sample');
  assert.equal(get('before').textContent,'7');assert.equal(get('after').textContent,'1');
  assert.match(get('current').textContent,/7 Locked out · 1 Available · 1 Unknown/);
  click('fix-backup');assert.match(get('current').textContent,/4 Locked out · 4 Available/);
  click('fix-passkey');assert.match(get('current').textContent,/2 Locked out · 6 Available/);
  click('fix-independent');assert.match(get('current').textContent,/1 Locked out · 7 Available · 1 Unknown/);
  assert.equal(get('after-label').textContent,'After 3 applied fixes');
  click('fix-backup');assert.match(get('current').textContent,/4 Locked out · 4 Available/);
  click('undo');assert.match(get('current').textContent,/1 Locked out · 7 Available/);
  click('reset');assert.match(get('current').textContent,/7 Locked out · 1 Available/);
  click('view-all');assert.equal(get('view-all').getAttribute('aria-expanded'),'true');
});

test('ambiguous UI: opening challenge changes nothing, dismiss moves to Unknown, undo restores',()=>{
  const {get,click,submit}=boot();click('sample');click('challenge-bank');
  assert.equal(get('challenge-dialog').open,true);
  assert.match(get('current').textContent,/7 Locked out/);
  click('dismiss');assert.match(get('current').textContent,/6 Locked out · 1 Available · 2 Unknown/);
  click('undo');assert.match(get('current').textContent,/7 Locked out · 1 Available · 1 Unknown/);
  click('challenge-bank');submit('challenge-form');
  assert.match(get('current').textContent,/6 Locked out · 1 Available · 2 Unknown/);
});

test('normal UI: complete alternate path is added and can be undone',()=>{
  const {get,click,submit,select,doc}=boot();click('sample');click('challenge-bank');
  select('alternate-kind','backup');select('alternate-store','printed');submit('challenge-form');
  assert.match(get('current').textContent,/6 Locked out · 2 Available · 1 Unknown/);
  assert.equal(doc.activeElement.id,'undo');
  click('undo');assert.match(get('current').textContent,/7 Locked out · 1 Available/);
});

test('normal UI: own list, dynamic editor, confirmation, and template creation',()=>{
  const {get,click,submit,select}=boot();click('own');
  assert.match(get('current').textContent,/0 Locked out · 0 Available · 1 Unknown/);
  select('sign-kind','authenticator');select('recovery-kind','backup');select('recovery-store','phone');submit('edit-form');
  assert.match(get('current').textContent,/1 Locked out · 0 Available · 0 Unknown/);
  assert.match(get('fixes').textContent,/Rescues unconfirmed/);
  assert.equal(get('after').textContent,'?');assert.equal(get('after-label').textContent,'After fixes: Unknown');
  select('confirm-backup','yes');click('fix-backup');
  assert.match(get('current').textContent,/0 Locked out · 1 Available/);
  click('add-account');select('template','photos');submit('template-form');
  assert.match(get('identity').textContent,/2 accounts/);
  assert.equal(get('nickname').value,'Photos');assert.equal(get('sign-kind').value,'phone_passkey');
});

test('failure UI: reject contact-like nickname, undo last removal, and clear without stale fields',()=>{
  const {get,click,submit}=boot();click('own');get('nickname').value='someone@example.invalid';submit('edit-form');
  assert.equal(get('edit-error').hidden,false);
  click('cancel-edit');assert.equal(get('nickname').value,'Main email');
  click('delete-account');assert.equal(get('welcome').hidden,false);assert.equal(get('undo-empty').hidden,false);
  click('undo-empty');assert.equal(get('results').hidden,false);
  click('clear');assert.equal(get('welcome').hidden,false);assert.equal(get('nickname').value,'');assert.equal(get('undo-empty').hidden,true);
  click('own');assert.ok(get('sign-fields').querySelector('legend'));assert.ok(get('recovery-fields').querySelector('legend'));
  assert.equal(get('sign-kind').value,'unknown');
});
