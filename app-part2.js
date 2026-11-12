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
  const historical=ids.filter(id=>!(S.res[id]&&S.res[id].tries>0)&&(S.stats[id]||{}).seen>0).length;
  const fl=flaggedIds(dk),often=fl.filter(id=>wrongOf(id)>=2).length;
  const rv=S.review[reviewKey()],rvIds=rv?rv.ids.filter(id=>QB[id]):[],rvDone=rv?answeredIn(rvIds,rv.res):0;
  const resume=!!(rv&&rvIds.length&&rvDone<rvIds.length);
  const label=solved===0?'시작하기':solved<n?'이어서 풀기':'결과 보기';
  $app.innerHTML=`${top}
    <h1>${e(curYear)}년 · ${e(dk)}</h1>
    <p class="sub">전체 ${n}문제 · ${solved}개 풀었어요${historical?` · 이전 풀이 ${historical}개 (선택 답 기록 없음)`:''}</p>
    ${bad.length?`<div class="notice">${e('읽지 못한 파일이 있어요 (형식 오류): '+bad.join(', '))}</div>`:''}
    <div class="panel">${dotsHtml(ids,S.res,'openAt')}
      <p class="legend">번호를 누르면 그 문제로 가요. 초록은 맞음, 빨강은 틀림, 연한 파랑은 이전에 푼 기록만 남은 문제예요. 모서리의 빨간 점은 틀린 적이 있는 문제예요.</p>
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
    return `<button class="choice ${cls}" ${answered?'disabled':''} ${multi?`aria-pressed="${selected.includes(i)}"`:''} onclick="${multi?'toggleChoice':'pick'}(${i})"><span class="n">${i+1}</span><span class="t">${textWithImages(c,'choice-img',`${i+1}번 보기 그림`)}</span></button>`;
  }).join('');
  const submit=multi&&!answered?`<button class="btn submit-answers" id="submitAnswers" onclick="submitMultiple()" ${selected.length?'':'disabled'}>선택한 답 제출</button>`:'';
  const questionTables=Array.isArray(q.tables)?q.tables:(Array.isArray(q.table)?[{rows:q.table}]:[]);
  const qTable=questionTables.map(block=>{
    const rows=block.rows||[];
    if(!rows.length)return '';
    return `${block.title?`<p class="question-table-title">${e(block.title)}</p>`:''}<div class="tbl-wrap"><table class="tbl${rows[0].length>=4?' wide':''}"><thead><tr>${rows[0].map(c=>`<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(c=>`<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }).join('');
  const questionHasImage=hasImageUrl(q.question);
  const questionImgBase=questionHasImage?null:imageBase(q,'question');
  const questionImg=questionHasImage?'':q.image?`<img class="qimg" src="${e(q.image)}" alt="문제 그림">`
    :(questionImgBase?`<div class="question-imgs" data-base="${e(questionImgBase)}"></div>`:'');
  const explImgBase=answered?imageBase(q,'explanation'):null;
  const legacyExplBase=explImgBase&&q.year===LEGACY_YEAR
    ?LEGACY_EXPL_IMG_DIR+explImgBase.split('/').pop():'';
  const imgSlot=explImgBase?`<div class="expl-imgs" data-base="${e(explImgBase)}" data-fallback="${e(legacyExplBase)}"></div>`:'';
  const explContent=explanationHtml(q.explanation);
  const verdict=answered?`<div class="verdict ${ok?'ok':'ng'}">
      <h3>${ok?'정답이에요!':'아쉬워요. 정답은 '+correct.map(i=>(i+1)+'번').join(', ')}</h3>
      ${explContent||imgSlot?`<section class="explanation" aria-label="해설"><h4>해설</h4>
      ${EXPL_IMG_POS==='top'?imgSlot:''}${explContent}${EXPL_IMG_POS==='top'?'':imgSlot}</section>`:''}</div>`:'';
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
    <div class="qtext">${questionHtml(q.question)}${qTable}</div>
    ${questionImg}
    <div class="choices">${ch}</div>
    ${submit}
    ${verdict}${footer}`;
  fillImages('.question-imgs','qimg','문제 그림');
  fillImages('.expl-imgs','expl-img','풀이 그림');
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
      ${syncOn()?`<button class="btn small ghost" style="margin-top:12px" onclick="restoreFromSupabase()">Supabase 기록 다시 가져오기</button>`:''}
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
function startReview(resume){
  if(!resume)S.review[reviewKey()]={ids:flaggedIds(curDeck),res:{}};
  mode='review';
  const ss=sess();
  if(!ss.ids.length){mode='all';return render();}
  const i=ss.ids.findIndex(id=>!(ss.res[id]&&ss.res[id].tries>0));
  cur=Math.max(0,i);save();view='quiz';render();
}
function startRound(n,resume){
  curRound=n;mode='rround';
  const T=todayStr(),rs=S.rsess[n];
  if(!(resume&&rs&&rs.date===T)){const ids=reviewDue(n);S.rsess[n]={date:T,ids,all:ids.slice(),res:{}};}
  const ss=sess();
  if(!ss.ids.length){mode='all';return render();}
  cur=Math.max(0,ss.ids.findIndex(id=>!(ss.res[id]&&ss.res[id].tries>0)));
  save();view='quiz';render();
}
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
  await pull();
  render();
}
async function restoreFromSupabase(){
  if(!syncOn()){alert('먼저 Supabase 연결 정보를 입력하세요.');return;}
  try{
    const r=await fetch(base()+'?id=eq.'+encodeURIComponent(cfg.code)+'&select=data',{headers:hdr()});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const rows=await r.json(), remote=rows[0]&&rows[0].data;
    if(!remote||isPristine(migrate(remote))){setSync('missing');alert('이 주소와 코드에서 풀이 기록을 찾지 못했어요. Project URL과 동기화 코드를 확인하세요.');return;}
    const ids=Object.keys(remote.stats||{}), count=ids.length, matched=ids.filter(id=>QB[id]).length;
    if(!confirm('Supabase 기록 '+count+'개 중 현재 문제와 일치하는 기록은 '+matched+'개예요. 이 기기의 현재 기록을 백업하고 가져올까요?'))return;
    localStorage.setItem(LS_STATE+'.backup.'+Date.now(),JSON.stringify(S));
    S=migrate(remote);localStorage.setItem(LS_STATE,JSON.stringify(S));setSync('ok');render();
    alert('기록을 가져왔어요.');
  }catch(err){setSync('err');alert('기록을 읽지 못했어요: '+err.message);}
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
async function fetchJson(url){
  let r;
  try{r=await fetch(url,{cache:'no-cache'});}catch(_){return {state:'missing'};}
  if(!r||!r.ok)return {state:'missing'};
  let text='';
  try{text=await r.text();}catch(_){return {state:'missing'};}
  try{const data=JSON.parse(text);return Array.isArray(data)?{state:'ok',data}:{state:'bad'};}
  catch(_){return /^\s*</.test(text)?{state:'missing'}:{state:'bad'};}   // 없는 주소에 HTML이 돌아오면 '없음'으로 본다
}
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
