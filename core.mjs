/* Pure model: no DOM, storage, network, clock, randomness, or mutation of inputs. */
const Lockout = (() => {
  const kinds = ['authenticator','sms','phone_passkey','backup','email','passphrase','manager','other','unknown','device_passkey'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const method = (kind, extra = {}) => ({kind, ...extra});
  const account = (id, name, methods) => ({id, name, methods});
  function sample() {
    return [
      account('bank','Bank',[method('sms')]),
      account('school','School portal',[method('authenticator'),method('backup',{store:'phone'})]),
      account('email','Main email',[method('authenticator'),method('backup',{store:'phone'})]),
      account('code','Code host',[method('authenticator'),method('backup',{store:'phone'})]),
      account('notes','Cloud notes',[method('phone_passkey')]),
      account('photos','Photos',[method('phone_passkey')]),
      account('jobs','Student jobs',[method('email',{dependency:'email',secondFactor:'phone'})]),
      account('library','Library',[method('passphrase')]),
      account('wallet','Wallet',[method('unknown')])
    ];
  }
  const and = values => values.includes(false) ? false : values.every(v=>v===true) ? true : null;
  const or = values => values.includes(true) ? true : values.length && values.every(v=>v===false) ? false : null;
  function evaluate(input, options = {}) {
    const phoneLost = options.phoneLost !== false;
    const invalid = !Array.isArray(input) || input.some(a=>!a || typeof a.id!=='string' || !a.id || typeof a.name!=='string') || new Set((Array.isArray(input)?input:[]).map(a=>a?.id)).size !== (Array.isArray(input)?input.length:0);
    if (invalid) return {ok:false,error:'Invalid or duplicate account identifiers. The model cannot establish a result.',accounts:[],counts:{locked:0,available:0,unknown:Array.isArray(input)?input.length:0}};
    const data = input;
    let states = Object.fromEntries(data.map(a=>[a.id,null]));
    const names = Object.fromEntries(data.map(a=>[a.id,a.name]));
    const dependency = id => Object.hasOwn(states,id) ? states[id] : null;
    const store = m => m.store==='phone' ? !phoneLost : m.store==='printed' ? true : m.store==='device' ? m.independent===true ? true : m.independent===false ? false : null : null;
    function route(m) {
      if (!m || typeof m!=='object' || !kinds.includes(m.kind) || m.confirmed===false) return null;
      switch(m.kind) {
        case 'authenticator': case 'sms': case 'phone_passkey': return !phoneLost;
        case 'backup': return store(m);
        case 'passphrase': return true;
        case 'email': return and([dependency(m.dependency), m.secondFactor==='phone' ? !phoneLost : m.secondFactor==='none' ? true : null]);
        case 'device_passkey': return m.exists===false ? false : m.exists===true ? (m.independent===true ? true : m.independent===false ? false : null) : null;
        case 'manager': return and([m.store==='phone'||m.store==='device'?store(m):null,m.unlock==='memorized' ? true : m.unlock==='phone' ? !phoneLost : m.unlock==='account' ? dependency(m.dependency) : null]);
        case 'other': return m.supported===true ? (m.independent===true ? true : m.independent===false ? false : null) : null;
        default: return null;
      }
    }
    function value(a) {
      if (!Array.isArray(a.methods)) return null;
      return or([...a.methods.map(route), ...(a.unverified ? [null] : [])]);
    }
    // Start unknown; propagate only justified facts. Unresolved cycles stay unknown.
    for(let pass=0;pass<=data.length;pass++) {
      const next = Object.fromEntries(data.map(a=>[a.id,value(a)]));
      if(data.every(a=>next[a.id]===states[a.id])) break;
      states=next;
    }
    const status = v => v===true?'Available':v===false?'Locked out':'Unknown';
    function describe(m) {
      if(!m || typeof m!=='object') return 'Incomplete method';
      const location = m.store==='phone'?'Phone':m.store==='printed'?'Printed copy off phone':m.store==='device'?'Another device'+(m.independent===true?' (independent)':m.independent===false?' (not independently accessible)':' (access unconfirmed)'):'Storage unknown';
      let text;
      switch(m.kind) {
        case 'authenticator':text='Authenticator ← Phone';break;
        case 'sms':text='SMS ← Phone';break;
        case 'phone_passkey':text='Passkey ← Phone';break;
        case 'backup':text='Backup codes ← '+location;break;
        case 'passphrase':text='Memorized passphrase';break;
        case 'email':text='Recovery email ← '+(names[m.dependency] || 'Unspecified account')+' AND '+(m.secondFactor==='phone'?'second factor on Phone':m.secondFactor==='none'?'no additional factor required':'second-factor requirements unknown');break;
        case 'device_passkey':text='Passkey ← Another device ('+(m.exists===false?'no device':m.exists!==true?'device unconfirmed':m.independent===true?'independently accessible':m.independent===false?'not independently accessible':'access unconfirmed')+')';break;
        case 'manager':text='Login manager ← '+location+' AND unlock via '+(m.unlock==='memorized'?'memorized passphrase':m.unlock==='phone'?'Phone':m.unlock==='account'?(names[m.dependency]||'unspecified account'):'unknown method');break;
        case 'other':text='Other recovery path ('+(m.supported===true?'service support confirmed':'service support unconfirmed')+'; '+(m.independent===true?'independent':m.independent===false?'not independent':'independence unknown')+')';break;
        default:text='Recovery method not specified';
      }
      return text+(m.confirmed===false?' · unconfirmed assumption':'');
    }
    const accounts = data.map(a=>{
      const methods=Array.isArray(a.methods)?a.methods:[];
      const paths=methods.map(m=>({text:describe(m),status:status(route(m))}));
      if(!paths.length) paths.push({text:'No complete method supplied',status:'Unknown'});
      if(a.unverified) paths.push({text:'Flag dismissed; alternate path not supplied',status:'Unknown'});
      const s=status(states[a.id]);
      const best=paths.find(p=>p.status===s)||paths[0];
      return {id:a.id,name:a.name,status:s,chain:a.name+' ← '+best.text,paths,explanation:s==='Available'?'At least one complete modeled path works without the missing phone. Real recovery has not been verified.':s==='Locked out'?'All supplied paths are blocked in this model. An unlisted service recovery option could change this result.':'A path is missing, unconfirmed, or depends on an unresolved cycle. This is not a safe result.'};
    });
    return {ok:true,accounts,counts:{locked:accounts.filter(a=>a.status==='Locked out').length,available:accounts.filter(a=>a.status==='Available').length,unknown:accounts.filter(a=>a.status==='Unknown').length}};
  }
  function proposals(data) {
    const has = (a,fn) => Array.isArray(a.methods) && a.methods.some(m=>m && fn(m));
    return [
      {id:'backup',title:'Store backup codes off your phone',targets:data.filter(a=>has(a,m=>m.kind==='backup'&&m.store==='phone')).map(a=>a.id)},
      {id:'passkey',title:'Add a passkey on another device',targets:data.filter(a=>has(a,m=>m.kind==='phone_passkey')).map(a=>a.id)},
      {id:'independent',title:'Add independent recovery',targets:data.filter(a=>has(a,m=>m.kind==='email'&&m.secondFactor==='phone')).map(a=>a.id)}
    ];
  }
  function apply(data,fix,confirmed) {
    const next=copy(data);
    for(const a of next) {
      if(!fix.targets.includes(a.id)) continue;
      const m=fix.id==='backup'?method('backup',{store:'printed',confirmed:confirmed===true}):fix.id==='passkey'?method('device_passkey',{exists:true,independent:true,confirmed:confirmed===true}):fix.id==='independent'?method('other',{supported:true,independent:true,confirmed:confirmed===true}):null;
      if(m) a.methods.push(m);
    }
    return next;
  }
  function alternate(data,id,path) {
    const next=copy(data),a=next.find(a=>a.id===id);
    if(a) { if(path) a.methods.push(copy(path)); else a.unverified=true; }
    return next;
  }
  function rescued(before,after) {
    return after.accounts.filter(a=>a.status==='Available'&&before.accounts.some(b=>b.id===a.id&&b.status==='Locked out')).length;
  }
  // The public boundary accepts metadata only. Optional facts may be omitted;
  // the evaluator then retains Unknown instead of inventing a working path.
  const tri = {enum:[true,false,'unknown']};
  const identifier = {type:'string',minLength:1,maxLength:48,pattern:'^[A-Za-z0-9_-]+$'};
  const closed = (properties,required) => ({type:'object',properties,required,additionalProperties:false});
  const methodProperties = {
    authenticator:{}, sms:{}, phone_passkey:{}, passphrase:{}, unknown:{},
    backup:{store:{enum:['phone','printed','device','unknown']},independent:tri},
    email:{dependency:identifier,secondFactor:{enum:['phone','none','unknown']}},
    device_passkey:{exists:tri,independent:tri},
    manager:{store:{enum:['phone','device','unknown']},independent:tri,unlock:{enum:['memorized','phone','account','unknown']},dependency:identifier},
    other:{supported:tri,independent:tri}
  };
  const inventorySchema = {
    $schema:'https://json-schema.org/draft/2020-12/schema',
    title:'Lockout Drill metadata inventory',
    description:'Use fictional nicknames and local identifiers only. Never supply credentials, contact details, codes or secret values. References are local account IDs; missing references remain Unknown.',
    type:'array',maxItems:200,
    items:closed({
      id:identifier,
      name:{type:'string',minLength:1,maxLength:64,pattern:'^(?!.*(?:@|[0-9]{5}|[Hh][Tt][Tt][Pp][Ss]?:|[Ww][Ww][Ww]\\.))[^\\r\\n\\t]+$'},
      methods:{type:'array',maxItems:16,items:{oneOf:Object.entries(methodProperties).map(([kind,props]) => closed({kind:{const:kind},...props,confirmed:{type:'boolean'}},['kind']))}},
      unverified:{type:'boolean'}
    },['id','name','methods'])
  };
  // Implements only the JSON Schema vocabulary used by this module's schemas.
  // It is deliberately not a general-purpose JSON Schema implementation.
  function matches(value,schema) {
    if(schema.oneOf && schema.oneOf.filter(s=>matches(value,s)).length!==1) return false;
    if(schema.enum && !schema.enum.includes(value)) return false;
    if(Object.hasOwn(schema,'const') && value!==schema.const) return false;
    if(schema.type==='object') {
      if(!value || typeof value!=='object' || Array.isArray(value)) return false;
      if(schema.required?.some(k=>!Object.hasOwn(value,k))) return false;
      if(schema.additionalProperties===false && Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k))) return false;
      return Object.entries(schema.properties).every(([k,s])=>!Object.hasOwn(value,k)||matches(value[k],s));
    }
    if(schema.type==='array') return Array.isArray(value) && (schema.maxItems===undefined || value.length<=schema.maxItems) && value.every(v=>matches(v,schema.items));
    if(schema.type==='string') return typeof value==='string' && (schema.minLength===undefined || [...value].length>=schema.minLength) && (schema.maxLength===undefined || [...value].length<=schema.maxLength) && (!schema.pattern || new RegExp(schema.pattern).test(value));
    if(schema.type==='boolean') return typeof value==='boolean';
    if(schema.type==='integer') return Number.isSafeInteger(value) && (schema.minimum===undefined || value>=schema.minimum);
    return true;
  }
  function failure(code,message) { return {ok:false,error:{code,message}}; }
  function validateInventory(input) {
    if(!matches(input,inventorySchema) || new Set(input.map(a=>a.id)).size!==input.length)
      return failure('INVALID_INVENTORY','Inventory must match the metadata schema with unique local account IDs. Use fictional nicknames and method types only.');
    return {ok:true};
  }
  function analyzeLockout(input,lose='phone') {
    if(lose!=='phone') return failure('INVALID_ARGUMENTS','Only the phone loss scenario is supported.');
    const validation=validateInventory(input);
    if(!validation.ok) return validation;
    return {...evaluate(input),scenario:'phone'};
  }
  function suggestFixes(input) {
    const before=analyzeLockout(input);
    if(!before.ok) return before;
    const assumptions={
      backup:['The service accepts these backup codes and a usable printed copy is accessible without the phone.'],
      passkey:['The service supports this passkey and another enrolled device is accessible independently of the lost phone.'],
      independent:['The service supports a complete recovery path that is accessible without the phone or recovery email.']
    };
    const fixes=proposals(input).filter(f=>f.targets.length).map(f=>{
      const after=evaluate(apply(input,f,true));
      return {...f,rescued:rescued(before,after),countsAfter:after.counts,conditional:true,assumptions:assumptions[f.id]};
    }).sort((a,b)=>b.rescued-a.rescued);
    return {ok:true,scenario:'phone',counts:before.counts,fixes};
  }
  const countSchema=closed(Object.fromEntries(['locked','available','unknown'].map(k=>[k,{type:'integer',minimum:0}])),['locked','available','unknown']);
  const statusSchema={enum:['Available','Locked out','Unknown']};
  const textSchema={type:'string'};
  const accountSchema=closed({id:textSchema,name:textSchema,status:statusSchema,chain:textSchema,paths:{type:'array',items:closed({text:textSchema,status:statusSchema},['text','status'])},explanation:textSchema},['id','name','status','chain','paths','explanation']);
  const resultProperties={ok:{const:true},scenario:{const:'phone'},counts:countSchema};
  const analysisOutputSchema=closed({...resultProperties,accounts:{type:'array',items:accountSchema}},['ok','scenario','counts','accounts']);
  const fixesOutputSchema=closed({...resultProperties,fixes:{type:'array',items:closed({id:{enum:['backup','passkey','independent']},title:textSchema,targets:{type:'array',items:textSchema},rescued:{type:'integer',minimum:0},countsAfter:countSchema,conditional:{const:true},assumptions:{type:'array',items:textSchema}},['id','title','targets','rescued','countsAfter','conditional','assumptions'])}},['ok','scenario','counts','fixes']);
  const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const tools=[
    {name:'analyze_lockout',description:'Simulate phone loss using fictional method metadata. Unknown is not safe; real recovery is unverified.',inputSchema:closed({inventory:inventorySchema,lose:{const:'phone',default:'phone'}},['inventory']),outputSchema:analysisOutputSchema,annotations},
    {name:'suggest_fixes',description:'Rank conditional recovery proposals by independently rescued locked accounts. Do not add overlapping counts or treat assumptions as verified.',inputSchema:closed({inventory:inventorySchema},['inventory']),outputSchema:fixesOutputSchema,annotations}
  ];
  function callTool(name,args) {
    const tool=tools.find(t=>t.name===name);
    if(!tool || !matches(args,tool.inputSchema)) return failure('INVALID_ARGUMENTS','Arguments must match the tool metadata schema.');
    return name==='analyze_lockout'?analyzeLockout(args.inventory,args.lose):suggestFixes(args.inventory);
  }
  return {sample,evaluate,proposals,apply,alternate,rescued,inventorySchema,validateInventory,analyzeLockout,suggestFixes,tools,callTool};
})();

export default Lockout;
