/* ============ 상태 ============ */
const LS_STATE='quizState.v1', LS_CFG='quizCfg.v1';
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
let cfg=JSON.parse(localStorage.getItem(LS_CFG)||'{}');
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
function loadLocal(){try{return migrate(JSON.parse(localStorage.getItem(LS_STATE)||'{}'));}catch(_){return defaultState();}}
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
    if(!rows[0]){push();return false;}
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

/* ============ 풀이 그림: questions/explanation/img/영문영역이름-번호.jpg (없으면 안 보임) ============ */
const EXPL_IMG_DIR='questions/explanation/img/';   // 그림을 올려둘 폴더
const EXPL_IMG_EXTS=['jpg','jpeg','png','webp'];    // 찾아볼 확장자 (소문자로 저장하세요)
const EXPL_IMG_POS='top';                           // 'top' = 풀이 글 위, 'bottom' = 풀이 글 아래
const IMG_CACHE={};
// 문제 → 그림 파일 이름(확장자 제외). 예) 보안 영역 '…보안-117' → questions/explanation/img/security-117
function explImgBase(q){
  const area=AREAS.find(a=>a.name===q.deck);
  const m=String(q.id).match(/(\d+)\s*$/);
  const dir=q.year===LEGACY_YEAR?EXPL_IMG_DIR:q.year+'/explanation/img/';
  return (area&&m)?dir+area.file+'-'+parseInt(m[1],10):null;
}
function probeImage(url){return new Promise(res=>{const im=new Image();im.onload=()=>res(true);im.onerror=()=>res(false);im.src=url;});}
// base.jpg 를 찾고, 있으면 base-2.jpg, base-3.jpg … (최대 6장)도 찾는다. 하나도 없으면 빈 목록
async function findExplImages(base){
  if(IMG_CACHE[base])return IMG_CACHE[base];
  const found=[];
  for(let n=1;n<=6;n++){
    const stem=n===1?base:base+'-'+n;
    let hit=null;
    for(const ext of EXPL_IMG_EXTS){const u=stem+'.'+ext;if(await probeImage(u)){hit=u;break;}}
    if(!hit)break;
    found.push(hit);
  }
  return IMG_CACHE[base]=found;
}
function fillExplImages(){
  const h=$app.querySelector('.expl-imgs');if(!h)return;
  const base=h.dataset.base;
  const show=urls=>{
    if(!h.isConnected)return;   // 그 사이 다른 화면으로 바뀌었으면 그리지 않는다
    h.innerHTML=urls.map((u,i)=>`<a href="${e(u)}" target="_blank" rel="noopener"><img class="expl-img" src="${e(u)}" alt="풀이 그림 ${i+1}" loading="lazy"></a>`).join('');
  };
  if(IMG_CACHE[base]){show(IMG_CACHE[base]);return;}
  findExplImages(base).then(show);
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
  const split=l=>l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
  const flush=()=>{const t=buf.join('\n').trim();if(t)out.push({type:'text',text:t});buf=[];};
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
    if(b.type==='text')return b.strong?`<p class="tbl-title">${e(b.text)}</p>`:`<p>${e(b.text)}</p>`;
    const w=Math.max(b.header.length,...b.rows.map(r=>r.length),1);
    const pad=r=>{r=r.slice();while(r.length<w)r.push('');return r;};
    const head=b.header.some(h=>h!=='')?`<thead><tr>${pad(b.header).map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead>`:'';
    return `${b.title?`<p class="tbl-title">${e(b.title)}</p>`:''}<div class="tbl-wrap"><table class="tbl">${head}<tbody>${b.rows.map(r=>`<tr>${pad(r).map(c=>`<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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

function renderYear(){
  const d=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
  const cards=ALL.map(name=>{
    const href='#/year/'+encodeURIComponent(curYear)+'/'+encodeURIComponent(name);
    if(!yearAreas(curYear).includes(name))return `<a class="area off" href="${href}"><div class="deckhead" style="margin-bottom:0"><b>${e(name)}</b><span>문제 준비 중</span></div></a>`;
    const ids=deckIds(name),total=ids.length,done=answeredIn(ids,S.res);
    const fl=flaggedIds(name),often=fl.filter(id=>wrongOf(id)>=2).length;
    return `<a class="area" href="${href}">
      <div class="deckhead"><b>${e(name)}</b><span>${done}/${total}</span></div>
      <div class="bar"><i style="width:${total?Math.round(done/total*100):0}%"></i></div>
      <p class="deckmeta">전체 ${total}문제 · 틀린 문제 ${fl.length}개${often?` (자주 틀림 ${often}개)`:''}</p></a>`;
  }).join('');
  $app.innerHTML=`
    <div class="top"><a class="icon-btn" href="#" aria-label="연도 목록으로">←</a><span class="sync" id="sync">${syncText()}</span><button class="icon-btn" onclick="openSettings()" aria-label="설정">⚙</button></div>
    <h1>${e(curYear)}년</h1>
    <p class="sub">${e(d)} · 풀고 싶은 영역을 골라 주세요.</p>
    ${noticeHtml()}
    <div class="areas">${cards}</div>`;
  window.scrollTo(0,0);
}

/* ---- 복습 페이지: 1~5차 (모든 영역의 문제가 함께) ---- */
function renderReview(){
  const T=todayStr();
  const top=`<div class="top"><a class="icon-btn" href="#" aria-label="영역 목록으로">←</a><span class="sync" id="sync">${syncText()}</span><button class="icon-btn" onclick="openSettings()" aria-label="설정">⚙</button></div>`;
  const cards=REVIEW_STEPS.map(st=>{
    const due=reviewDue(st.n),up=reviewUpcoming(st.n);
    const rs=S.rsess[st.n],rsIds=(rs&&rs.date===T)?(rs.ids||[]).filter(id=>QB[id]):[];
    const rsDone=rs&&rs.date===T?answeredIn(rsIds,rs.res||{}):0;
    const resume=rsIds.length>0&&rsDone<rsIds.length;
    const byArea={};due.forEach(id=>{const q=QB[id],k=q.year+'년 '+q.deck;byArea[k]=(byArea[k]||0)+1;});
    const chips=Object.keys(byArea).map(k=>`<span class="chip">${e(k)} ${byArea[k]}</span>`).join('');
    const allIds=(rs&&rs.date===T)?(rs.all||rs.ids||[]).filter(id=>QB[id]):[];
    const finished=rsIds.length>0&&rsDone===rsIds.length;
    const wrongToday=allIds.filter(id=>(S.stats[id]||{}).lastWrong===T);
    let body,btn='';
    if(resume){body=`<p>진행 중 · ${rsDone}/${rsIds.length}</p>`;btn=`<button class="btn" onclick="startRound(${st.n},true)">이어서 풀기</button>`;}
    else if(due.length){body=`<p>복습할 문제 ${due.length}개</p><div>${chips}</div>`;btn=`<button class="btn" onclick="startRound(${st.n},false)">풀기 (${due.length}개)</button>`;}
    else body=`<p class="deckmeta" style="margin:6px 0 0">지금 복습할 문제가 없어요</p>`;
    const next=up.count?`<p class="deckmeta" style="margin:8px 0 0">${up.next===addDays(T,1)?'내일':fmtDate(up.next)}부터 ${up.count}개 · 아직 차례가 안 온 문제</p>`:'';
    // 오늘 한 복습은 다시 풀 수 있어요 (다시 풀어도 복습 일정은 바뀌지 않고, 틀렸던 문제는 다음 복습 대상으로 남아요)
    const redo=(finished&&allIds.length)
      ?`<button class="btn ghost" onclick="startRedo(${st.n},false)">오늘 푼 ${allIds.length}개 다시 풀기</button>`
        +(wrongToday.length?`<button class="btn ghost" onclick="startRedo(${st.n},true)">오늘 틀린 ${wrongToday.length}개만 다시 풀기</button>`:''):'';
    const btnHtml=(btn||redo)?`<div class="btns">${btn}${redo}</div>`:'';
    return `<div class="panel rcard"><div class="deckhead"><b>${st.n}차 복습</b><span>틀린 날로부터 ${e(st.label)}</span></div>${body}${next}${btnHtml}</div>`;
  }).join('');
  const grad=reviewGraduated();
  $app.innerHTML=`${top}
    <h1>복습</h1>
    <p class="sub">틀린 문제를 잊을 때쯤 다시 풀면 오래 기억돼요. 모든 영역의 문제가 함께 나와요.</p>
    ${cards}
    <p class="legend" style="margin-top:16px">틀린 문제는 다시 풀어서 맞아도 복습에 포함돼요. 복습 중에 또 틀리면 그날부터 1차부터 새로 시작해요.${grad?` 5차까지 끝낸 문제 ${grad}개.`:''}</p>`;
  window.scrollTo(0,0);
}

/* ---- 영역 페이지: 그 영역의 전체 문제 ---- */
function renderArea(){
  const dk=curDeck;
  const top=`<div class="top"><a class="icon-btn" href="#/year/${encodeURIComponent(curYear)}" aria-label="영역 목록으로">←</a><span class="sync" id="sync">${syncText()}</span><button class="icon-btn" onclick="openSettings()" aria-label="설정">⚙</button></div>`;
  const area=AREAS.find(a=>a.name===dk);
  const bad=BAD.filter(f=>area&&(f.indexOf(curYear+'/'+area.file)===0||(curYear===LEGACY_YEAR&&f.indexOf('questions/'+area.file)===0)));
  if(!yearAreas(curYear).includes(dk)){
    $app.innerHTML=`${top}
      <h1>${e(curYear)}년 · ${e(dk)}</h1>
      ${bad.length?`<div class="notice">${e('파일을 읽지 못했어요 (형식 오류): '+bad.join(', '))}</div>`:''}
      <div class="empty"><b>아직 문제가 없어요</b>
      <p>${e(area?curYear+'/'+area.file+'.json 파일을 올리면\n이 페이지에 문제가 나와요.':'이 영역의 문제 파일을 올리면 문제가 나와요.')}</p></div>`;
    window.scrollTo(0,0);return;
  }
  const ids=deckIds(dk),n=ids.length,solved=answeredIn(ids,S.res);
  const fl=flaggedIds(dk),often=fl.filter(id=>wrongOf(id)>=2).length;
  const rv=S.review[reviewKey()],rvIds=rv?rv.ids.filter(id=>QB[id]):[],rvDone=rv?answeredIn(rvIds,rv.res):0;
  const resume=!!(rv&&rvIds.length&&rvDone<rvIds.length);
  const label=solved===0?'시작하기':solved<n?'이어서 풀기':'결과 보기';
  $app.innerHTML=`${top}
    <h1>${e(curYear)}년 · ${e(dk)}</h1>
    <p class="sub">전체 ${n}문제 · ${solved}개 풀었어요</p>
    ${bad.length?`<div class="notice">${e('읽지 못한 파일이 있어요 (형식 오류): '+bad.join(', '))}</div>`:''}
    <div class="panel">${dotsHtml(ids,S.res,'openAt')}
      <p class="legend">번호를 누르면 그 문제로 가요. 초록은 맞음, 빨강은 틀림이고, 모서리의 빨간 점은 틀린 적이 있는 문제예요(자주 틀리면 진한 점).</p>
      <p class="deckmeta">틀린 문제 ${fl.length}개${often?` · 자주 틀림 ${often}개`:''}</p>
      <div class="btns">
        <button class="btn" onclick="startAll()">${label}</button>
        <button class="btn ghost" ${(fl.length||resume)?'':'disabled'} onclick="startReview(${resume})">${resume?`틀린 문제 복습 이어서 (${rvDone}/${rvIds.length})`:`틀린 문제 복습 (${fl.length}개)`}</button>
        ${solved>0?`<button class="btn ghost" onclick="restartAll()">처음부터 다시 풀기</button>`:''}
      </div>
    </div>`;
  window.scrollTo(0,0);
}

function renderQuiz(){
  const ss=sess();
  const id=ss.ids[cur],q=QB[id];
  if(!q){view=curDeck?'area':'landing';return render();}
  const res=ss.res,r=res[id]||{},answered=r.picked!=null,ok=answered&&answersMatch(q,r.picked);
  const multi=isMulti(q),correct=answerIndices(q);
  const selected=answered?(Array.isArray(r.picked)?r.picked:[r.picked]):(pendingChoices[id]||[]);
  const w=wrongOf(id);
  const ch=q.choices.map((c,i)=>{
    let cls='';
    if(answered){if(correct.includes(i))cls='right';else if(selected.includes(i))cls='wrong';}
    else if(multi&&selected.includes(i))cls='selected';
    return `<button class="choice ${cls}" ${answered?'disabled':''} ${multi?`aria-pressed="${selected.includes(i)}"`:''} onclick="${multi?'toggleChoice':'pick'}(${i})"><span class="n">${i+1}</span><span class="t">${e(c)}</span></button>`;
  }).join('');
  const submit=multi&&!answered?`<button class="btn submit-answers" id="submitAnswers" onclick="submitMultiple()" ${selected.length?'':'disabled'}>선택한 답 제출</button>`:'';
  const imgBase=answered?explImgBase(q):null;
  const imgSlot=imgBase?`<div class="expl-imgs" data-base="${e(imgBase)}"></div>`:'';
  const verdict=answered?`<div class="verdict ${ok?'ok':'ng'}">
      <h3>${ok?'정답이에요!':'아쉬워요. 정답은 '+correct.map(i=>(i+1)+'번').join(', ')}</h3>
      ${EXPL_IMG_POS==='top'?imgSlot:''}${explanationHtml(q.explanation)}${EXPL_IMG_POS==='top'?'':imgSlot}</div>`:'';
  const last=cur===ss.ids.length-1;
  const footer=answered?`<div class="footer"><div class="row">
      <button class="btn ghost" onclick="retry()">다시 풀기</button>
      <button class="btn" onclick="next()">${last?'결과 보기':'다음 문제'}</button></div></div>`:'';
  const tags=(mode==='rround'?`<span class="tag">${e(q.year)}년 · ${e(q.deck)}</span><span class="tag">복습 ${curRound}차</span>`:'')
    +(mode==='review'?'<span class="tag">복습</span>':'')
    +(w>=2?`<span class="tag warn">자주 틀림 · ${w}회</span>`:w===1?'<span class="tag warn">틀렸던 문제</span>':'');
  $app.innerHTML=`
    <div class="top"><button class="icon-btn" onclick="home()" aria-label="처음으로">←</button><span class="sync">${sessLabel()} · ${cur+1} / ${ss.ids.length}</span><span style="width:44px"></span></div>
    ${dotsHtml(ss.ids,res,'go',true)}
    <div class="qhead">${tags}</div>
    ${q.big?`<div class="bighan" lang="ko">${e(q.big)}</div>`:''}
    <div class="qtext">${e(q.question)}</div>
    ${q.image?`<img class="qimg" src="${e(q.image)}" alt="">`:''}
    <div class="choices">${ch}</div>
    ${submit}
    ${verdict}${footer}`;
  fillExplImages();
  window.scrollTo(0,0);
  const box=$app.querySelector('.dots.scroll'),c=$app.querySelector('.dot.cur');
  if(box&&c)box.scrollTop=Math.max(0,c.offsetTop-box.offsetTop-box.clientHeight/2);
}

function renderResult(){
  const ss=sess(),res=ss.res,n=ss.ids.length;
  const wrong=ss.ids.filter(id=>res[id]&&res[id].everWrong);
  const good=ss.ids.filter(id=>isOk(res,id)).length;
  const label=id=>{const q=QB[id];return q.big?q.big+'  '+answerIndices(q).map(i=>q.choices[i]).join(' · '):q.question.slice(0,60)+(q.question.length>60?'…':'');};
  let redoHtml='';
  if(mode==='rround'){
    const T=todayStr(),rs=S.rsess[curRound],allIds=((rs&&(rs.all||rs.ids))||[]).filter(id=>QB[id]);
    const wt=allIds.filter(id=>(S.stats[id]||{}).lastWrong===T);
    redoHtml=`<div class="btns" style="margin-top:18px">${wt.length?`<button class="btn ghost" onclick="startRedo(${curRound},true)">오늘 틀린 ${wt.length}개만 다시 풀기</button>`:''}<button class="btn ghost" onclick="startRedo(${curRound},false)">${allIds.length}개 전부 다시 풀기</button></div>
      <p class="help">다시 풀어도 복습 일정은 그대로예요. 틀렸던 문제는 다시 맞혀도 다음 복습 대상으로 남아요.</p>`;
  }
  $app.innerHTML=`
    <div class="top"><button class="icon-btn" onclick="home()" aria-label="처음으로">←</button><span class="sync">${sessLabel()}</span><span style="width:44px"></span></div>
    <h1>${wrong.length===0?'전부 한 번에 맞혔어요!':(mode==='review'||mode==='rround'?'복습 끝!':'다 풀었어요!')}</h1>
    <p class="sub">맞힌 문제</p>
    <div class="big">${good}<small> / ${n}</small></div>
    ${dotsHtml(ss.ids,res,'',true)}
    ${wrong.length?`<h2>이번에 틀린 문제</h2><ul class="wrong-list">${wrong.map(id=>`<li>${e(label(id))}${isOk(res,id)?' · 다시 풀어서 맞힘':''}${wrongOf(id)>=2?` · 자주 틀림(${wrongOf(id)}회)`:''}</li>`).join('')}</ul>
      <p class="help">${mode==='rround'?'이번에 틀린 문제는 오늘부터 복습이 1차부터 다시 시작돼요.':'틀린 문제는 다시 맞혀도 \'틀린 문제\'로 남아서, 내일 복습 1차에 나와요.'}</p>`:''}
    ${redoHtml}
    <div class="footer"><div class="row"><button class="btn" onclick="home()">${mode==='rround'?'복습으로':'처음으로'}</button></div></div>`;
  window.scrollTo(0,0);
}

function renderSettings(){
  $app.innerHTML=`
    <div class="top"><button class="icon-btn" onclick="home()" aria-label="뒤로">←</button><span></span><span style="width:44px"></span></div>
    <h1>설정</h1>

    <h2>여러 기기에서 기록 같이 쓰기</h2>
    <div class="panel">
      <p class="help" style="margin-top:0">Supabase 정보를 넣으면 폰·노트북·패드의 기록이 합쳐져요. 세 기기 모두 같은 값을 입력하세요.</p>
      <label for="cUrl">Project URL</label><input type="url" id="cUrl" value="${e(cfg.url||'')}" placeholder="https://xxxx.supabase.co">
      <label for="cKey">anon public key</label><input type="password" id="cKey" value="${e(cfg.key||'')}">
      <label for="cCode">동기화 코드 (아이 이름 등 아무거나)</label><input type="text" id="cCode" value="${e(cfg.code||'')}" placeholder="예: minsu">
      <div style="display:flex;gap:10px;margin-top:14px;align-items:center">
        <button class="btn small" onclick="saveSync()">연결</button>
        <span class="sync" id="sync">${syncText()}</span>
      </div>
      ${syncOn()?`<button class="btn small ghost" style="margin-top:12px" onclick="copySyncLink()">다른 기기 연결 링크 복사</button>
      <p class="help">다른 기기(폰, 패드 등)의 브라우저에서 이 링크를 열면 위 세 값이 자동으로 입력돼요.</p>`:''}
    </div>

    <h2>기록 지우기</h2>
    <button class="btn danger" onclick="resetAll()">이 기기와 동기화된 모든 기록 삭제</button>`;
  window.scrollTo(0,0);
}

/* ============ 동작 ============ */
function go(i){cur=i;render();}
function home(){
  if(view==='settings'){routeFromHash();return render();}   // 설정에서 나가면 원래 보던 페이지로
  if(mode==='rround'&&(view==='quiz'||view==='result')){view='review';return render();}
  view=curDeck?'area':'landing';render();
}
function openSettings(){view='settings';render();}
function openAt(i){mode='all';cur=i;view='quiz';render();}
function startAll(){
  mode='all';
  const ids=deckIds(curDeck);
  if(ids.length&&answeredIn(ids,S.res)>=ids.length){view='result';return render();}
  cur=Math.max(0,ids.findIndex(id=>!(S.res[id]&&S.res[id].tries>0)));
  view='quiz';render();
}
// 틀린 문제 복습: 틀린 적 있는 문제만 모아서 푼다 (자주 틀린 문제가 앞에 온다)
function startReview(resume){
  if(!resume)S.review[reviewKey()]={ids:flaggedIds(curDeck),res:{}};
  mode='review';
  const ss=sess();
  if(!ss.ids.length){mode='all';return render();}
  const i=ss.ids.findIndex(id=>!(ss.res[id]&&ss.res[id].tries>0));
  cur=Math.max(0,i);save();view='quiz';render();
}
// 복습 페이지에서 n차 복습 풀기 (resume=true 이면 오늘 하던 것 이어서)
function startRound(n,resume){
  curRound=n;mode='rround';
  const T=todayStr(),rs=S.rsess[n];
  if(!(resume&&rs&&rs.date===T)){const ids=reviewDue(n);S.rsess[n]={date:T,ids,all:ids.slice(),res:{}};}
  const ss=sess();
  if(!ss.ids.length){mode='all';return render();}
  cur=Math.max(0,ss.ids.findIndex(id=>!(ss.res[id]&&ss.res[id].tries>0)));
  save();view='quiz';render();
}
// 오늘 한 n차 복습을 다시 풀기 (onlyWrong=true 이면 오늘 틀린 문제만). 복습 일정은 바뀌지 않아요
function startRedo(n,onlyWrong){
  const T=todayStr(),rs=S.rsess[n];
  curRound=n;mode='rround';
  if(!rs||rs.date!==T)return render();
  const all=(rs.all||rs.ids||[]).filter(id=>QB[id]);
  const ids=onlyWrong?all.filter(id=>(S.stats[id]||{}).lastWrong===T):all;
  if(!ids.length)return render();
  S.rsess[n]={date:T,ids,all,res:{},redo:true};
  cur=0;save();view='quiz';render();
}
function restartAll(){
  if(!confirm('이 영역의 풀이 표시(맞음/틀림)를 지우고 처음부터 다시 풀까요?\n틀린 문제 기록은 그대로 남아요.'))return;
  deckIds(curDeck).forEach(id=>{delete S.res[id];});
  save();render();
}
function toggleChoice(i){
  const ss=sess(),id=ss.ids[cur],q=QB[id];
  if(!q||!isMulti(q)||ss.res[id]?.picked!=null)return;
  const selected=pendingChoices[id]||(pendingChoices[id]=[]);
  const at=selected.indexOf(i);
  if(at<0)selected.push(i);else selected.splice(at,1);
  $app.querySelectorAll('.choices .choice').forEach((button,n)=>{
    button.classList.toggle('selected',selected.includes(n));
    button.setAttribute('aria-pressed',String(selected.includes(n)));
  });
  document.getElementById('submitAnswers').disabled=selected.length===0;
}
function submitMultiple(){
  const ss=sess(),id=ss.ids[cur],q=QB[id],selected=pendingChoices[id]||[];
  if(!q||!isMulti(q)||!selected.length)return;
  recordAnswer(selected.slice());
}
function pick(i){
  const ss=sess(),q=QB[ss.ids[cur]];
  if(!q||isMulti(q))return;
  recordAnswer(i);
}
function recordAnswer(picked){
  const ss=sess(),id=ss.ids[cur],q=QB[id];
  const r=ss.res[id]||(ss.res[id]={tries:0,everWrong:false,picked:null});
  if(r.picked!=null)return;
  r.picked=picked;r.tries++;r.ok=answersMatch(q,picked);
  delete pendingChoices[id];
  const today=todayStr();
  const st=S.stats[id]||(S.stats[id]={seen:0,wrong:0,last:'',lastWrong:''});
  if(r.tries===1){st.seen++;st.last=today;}
  // 틀리면 '틀린 문제'로 표시 (다시 풀어서 맞혀도 표시는 남는다). 한 번 풀이에서 여러 번 틀려도 1회로 센다
  const rs=(mode==='rround')?S.rsess[curRound]:null, redo=!!(rs&&rs.redo);
  if(!r.ok&&!r.everWrong){r.everWrong=true;if(!(redo&&st.lastWrong===today))st.wrong++;st.lastWrong=today;}
  // 복습 첫 풀이에서 한 번에 맞히면 그 차수 완료 (다시 풀기는 일정에 영향 없음). 틀리면 틀린 날이 오늘로 바뀌어 복습이 1차부터 새로 시작된다
  if(mode==='rround'&&!redo&&r.ok&&!r.everWrong)markReviewDone(id,curRound);
  save();render();
}
function retry(){const ss=sess(),id=ss.ids[cur],r=ss.res[id];if(r){r.picked=null;delete pendingChoices[id];save();render();}}
function next(){
  if(cur<sess().ids.length-1){cur++;render();}
  else{view='result';render();}
}
async function saveSync(){
  cfg={url:document.getElementById('cUrl').value.trim(),key:document.getElementById('cKey').value.trim(),code:document.getElementById('cCode').value.trim()};
  localStorage.setItem(LS_CFG,JSON.stringify(cfg));
  setSync('');
  if(!syncOn()){setSync('');return;}
  const changed=await pull();
  if(!changed)await push();
  render();
}
function resetAll(){
  if(!confirm('모든 풀이 기록이 삭제돼요. 정말 지울까요?'))return;
  S=defaultState();save();view=curDeck?'area':'landing';render();
}


/* ============ 연결 링크 (다른 기기에서 열면 Supabase 설정이 자동 입력됨) ============ */
function applySyncLink(){
  const m=location.hash.match(/^#sync=(.+)$/);
  if(!m)return false;
  try{
    const o=JSON.parse(decodeURIComponent(m[1]));
    if(o&&o.url&&o.key&&o.code){
      cfg={url:String(o.url),key:String(o.key),code:String(o.code)};
      localStorage.setItem(LS_CFG,JSON.stringify(cfg));
      history.replaceState(null,'',location.pathname+location.search);
      return true;
    }
  }catch(_){}
  return false;
}
function copySyncLink(){
  const link=location.origin+location.pathname+'#sync='+encodeURIComponent(JSON.stringify({url:cfg.url,key:cfg.key,code:cfg.code}));
  const done=()=>alert('복사했어요. 다른 기기의 브라우저 주소창에 붙여넣어 열면 자동으로 연결돼요.\n(이 링크에는 동기화 코드가 들어 있으니 다른 사람에게 보내지 마세요.)');
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(link).then(done).catch(()=>prompt('이 링크를 복사하세요',link));
  else prompt('이 링크를 복사하세요',link);
}

/* ============ 문제 파일 불러오기 ============ */
// 결과: {state:'ok',data} / {state:'missing'}(없음) / {state:'bad'}(있는데 JSON 형식 오류)
async function fetchJson(url){
  let r;
  try{r=await fetch(url,{cache:'no-cache'});}catch(_){return {state:'missing'};}
  if(!r||!r.ok)return {state:'missing'};
  let text='';
  try{text=await r.text();}catch(_){return {state:'missing'};}
  try{const data=JSON.parse(text);return Array.isArray(data)?{state:'ok',data}:{state:'bad'};}
  catch(_){return /^\s*</.test(text)?{state:'missing'}:{state:'bad'};}   // 없는 주소에 HTML이 돌아오면 '없음'으로 본다
}
// years.json 에 적힌 연도의 폴더에서 영역별 JSON을 읽는다.
// 2020년 파일을 아직 옮기지 않았다면 기존 questions/ 폴더를 사용한다.
async function loadAllQuestions(){
  BAD=[];
  const manifest=await fetchJson('years.json');
  if(manifest.state==='bad')BAD.push('years.json');
  YEARS=manifest.state==='ok'
    ?[...new Set(manifest.data.map(String).filter(y=>/^\d{4}$/.test(y)))]
    :[LEGACY_YEAR];
  const parts=await Promise.all(YEARS.flatMap(year=>AREAS.map(async a=>{
    const out=[];
    let folder=year;
    if(year===LEGACY_YEAR){
      const first=await fetchJson(year+'/'+a.file+'.json');
      if(first.state==='missing')folder='questions';
    }
    for(let n=1;n<=60;n++){
      const path=folder+'/'+a.file+(n>1?'-'+n:'')+'.json';
      const r=await fetchJson(path);
      if(r.state==='missing')break;
      if(r.state==='bad'){BAD.push(path);continue;}
      r.data.forEach(q=>{
        q.deck=areaNameOf(q.deck||a.name);
        q.year=year;
        if(year!==LEGACY_YEAR)q.id=year+'/'+q.id;
      });
      out.push(...r.data);
    }
    return out;
  })));
  const old=await fetchJson('questions.json');
  if(old.state==='bad')BAD.push('questions.json');
  const legacy=old.state==='ok'&&YEARS.includes(LEGACY_YEAR)?old.data:[];
  legacy.forEach(q=>{q.deck=areaNameOf(q.deck);q.year=LEGACY_YEAR;});
  const all=[].concat(...parts,legacy);
  // 연도가 다른 동일 ID는 구분하되, 2020년 ID는 예전 기록과 연결한다.
  const seen=new Set(),seenText=new Set();
  return all.filter(q=>{
    const t=q.year+'|'+q.deck+'|'+q.question+'|'+(q.choices||[]).join('|');
    if(seen.has(q.id)||seenText.has(t))return false;
    seen.add(q.id);seenText.add(t);return true;
  });
}

/* ============ 시작 ============ */
async function init(){
  applySyncLink();
  await loadConfigFile();
  S=loadLocal();render();
  Q=await loadAllQuestions();
  if(!Q.length){
    loadNote=location.protocol==='file:'
      ?'파일을 그냥 더블클릭해서 열면 문제를 읽을 수 없어요. Netlify·GitHub Pages 같은 곳에 올리거나, 폴더에서 "python3 -m http.server"로 실행해 주세요.'
      :'아직 올라온 문제 파일이 없어요. 연도 폴더에 영역별 파일(예: 2010/'+AREAS[0].file+'.json)을 올리면 나와요.';
  }
  Q.forEach(q=>{q.deck=q.deck||'어휘';QB[q.id]=q;});
  DECKS=[...new Set(Q.map(q=>q.deck))];
  ALL=[...AREA_NAMES,...DECKS.filter(d=>!AREA_NAMES.includes(d))];
  ready=true;
  await pull();
  routeFromHash();render();
}
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||!S||!ready||!Q.length||view==='settings')return;
  if(await pull()){
    if(view==='quiz'||view==='result'){const ss=sess();if(!ss.ids.length||cur>=ss.ids.length)routeFromHash();}
    render();
  }
});
init();
