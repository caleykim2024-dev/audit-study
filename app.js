/* ============ 상태 ============ */
// GitHub Pages projects under the same host share localStorage. Keep this quiz separate.
const LS_STATE='audit-2020.quizState.v1', LS_CFG='audit-2020.quizCfg.v1';
const LEGACY_LS_STATE='quizState.v1', LEGACY_LS_CFG='quizCfg.v1';
const SYNC_CODE='audit-2020';
function storedConfig(){
  const own=localStorage.getItem(LS_CFG);
  if(own){try{return JSON.parse(own)||{};}catch(_){return {};}}
  // Only adopt the old shared storage when it belongs to this quiz.
  try{
    const legacy=JSON.parse(localStorage.getItem(LEGACY_LS_CFG)||'{}');
    if(legacy.code===SYNC_CODE){
      localStorage.setItem(LS_CFG,JSON.stringify(legacy));
      return legacy;
    }
  }catch(_){}
  return {code:SYNC_CODE};
}
let Q=[], QB={}, DECKS=[], YEARS=[], S=null, loadErr='', ready=false, loadNote='', BAD=[];
// ★ 영역 목록(표시 순서). 영역을 바꾸거나 추가하려면 여기만 고치세요. 문제 파일의 deck 이름과 같아야 해요.
// 파일 이름(file)은 영문으로: 문제 파일은 2020/gamri.json, 길면 gamri-2.json, gamri-3.json … 으로 나눠 올려요.
// match: 문제의 deck 이름에 이런 글자가 들어 있으면 그 영역으로 자동 분류돼요.
//   예) '2020년 제21회 감리 및 사업관리' → 감리,  '2020년 제21회 시스템 구조' → 시구
const AREAS=[
  {name:'감리',file:'gamri',match:['감리']},
  {name:'소공',file:'sogong',match:['소프트웨어공학','소공']},
  {name:'데이터베이스',file:'database',match:['데이터베이스']},
  {name:'시구',file:'sigu',match:['시스템구조','시구']},
  {name:'보안',file:'security',match:['보안']}
];
const AREA_NAMES=AREAS.map(a=>a.name);
function areaNameOf(deck){
  if(AREA_NAMES.includes(deck))return deck;
  const d=String(deck||'').replace(/\s+/g,'');
  for(const a of AREAS){ if((a.match||[a.name]).some(k=>d.includes(k)))return a.name; }
  return deck;
}
let ALL=AREA_NAMES.slice();
let cfg=storedConfig();
// Supabase 정보는 config.json 에 넣으면 모든 기기가 따로 입력하지 않아도 자동으로 연결돼요.
// (config.json 이 없거나 값이 하나라도 비어 있으면 설정 화면/연결 링크로 기기마다 연결해요.)
async function loadConfigFile(){
  try{
    const r=await fetch('config.json',{cache:'no-cache'});
    if(!r.ok)return;
    const o=JSON.parse(await r.text()), sy=(o&&o.sync)||{};
    const url=String(sy.url||'').trim(), key=String(sy.key||'').trim(), code=String(sy.code||'').trim();
    if(url&&key&&code)cfg={url,key,code};
  }catch(_){}
}
let view='home', cur=0, curDeck='', curYear='2020', syncStatus='', pushTimer=null, pendingChoices={};
const LEGACY_YEAR='2020';
const reviewKey=()=>curYear===LEGACY_YEAR?curDeck:curYear+'/'+curDeck;
const yearAreas=year=>ALL.filter(name=>Q.some(q=>q.year===year&&q.deck===name));
const $app=document.getElementById('app');

const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const IMAGE_URL=/(?:\[[^\]]*이미지\]\s*URL:\s*|\bURL:\s*)?(https?:\/\/[^\s<>"']+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s<>"']*)?)/gi;
const hasImageUrl=value=>new RegExp(IMAGE_URL.source,'i').test(String(value??''));
function textWithImages(value,cssClass,alt){
  const text=String(value??'');
  let html='',last=0,match;
  IMAGE_URL.lastIndex=0;
  while((match=IMAGE_URL.exec(text))!==null){
    html+=e(text.slice(last,match.index));
    html+=`<img class="${cssClass}" src="${e(match[1])}" alt="${e(alt)}" loading="lazy">`;
    last=IMAGE_URL.lastIndex;
  }
  return html+e(text.slice(last));
}
function questionHtml(value){
  const source=String(value??'');
  const codeBlock=/```sql[ \t]*\r?\n([\s\S]*?)\r?\n```/gi;
  let html='',last=0,match;
  while((match=codeBlock.exec(source))!==null){
    html+=textWithImages(source.slice(last,match.index),'qimg','문제 그림');
    html+=`<pre class="sql-block"><code>${e(match[1])}</code></pre>`;
    last=codeBlock.lastIndex;
  }
  return html+textWithImages(source.slice(last),'qimg','문제 그림');
}
function todayStr(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function defaultState(){return {v:3,updatedAt:0,stats:{},res:{},review:{},rev:{},rsess:{}};}
function migrate(raw){
  const s=Object.assign(defaultState(),raw||{});
  if(!s.stats)s.stats={};if(!s.res)s.res={};if(!s.review)s.review={};if(!s.rev)s.rev={};if(!s.rsess)s.rsess={};
  // 예전(하루 N문제) 기록 이전: 다시 나올 틀린 문제 → '틀린 문제'로 표시
  if(Array.isArray(s.queue)){
    s.queue.forEach(x=>{const st=s.stats[x.id]||(s.stats[x.id]={seen:0,wrong:0,last:'',lastWrong:''});
      if(!(st.wrong>0))st.wrong=1;if(!st.lastWrong)st.lastWrong=x.date||'';});
  }
  delete s.queue;delete s.days;delete s.today;delete s.perDay;
  s.v=3;return s;
}
function loadLocal(){
  try{
    const own=localStorage.getItem(LS_STATE);
    if(own)return migrate(JSON.parse(own));
    const legacyCfg=JSON.parse(localStorage.getItem(LEGACY_LS_CFG)||'{}');
    if(legacyCfg.code===SYNC_CODE){
      const legacy=localStorage.getItem(LEGACY_LS_STATE);
      if(legacy){const state=migrate(JSON.parse(legacy));localStorage.setItem(LS_STATE,JSON.stringify(state));return state;}
    }
  }catch(_){}
  return defaultState();
}
function save(){S.updatedAt=Date.now();localStorage.setItem(LS_STATE,JSON.stringify(S));schedulePush();}
function shuffle(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
// 아직 한 문제도 풀지 않은 '빈' 상태인지
function isPristine(s){
  if(Object.keys(s.stats||{}).length||Object.keys(s.res||{}).length||Object.keys(s.review||{}).length||Object.keys(s.rev||{}).length||Object.keys(s.rsess||{}).length)return false;
  return true;
}


/* ============ 풀이 세션: 영역의 전체 문제 / 틀린 문제 복습 (하루 문제 수 제한 없음) ============ */
let mode='all';   // 'all' = 영역 전체 문제, 'review' = 영역의 틀린 문제 복습, 'rround' = 복습 페이지의 N차 복습
let curRound=0;

/* ============ 복습 (에빙하우스 망각곡선): 틀린 날로부터 1일 / 3일 / 5일 / 7일 / 30일 뒤에 다시 풀기 ============ */
// ★ 복습 간격은 여기만 고치면 돼요. days = 틀린 날로부터 며칠 뒤
const REVIEW_NAME='복습';
const REVIEW_STEPS=[
  {n:1,days:1,label:'전날'},
  {n:2,days:3,label:'3일 뒤'},
  {n:3,days:5,label:'5일 뒤'},
  {n:4,days:7,label:'7일 뒤'},
  {n:5,days:30,label:'한 달 뒤'}
];
const dayNum=s=>{const [y,m,d]=String(s).split('-').map(Number);return Math.round(Date.UTC(y,m-1,d)/86400000);};
const daysBetween=(a,b)=>dayNum(b)-dayNum(a);
function addDays(s,n){const [y,m,d]=String(s).split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));
  return t.getUTCFullYear()+'-'+String(t.getUTCMonth()+1).padStart(2,'0')+'-'+String(t.getUTCDate()).padStart(2,'0');}
const fmtDate=s=>{const [y,m,d]=String(s).split('-').map(Number);return m+'월 '+d+'일';};
// 한 문제의 복습 상태: {round:다음에 할 차수, due:그 차수를 할 수 있는 날} / 5차까지 끝났으면 {round:0,grad:true} / 틀린 적 없으면 null
// 틀린 날(lastWrong)이 기준이에요. 다시 풀어서 맞혀도 틀린 날은 그대로고, 복습 중에 또 틀리면 그날부터 새로 시작해요.
function reviewInfo(id){
  const st=S.stats[id];
  if(!st||!(st.wrong>0)||!st.lastWrong)return null;
  const base=st.lastWrong,rv=(S.rev[id]&&S.rev[id].base===base)?S.rev[id]:null,done=rv?rv.done:{};
  let n=1;while(n<=REVIEW_STEPS.length&&done[n])n++;
  if(n>REVIEW_STEPS.length)return {round:0,grad:true};
  let due=addDays(base,REVIEW_STEPS[n-1].days);
  if(rv&&rv.last){const nx=addDays(rv.last,1);if(nx>due)due=nx;}   // 오늘 한 복습은 내일부터 다음 차수
  return {round:n,due};
}
const areaOrder=q=>{const i=AREA_NAMES.indexOf(q.deck);return i<0?99:i;};
// n차 복습으로 오늘 풀 문제 (모든 영역 함께, 영역 순서대로)
function reviewDue(n){
  const T=todayStr();
  return Q.map((q,i)=>({q,i,info:reviewInfo(q.id)})).filter(x=>x.info&&x.info.round===n&&x.info.due<=T)
    .sort((a,b)=>areaOrder(a.q)-areaOrder(b.q)||a.i-b.i).map(x=>x.q.id);
}
// n차 복습 차례가 아직 안 온 문제 {count, next(가장 빠른 날)}
function reviewUpcoming(n){
  const T=todayStr();let count=0,next='';
  Q.forEach(q=>{const info=reviewInfo(q.id);if(info&&info.round===n&&info.due>T){count++;if(!next||info.due<next)next=info.due;}});
  return {count,next};
}
const reviewGraduated=()=>Q.filter(q=>{const i=reviewInfo(q.id);return i&&i.grad;}).length;
function markReviewDone(id,round){
  const st=S.stats[id],base=st&&st.lastWrong;if(!base)return;
  let rv=S.rev[id];if(!rv||rv.base!==base)rv=S.rev[id]={base,done:{},last:''};
  rv.done[round]=todayStr();rv.last=todayStr();
}
const sessLabel=()=>mode==='rround'?'복습 '+curRound+'차':e(curYear+'년 '+curDeck)+(mode==='review'?' 복습':'');
const deckIds=dk=>Q.filter(q=>q.year===curYear&&q.deck===dk).map(q=>q.id);
const wrongOf=id=>((S.stats[id]||{}).wrong||0);
// 틀린 적 있는 문제: 자주 틀린 순, 같으면 오래전에 틀린 순
function flaggedIds(dk){
  return deckIds(dk).filter(id=>wrongOf(id)>0).sort((a,b)=>{
    const d=wrongOf(b)-wrongOf(a);if(d)return d;
    const la=(S.stats[a]||{}).lastWrong||'',lb=(S.stats[b]||{}).lastWrong||'';
    return la<lb?-1:la>lb?1:0;
  });
}
// 지금 풀고 있는 묶음 {ids, res}
function sess(){
  if(mode==='rround'){
    const r=S.rsess[curRound]||{ids:[],res:{}};
    return {ids:(r.ids||[]).filter(id=>QB[id]),res:r.res||(r.res={})};
  }
  if(mode==='review'){
    const key=reviewKey(),r=S.review[key]||(S.review[key]={ids:[],res:{}});
    return {ids:r.ids.filter(id=>QB[id]),res:r.res};
  }
  return {ids:deckIds(curDeck),res:S.res};
}
const answeredIn=(ids,res)=>ids.filter(id=>res[id]&&res[id].tries>0).length;
// 2020년 기존 문항은 0부터 시작하는 인덱스, 다른 연도 문항은 1부터 시작하는 보기 번호를 사용한다.
// 문항별 answerBase(0 또는 1)가 있으면 해당 값을 우선한다.
const isMulti=q=>Array.isArray(q.answer)||Array.isArray(q.answers);
function answerIndices(q){
  const raw=q.answers!==undefined?q.answers:q.answer;
  const base=q.answerBase===0||q.answerBase===1?q.answerBase:(q.year===LEGACY_YEAR?0:1);
  return [...new Set((Array.isArray(raw)?raw:[raw]).map(Number)
    .filter(i=>Number.isInteger(i)&&i>=base&&i<q.choices.length+base)
    .map(i=>i-base))].sort((a,b)=>a-b);
}
function answersMatch(q,picked){
  const correct=answerIndices(q),selected=[...new Set(Array.isArray(picked)?picked:[picked])].sort((a,b)=>a-b);
  return selected.length===correct.length&&selected.every((i,n)=>i===correct[n]);
}
// 가장 최근에 푼 답이 맞았으면 '맞음' (틀렸다가 다시 풀어 맞혀도 맞은 것으로 센다)
function isOk(res,id){const r=res[id];if(!r||!(r.tries>0))return false;
  if(r.ok!==undefined)return r.ok;
  return r.picked!=null?answersMatch(QB[id],r.picked):!r.everWrong;}

/* ============ 동기화 (Supabase, 선택) ============ */
const syncOn=()=>cfg.url&&cfg.key&&cfg.code;
const base=()=>cfg.url.replace(/\/+$/,'')+'/rest/v1/progress';
const hdr=()=>{const h={apikey:cfg.key,'Content-Type':'application/json'};
  // 예전 anon key(eyJ…)는 Authorization에도 보내고, 새 publishable key(sb_…)는 apikey로만 보낸다
  if(!cfg.key.startsWith('sb_'))h.Authorization='Bearer '+cfg.key;return h;};
function setSync(s){syncStatus=s;const el=document.getElementById('sync');if(el){el.textContent=syncText();el.className='sync'+(s==='err'?' err':'');}}
function syncText(){return !syncOn()?'이 기기에만 저장 중':syncStatus==='err'?'동기화 실패 (인터넷 확인)':syncStatus==='ok'?'동기화됨':'동기화 중…';}
async function pull(){
  if(!syncOn())return false;
  try{
    const r=await fetch(base()+'?id=eq.'+encodeURIComponent(cfg.code)+'&select=data',{headers:hdr()});
    if(!r.ok)throw new Error(r.status);
    const rows=await r.json(); setSync('ok');
    if(!rows[0]){if(!isPristine(S))push();return false;}
    const d=rows[0].data;
    if(!d)return false;
    const remote=migrate(d), rEmpty=isPristine(remote), lEmpty=isPristine(S);
    // 이 기기에 푼 기록이 없고 서버에는 있으면 → 항상 서버 기록을 받아온다
    // 이 기기에 푼 기록이 있고 서버가 비어 있으면 → 이 기기 기록을 서버로 올린다 (실수로 덮어쓴 경우 복구)
    if(lEmpty&&!rEmpty){S=remote;localStorage.setItem(LS_STATE,JSON.stringify(S));return true;}
    if(!lEmpty&&rEmpty){push();return false;}
    if(d.updatedAt>S.updatedAt){S=remote;localStorage.setItem(LS_STATE,JSON.stringify(S));return true;}
    return false;
  }catch(_){setSync('err');return false;}
}
async function push(){
  if(!syncOn())return;
  try{
    const r=await fetch(base(),{method:'POST',headers:{...hdr(),Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:cfg.code,data:S})});
    if(!r.ok)throw new Error(r.status); setSync('ok');
  }catch(_){setSync('err');}
}
function schedulePush(){if(!syncOn())return;clearTimeout(pushTimer);pushTimer=setTimeout(push,700);}

/* ============ 문제/풀이 그림: 연도/question 또는 explanation/img/영역-번호.png ============ */
const LEGACY_EXPL_IMG_DIR='questions/explanation/img/';
const IMG_EXTS=['png','jpg','jpeg','webp'];
const EXPL_IMG_POS='top';                           // 'top' = 풀이 글 위, 'bottom' = 풀이 글 아래
const IMG_CACHE={};
// 예) 2019년 데이터베이스 61번 → 2019/question/img/database-61
function imageBase(q,section){
  const area=AREAS.find(a=>a.name===q.deck);
  const m=String(q.id).match(/(\d+)\s*$/);
  return (area&&m)?q.year+'/'+section+'/img/'+area.file+'-'+parseInt(m[1],10):null;
}
function probeImage(url){return new Promise(res=>{const im=new Image();im.onload=()=>res(true);im.onerror=()=>res(false);im.src=url;});}
// 기본 파일과 -2, -3 … 파일(최대 6장)을 찾는다. 파일이 없으면 표시하지 않는다.
async function findImages(base){
  if(IMG_CACHE[base])return IMG_CACHE[base];
  const found=[];
  for(let n=1;n<=6;n++){
    const stem=n===1?base:base+'-'+n;
    let hit=null;
    for(const ext of IMG_EXTS){const u=stem+'.'+ext;if(await probeImage(u)){hit=u;break;}}
    if(!hit)break;
    found.push(hit);
  }
  return IMG_CACHE[base]=found;
}
function fillImages(selector,cssClass,label){
  const h=$app.querySelector(selector);if(!h)return;
  const show=urls=>{
    if(!h.isConnected)return;   // 그 사이 다른 화면으로 바뀌었으면 그리지 않는다
    h.innerHTML=urls.map((u,i)=>`<a href="${e(u)}" target="_blank" rel="noopener"><img class="${cssClass}" src="${e(u)}" alt="${label} ${i+1}" loading="lazy"></a>`).join('');
  };
  findImages(h.dataset.base).then(urls=>urls.length?urls:(h.dataset.fallback?findImages(h.dataset.fallback):[])).then(show);
}

/* ============ 풀이(설명) 표시: 글 + 표 ============ */
// 풀이는 ① 그냥 글  ② 표 데이터(JSON)  ③ 글 안의 마크다운 표(| 머리 | 머리 |) 모두 가능
function parseMaybeJson(x){
  if(typeof x==='string'){const t=x.trim();if(/^[\[{]/.test(t)){try{return JSON.parse(t);}catch(_){}}}
  return x;
}
function cellText(v){
  if(v==null)return '';
  if(Array.isArray(v))return v.map(cellText).join('\n');
  if(typeof v==='object')return JSON.stringify(v);
  return String(v);
}
function tableFromRows(rows,header){
  rows=rows.map(r=>Array.isArray(r)?r.map(cellText):[cellText(r)]);
  if(!header){header=rows[0]||[];rows=rows.slice(1);}
  return {type:'table',header:header.map(cellText),rows};
}
function tableFromObjects(list){
  const keys=[];list.forEach(o=>Object.keys(o).forEach(k=>{if(!keys.includes(k))keys.push(k);}));
  return {type:'table',header:keys,rows:list.map(o=>keys.map(k=>cellText(o[k])))};
}
function textBlocks(str){
  const lines=String(str).split('\n'),out=[];let buf=[];
  const isRow=l=>/^\s*\|.*\|\s*$/.test(l);
  const isSep=l=>/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const isBullet=l=>/^\s*(?:[-*•]|\d+[.)])\s+/.test(l);
  const split=l=>l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
  const flush=()=>{
    const t=buf.join('\n').trim();buf=[];
    if(!t)return;
    t.split(/\n\s*\n/).forEach(part=>{
      const group=part.trim().split('\n');
      if(group.every(isBullet))out.push({type:'list',items:group.map(line=>line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/,''))});
      else out.push({type:'text',text:part.trim()});
    });
  };
  for(let i=0;i<lines.length;i++){
    if(isRow(lines[i])&&i+1<lines.length&&isSep(lines[i+1])){
      flush();
      const header=split(lines[i]),rows=[];i+=2;
      while(i<lines.length&&isRow(lines[i])){rows.push(split(lines[i]));i++;}
      i--;out.push({type:'table',header,rows});
    }else buf.push(lines[i]);
  }
  flush();
  return out;
}
function readableExplanationText(value){
  const parts=String(value).split(/(【[^】]+】)/g);
  return parts.map(part=>{
    const heading=part.match(/^【([^】]+)】$/);
    if(heading)return '<h5 class="expl-heading">'+e(heading[1])+'</h5>';
    return part.trim().split(/\r?\n+/).filter(Boolean).flatMap(line=>{
      const sentences=line.trim().replace(/([.!?。]["”’]?)\s+(?=[가-힣A-Z【"“‘])/g,'$1\n').split('\n');
      const paragraphs=[];let current='';
      sentences.forEach(sentence=>{
        if(current&&current.length+sentence.length>170){paragraphs.push(current);current='';}
        current+=(current?' ':'')+sentence;
      });
      if(current)paragraphs.push(current);
      return paragraphs.map(text=>'<p>'+textWithImages(text,'expl-img','풀이 그림')+'</p>');
    }).join('');
  }).join('');
}
const T_TEXT=['text','설명','풀이','해설','explanation','description','desc'];
const T_TABLE=['table','tables','표'];
const T_HEAD=['headers','header','columns','머리글','열'];
const T_ROWS=['rows','data','행','데이터'];
const T_NOTE=['note','notes','참고','주석'];
const T_TITLE=['title','제목'];
const pickKey=(o,keys)=>keys.find(k=>o[k]!==undefined);
function explBlocks(x){
  x=parseMaybeJson(x);
  if(x==null||x==='')return [];
  if(typeof x==='string')return textBlocks(x);
  if(typeof x!=='object')return [{type:'text',text:String(x)}];
  if(Array.isArray(x)){
    if(!x.length)return [];
    if(x.every(r=>Array.isArray(r)))return [tableFromRows(x)];
    if(x.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&!pickKey(r,[...T_TEXT,...T_TABLE,...T_ROWS])))return [tableFromObjects(x)];
    return x.flatMap(explBlocks);
  }
  const tk=pickKey(x,T_TEXT),tb=pickKey(x,T_TABLE),hk=pickKey(x,T_HEAD),rk=pickKey(x,T_ROWS),nk=pickKey(x,T_NOTE),ttl=pickKey(x,T_TITLE);
  if(tk||tb||rk||nk||ttl){
    const out=[];
    if(tk)out.push(...explBlocks(x[tk]));
    if(tb){const v=parseMaybeJson(x[tb]);(Array.isArray(v)&&v.length&&v.every(t=>t&&typeof t==='object'&&!Array.isArray(t)&&pickKey(t,[...T_TABLE,...T_ROWS]))?v:[v])
      .forEach(t=>{const bs=explBlocks(t);if(ttl&&bs[0]&&bs[0].type==='table'&&!bs[0].title)bs[0].title=String(x[ttl]);out.push(...bs);});}
    if(rk){const t=tableFromRows(Array.isArray(x[rk])?x[rk]:[],hk&&Array.isArray(x[hk])?x[hk]:undefined);if(ttl)t.title=String(x[ttl]);out.push(t);}
    if(!tb&&!rk&&ttl)out.unshift({type:'text',text:String(x[ttl]),strong:true});
    if(nk)out.push(...explBlocks(x[nk]));
    return out;
  }
  // 항목: 내용 형태의 단순 객체 → 2열 표, 값이 표/배열이면 항목 이름을 제목으로
  const out=[];let pairs=[];
  const flush=()=>{if(pairs.length){out.push({type:'table',header:['항목','내용'],rows:pairs});pairs=[];}};
  for(const [k,v] of Object.entries(x)){
    if(v!==null&&typeof v==='object'){flush();out.push({type:'text',text:k,strong:true});out.push(...explBlocks(v));}
    else pairs.push([k,cellText(v)]);
  }
  flush();
  return out;
}
function explanationHtml(x){
  const blocks=explBlocks(x);
  return blocks.map(b=>{
    if(b.type==='text')return b.strong?`<p class="tbl-title">${textWithImages(b.text,'expl-img','풀이 그림')}</p>`:readableExplanationText(b.text);
    if(b.type==='list')return `<ul class="expl-list">${b.items.map(item=>`<li>${textWithImages(item,'expl-img','풀이 그림')}</li>`).join('')}</ul>`;
    const w=Math.max(b.header.length,...b.rows.map(r=>r.length),1);
    const pad=r=>{r=r.slice();while(r.length<w)r.push('');return r;};
    const head=b.header.some(h=>h!=='')?`<thead><tr>${pad(b.header).map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead>`:'';
    return `${b.title?`<p class="tbl-title">${e(b.title)}</p>`:''}<div class="tbl-wrap"><table class="tbl">${head}<tbody>${b.rows.map(r=>`<tr>${pad(r).map(c=>`<td>${textWithImages(c,'expl-img','풀이 그림')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }).join('');
}

/* ============ 화면 ============ */
// fn: 눌렀을 때 부를 함수 이름('go','openAt'), 없으면 표시만
function dotsHtml(ids,res,fn,scroll){
  return `<div class="dots${scroll?' scroll':''}">`+ids.map((id,i)=>{
    const r=res[id];
    let cls=r&&r.tries>0?(isOk(res,id)?'ok':'ng'):'';
    const w=wrongOf(id);
    if(w>=2)cls+=' often';else if(w>=1)cls+=' flag';
    if(fn==='go'&&view==='quiz'&&i===cur)cls+=' cur';
    const label=`${i+1}번 문제${w?` (틀린 적 ${w}회)`:''}`;
    return fn?`<button class="dot ${cls}" onclick="${fn}(${i})" aria-label="${label}">${i+1}</button>`
             :`<span class="dot ${cls}">${i+1}</span>`;
  }).join('')+'</div>';
}

function render(){
  if(loadErr){$app.innerHTML=`<h1>문제를 불러오지 못했어요</h1><div class="err-box">${e(loadErr)}</div>`;return;}
  if(!S||!ready){$app.innerHTML='<p class="sub">불러오는 중…</p>';return;}
  if(view==='settings')return renderSettings();
  if(view==='quiz')return renderQuiz();
  if(view==='result')return renderResult();
  if(view==='year')return renderYear();
  if(view==='area')return renderArea();
  if(view==='review')return renderReview();
  renderLanding();
}

/* ---- 주소(#)로 페이지를 나눔: #/year/2020, #/year/2020/감리 ---- */
function routeFromHash(){
  let h='';try{h=decodeURIComponent(location.hash.replace(/^#\/?/,''));}catch(_){}
  if(h===REVIEW_NAME){curDeck='';view='review';}
  else if(h.startsWith('year/')){
    const [,year,...parts]=h.split('/'),area=parts.join('/');
    if(YEARS.includes(year)){
      curYear=year;curDeck=area;
      view=area&&ALL.includes(area)?'area':'year';
    }else{curDeck='';view='landing';}
  }
  else if(h&&ALL.includes(h)){curYear=LEGACY_YEAR;curDeck=h;view='area';}
  else{curDeck='';view='landing';}
}
window.addEventListener('hashchange',()=>{if(!S||!ready)return;routeFromHash();render();});

/* ---- 첫 페이지: 영역 목록 ---- */
function noticeHtml(extra){
  const parts=[];
  if(loadNote)parts.push(loadNote);
  if(BAD.length)parts.push('읽지 못한 파일이 있어요 (형식 오류): '+BAD.join(', ')+'\n해당 영역의 문제가 일부 빠졌을 수 있어요.');
  if(extra)parts.push(extra);
  return parts.length?`<div class="notice">${e(parts.join('\n\n'))}</div>`:'';
}
function renderLanding(){
  const d=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
  const cards=YEARS.map(year=>{
    const areas=yearAreas(year),total=Q.filter(q=>q.year===year).length;
    return `<a class="area" href="#/year/${encodeURIComponent(year)}"><div class="deckhead" style="margin-bottom:0"><b>${e(year)}년</b><span>${total?`${areas.length}개 영역 · ${total}문제`:'문제 준비 중'}</span></div></a>`;
  }).join('');
  const dueCounts=REVIEW_STEPS.map(st=>reviewDue(st.n).length),dueTotal=dueCounts.reduce((a,b)=>a+b,0);
  const reviewCard=`<a class="area review" href="#/${encodeURIComponent(REVIEW_NAME)}">
      <div class="deckhead"><b>복습</b><span>${dueTotal?`오늘 ${dueTotal}개`:'오늘 복습 없음'}</span></div>
      <p class="deckmeta" style="margin-top:0">틀린 문제를 잊을 때쯤 다시 풀어요 (1차 ${dueCounts[0]} · 2차 ${dueCounts[1]} · 3차 ${dueCounts[2]} · 4차 ${dueCounts[3]} · 5차 ${dueCounts[4]})</p></a>`;
  $app.innerHTML=`
    <div class="top"><span class="sync" id="sync">${syncText()}</span><button class="icon-btn" onclick="openSettings()" aria-label="설정">⚙</button></div>
    <h1>문제 퀴즈</h1>
    <p class="sub">${e(d)} · 풀고 싶은 연도를 골라 주세요.</p>
    ${noticeHtml()}
    <div class="areas">${reviewCard}${cards}</div>`;
  window.scrollTo(0,0);
}

