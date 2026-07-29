const firebaseConfig = {
  apiKey: "AIzaSyCC2Jp6uz0tLFpUwRzHABPGcg1JP4H0xkg",
  authDomain: "james-allen-cup-2026.firebaseapp.com",
  projectId: "james-allen-cup-2026",
  storageBucket: "james-allen-cup-2026.firebasestorage.app",
  messagingSenderId: "131020097886",
  appId: "1:131020097886:web:fcc0861bc195629780a7cf"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let firebaseUser = null;
let cloudReady = false;
let saveQueue = Promise.resolve();
let tournamentLocked = false;
let tournamentSettingsUnsubscribe = null;
let revealStarted = false;

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const screens=$$('.screen');
const games=[
 {id:'reaction',num:'I',icon:'⚡',title:'Reflex Protocol',desc:'React only when the signal turns green. Ten rounds. Every millisecond matters.',rules:['10 ROUNDS','LOWER IS BETTER','EARLY CLICKS PENALIZED']},
 {id:'typing',num:'II',icon:'⌨',title:'Typing Rush',desc:'Type a full passage under pressure. Speed and accuracy both determine your result.',rules:['75 SECONDS','WPM + ACCURACY','LONG-FORM PASSAGE']},
 {id:'memory',num:'III',icon:'▦',title:'Memory Matrix',desc:'Memorize increasingly complex patterns and reconstruct them from memory.',rules:['6 STAGES','3×3 TO 6×6','ACCURACY MATTERS']},
 {id:'deadeye',num:'IV',icon:'◎',title:'Deadeye',desc:'Hit thirty targets as they shrink and move faster. Misses break your combo.',rules:['30 TARGETS','SHRINKING SIZE','COMBO SCORING']},
 {id:'sequence',num:'V',icon:'◆',title:'Sequence Recall',desc:'Watch and repeat increasingly long tile sequences across nine levels.',rules:['9 LEVELS','LONGER EACH ROUND','ONE LIFE PER LEVEL']}
];
const defaultState={player:null,completed:[],scores:{},briefed:false};
let state=JSON.parse(localStorage.getItem('jacPhase2')||localStorage.getItem('jacPhase1')||'null')||structuredClone(defaultState);
let activeGame=null;
function save(){
  localStorage.setItem('jacPhase2',JSON.stringify(state));
  if(!cloudReady||!firebaseUser||!state.player)return;
  const finished=state.completed.length===games.length;
  const payload={
    uid:firebaseUser.uid,
    name:state.player.name,
    department:state.player.department,
    cupID:state.player.id,
    briefed:Boolean(state.briefed),
    completedGames:[...state.completed],
    games:{...state.scores},
    completed:finished,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  };
  if(finished)payload.completedAt=firebase.firestore.FieldValue.serverTimestamp();
  saveQueue=saveQueue.then(()=>db.collection('players').doc(firebaseUser.uid).set(payload,{merge:true})).catch(err=>console.error('Firestore save failed:',err));
}

function registrationKey(name,department){
  const raw=`${name.trim().toLowerCase().replace(/\s+/g,' ')}|${department.trim().toLowerCase()}`;
  let hash=2166136261;
  for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return `r_${(hash>>>0).toString(36)}`;
}

async function loadCloudState(){
  const snap=await db.collection('players').doc(firebaseUser.uid).get();
  if(!snap.exists)return;
  const data=snap.data();
  state={
    player:{name:data.name,department:data.department,id:data.cupID},
    completed:Array.isArray(data.completedGames)?data.completedGames:[],
    scores:data.games||{},
    briefed:Boolean(data.briefed)
  };
  localStorage.setItem('jacPhase2',JSON.stringify(state));
  setupPlayer();
  if(state.briefed)renderHub();
}

const firebaseReady=(async()=>{
  const credential=await auth.signInAnonymously();
  firebaseUser=credential.user;
  cloudReady=true;
  await loadCloudState();
  beginTournamentSettings();
  return firebaseUser;
})().catch(err=>{
  console.error('Firebase initialization failed:',err);
  cloudReady=false;
  return null;
});
function show(id,force=false){if(tournamentLocked&&!force&&id!=='champion-screen')return;screens.forEach(s=>s.classList.toggle('active',s.id===id));window.scrollTo({top:0,behavior:'smooth'})}
function cupId(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ';return `${a[Math.floor(Math.random()*a.length)]}${a[Math.floor(Math.random()*a.length)]}-${Math.floor(1000+Math.random()*9000)}`}

function escReveal(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function stopTournamentActivity(){
  tournamentLocked=true;
  if(rr?.timer)clearTimeout(rr.timer);
  if(tr?.timer)clearInterval(tr.timer);
  rr=null;tr=null;mr=null;dr=null;sr=null;
  const target=$('#deadeye-target');
  if(target)target.style.display='none';
  $('#typing-input')?.blur();
}
function beginTournamentSettings(){
  if(tournamentSettingsUnsubscribe)tournamentSettingsUnsubscribe();
  tournamentSettingsUnsubscribe=db.collection('settings').doc('tournament').onSnapshot(snapshot=>{
    if(!snapshot.exists)return;
    const settings=snapshot.data()||{};
    if(settings.locked)stopTournamentActivity();
    if(settings.revealed&&settings.locked)launchChampionReveal(settings);
  },error=>console.error('Tournament settings listener failed:',error));
}
function makeRevealParticles(){
  const host=$('#reveal-particles');
  if(!host||host.children.length)return;
  for(let i=0;i<34;i++){
    const particle=document.createElement('i');
    particle.style.setProperty('--x',`${Math.random()*100}%`);
    particle.style.setProperty('--delay',`${Math.random()*4}s`);
    particle.style.setProperty('--duration',`${5+Math.random()*5}s`);
    particle.style.setProperty('--size',`${2+Math.random()*4}px`);
    host.append(particle);
  }
}
function setRevealStage(stage){
  $$('.reveal-stage').forEach(el=>el.classList.toggle('visible',el.id===stage));
}
function renderFinalStandings(settings){
  const leaderboard=Array.isArray(settings.leaderboard)?settings.leaderboard:[];
  const podiumOrder=[leaderboard[1],leaderboard[0],leaderboard[2]].filter(Boolean);
  const podium=$('#podium');
  podium.innerHTML=podiumOrder.map(player=>`
    <article class="podium-card rank-${player.rank}">
      <span class="podium-rank">${player.rank===1?'♛':`#${player.rank}`}</span>
      <small>${escReveal(player.department||'—')}</small>
      <h3>${escReveal(player.name||'Unnamed')}</h3>
      <strong>${Number(player.overall||0).toFixed(1)}</strong>
      <em>POINTS</em>
    </article>`).join('');
  const table=$('#final-leaderboard');
  table.innerHTML=leaderboard.map(player=>`
    <div class="final-row ${player.rank<=3?'top-three':''}">
      <span class="final-rank">${player.rank===1?'♛':String(player.rank).padStart(2,'0')}</span>
      <div><strong>${escReveal(player.name||'Unnamed')}</strong><small>${escReveal(player.department||'—')} · ${Number(player.gamesPlayed||0)}/5 PLAYED</small></div>
      <b>${Number(player.overall||0).toFixed(1)}</b>
    </div>`).join('')||'<p class="empty-results">No official standings were recorded.</p>';
}
function launchChampionReveal(settings){
  if(revealStarted)return;
  revealStarted=true;
  stopTournamentActivity();
  makeRevealParticles();
  $('#champion-name').textContent=settings.championName||'CHAMPION';
  $('#champion-department').textContent=settings.championDepartment||'—';
  $('#champion-score').textContent=`${Number(settings.championScore||0).toFixed(1)} PTS`;
  renderFinalStandings(settings);
  show('champion-screen',true);
  document.body.classList.add('reveal-mode');
  setRevealStage('reveal-sync');
  setTimeout(()=>{
    setRevealStage('reveal-intro');
    const countdown=$('#reveal-countdown');
    let count=3;
    countdown.textContent=count;
    const timer=setInterval(()=>{
      count--;
      if(count>0){countdown.textContent=count;countdown.classList.remove('pop');void countdown.offsetWidth;countdown.classList.add('pop')}
      else{clearInterval(timer);countdown.textContent='';setTimeout(()=>setRevealStage('reveal-winner'),350)}
    },900);
  },2800);
}
$('#view-results-btn').addEventListener('click',()=>setRevealStage('reveal-standings'));

function setupPlayer(){if(!state.player)return; $('#welcome-name').textContent=state.player.name;$('#welcome-department').textContent=state.player.department;$('#cup-id').textContent=state.player.id;$('#hub-id').textContent=state.player.id;$('#complete-id').textContent=state.player.id;$('#complete-name').textContent=state.player.name.toUpperCase();}
function renderHub(){setupPlayer();const grid=$('#challenge-grid');grid.innerHTML='';games.forEach((g,i)=>{const done=state.completed.includes(g.id),ready=!done&&i===state.completed.length;const card=document.createElement('article');card.className=`challenge-card ${done?'completed':ready?'unlocked':'locked'}`;card.innerHTML=`<div class="challenge-top"><span>CHALLENGE ${g.num}</span><em>${done?'COMPLETE':ready?'READY':'LOCKED'}</em></div><div class="challenge-icon">${g.icon}</div><h3>${g.title}</h3><p>${g.desc}</p><button class="card-btn" ${ready?'':'disabled'}>${done?'COMPLETED':ready?'PLAY CHALLENGE':'LOCKED'}</button>`;if(ready)card.querySelector('button').addEventListener('click',()=>openMission(g.id));grid.append(card)});const p=state.completed.length/5*100;$('#progress-fill').style.width=p+'%';$('#progress-label').textContent=`${state.completed.length} / 5`;}
function openMission(id){activeGame=id;const g=games.find(x=>x.id===id);$('#mission-number').textContent=`CHALLENGE ${g.num}`;$('#mission-icon').textContent=g.icon;$('#mission-title').textContent=g.title;$('#mission-description').textContent=g.desc;$('#mission-rules').innerHTML=g.rules.map(r=>`<span>${r}</span>`).join('');show('mission-screen')}
function completeGame(id,score,copy){if(!state.completed.includes(id))state.completed.push(id);state.scores[id]=score;save();$('#result-title').textContent=games.find(g=>g.id===id).title+' Cleared';$('#result-copy').textContent=copy||'Your official result has been recorded.';show('result-screen')}
$('#enter-cup-btn').addEventListener('click',async()=>{
  await firebaseReady;
  if(state.player){setupPlayer();show(state.completed.length===5?'complete-screen':'hub-screen')}else show('register-screen')
});
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.go)));
$('#register-btn').addEventListener('click',async()=>{
  const name=$('#full-name').value.trim(),dept=$('#department').value;
  const error=$('#register-error');
  if(name.length<2||!dept){error.textContent='Enter your full name and select your department.';return}
  error.textContent='Connecting...';
  await firebaseReady;
  if(!firebaseUser){error.textContent='Unable to connect. Check your internet and try again.';return}
  const regRef=db.collection('registrations').doc(registrationKey(name,dept));
  try{
    const existing=await regRef.get();
    if(existing.exists&&existing.data().ownerUid!==firebaseUser.uid){error.textContent='This competitor is already registered.';return}
    const newPlayer={name,department:dept,id:cupId()};
    const playerRef=db.collection('players').doc(firebaseUser.uid);
    const batch=db.batch();
    if(!existing.exists)batch.set(regRef,{ownerUid:firebaseUser.uid,name,department:dept,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    batch.set(playerRef,{uid:firebaseUser.uid,name,department:dept,cupID:newPlayer.id,registeredAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),briefed:false,completedGames:[],games:{},completed:false});
    await batch.commit();
    state=structuredClone(defaultState);state.player=newPlayer;
    localStorage.setItem('jacPhase2',JSON.stringify(state));
    error.textContent='';setupPlayer();show('id-screen');
  }catch(err){console.error(err);error.textContent='Registration failed. Refresh and try again.'}
});
$('#continue-briefing-btn').addEventListener('click',()=>show('briefing-screen'));
$('#begin-btn').addEventListener('click',()=>{state.briefed=true;save();renderHub();show('hub-screen')});
$('#return-hub-btn').addEventListener('click',()=>{if(state.completed.length===5){setupPlayer();show('complete-screen')}else{renderHub();show('hub-screen')}});
$('#start-mission-btn').addEventListener('click',()=>({reaction:startReaction,typing:startTyping,memory:startMemory,deadeye:startDeadeye,sequence:startSequence}[activeGame]()))

let rr;
function startReaction(){rr={round:1,results:[],mode:'idle',timer:null,start:0,early:0};$('#reaction-history').innerHTML='';updateReaction();show('reaction-screen')}
function updateReaction(){clearTimeout(rr.timer);$('#reaction-round').textContent=`${rr.round} / 10`;const f=$('#reaction-field');f.className='reaction-field idle';$('#reaction-message').textContent='CLICK TO ARM';$('#reaction-submessage').textContent='Wait for green. Early clicks add a penalty.';rr.mode='idle'}
$('#reaction-field').addEventListener('click',()=>{if(!rr)return;const f=$('#reaction-field');if(rr.mode==='idle'){rr.mode='waiting';f.className='reaction-field waiting';$('#reaction-message').textContent='WAIT...';$('#reaction-submessage').textContent='Do not click yet.';rr.timer=setTimeout(()=>{rr.mode='ready';rr.start=performance.now();f.className='reaction-field ready';$('#reaction-message').textContent='CLICK!';$('#reaction-submessage').textContent='NOW';},1200+Math.random()*3000)}else if(rr.mode==='waiting'){clearTimeout(rr.timer);rr.early++;rr.mode='idle';$('#reaction-message').textContent='TOO EARLY';$('#reaction-submessage').textContent='Click again to re-arm this round.';f.className='reaction-field waiting'}else if(rr.mode==='ready'){const ms=Math.round(performance.now()-rr.start)+rr.early*150;rr.results.push(ms);$('#reaction-history').insertAdjacentHTML('beforeend',`<span>R${rr.round}: ${ms}ms</span>`);rr.round++;rr.early=0;if(rr.round>10){const avg=Math.round(rr.results.reduce((a,b)=>a+b,0)/rr.results.length);completeGame('reaction',{avg,rounds:rr.results},`Average reaction time: ${avg} ms.`)}else updateReaction()}})

const passage="Precision is built through repetition, patience, and attention to detail. In every high-pressure moment, the strongest performers remain calm, trust their preparation, and execute one deliberate action at a time. Speed matters, but control matters more. The James Allen Cup rewards competitors who can stay composed while the clock keeps moving. Focus on the next word, maintain a steady rhythm, and recover quickly from every mistake. Excellence is not one perfect moment; it is the result of consistent decisions made under pressure.";
let tr;
function startTyping(){tr={started:false,start:0,timer:null,time:75};const passageEl=$('#typing-passage');passageEl.replaceChildren(...[...passage].map((c,i)=>{const span=document.createElement('span');span.dataset.i=i;span.textContent=c;return span}));$('#typing-input').value='';$('#typing-time').textContent='75';$('#typing-wpm').textContent='0';$('#typing-accuracy').textContent='100%';$('#typing-mistakes').textContent='0';$('#typing-focus-status').textContent='Ready.';show('typing-screen');updateTyping();setTimeout(()=>focusTyping(),250)}
function focusTyping(){const input=$('#typing-input');input.focus({preventScroll:true});$('#typing-focus-status').textContent='Typing active.'}
$('#typing-passage').addEventListener('click',focusTyping);$('#typing-passage').addEventListener('focus',focusTyping);
$('#typing-input').addEventListener('input',()=>{if(!tr)return;if(!tr.started){tr.started=true;tr.start=Date.now();tr.timer=setInterval(()=>{tr.time--;$('#typing-time').textContent=tr.time;updateTyping();if(tr.time<=0)finishTyping()},1000)}updateTyping();if($('#typing-input').value.length>=passage.length)finishTyping()});
function updateTyping(){const v=$('#typing-input').value;let correct=0;const chars=[...$('#typing-passage').children];chars.forEach((s,i)=>{s.className='';if(i<v.length){if(v[i]===passage[i]){s.className='ok';correct++}else s.className='bad'}else if(i===v.length){s.className='current'}});const elapsed=Math.max((Date.now()-tr.start)/60000,1/60),words=correct/5,wpm=Math.round(words/elapsed),acc=v.length?Math.round(correct/v.length*100):100;$('#typing-wpm').textContent=wpm;$('#typing-accuracy').textContent=acc+'%';$('#typing-mistakes').textContent=v.length-correct}
function finishTyping(){if(!tr)return;clearInterval(tr.timer);const v=$('#typing-input').value;let correct=0;for(let i=0;i<v.length;i++)if(v[i]===passage[i])correct++;const elapsed=Math.max((Date.now()-tr.start)/60000,1/60),wpm=Math.round((correct/5)/elapsed),acc=v.length?Math.round(correct/v.length*100):100;tr=null;completeGame('typing',{wpm,accuracy:acc,typed:v.length},`${wpm} WPM at ${acc}% accuracy.`)}

let mr;
function startMemory(){mr={stage:1,selected:new Set(),pattern:new Set(),accept:false,totalCorrect:0};show('memory-screen');memoryStage()}
function memoryStage(){const size=[3,4,4,5,5,6][mr.stage-1],count=[3,5,7,8,10,12][mr.stage-1];mr.selected.clear();mr.pattern.clear();while(mr.pattern.size<count)mr.pattern.add(Math.floor(Math.random()*size*size));const board=$('#memory-board');board.style.gridTemplateColumns=`repeat(${size},1fr)`;board.innerHTML='';for(let i=0;i<size*size;i++){const b=document.createElement('button');b.className='memory-cell'+(mr.pattern.has(i)?' active':'');b.addEventListener('click',()=>{if(!mr.accept)return;b.classList.toggle('selected');mr.selected.has(i)?mr.selected.delete(i):mr.selected.add(i);$('#memory-submit-btn').disabled=false});board.append(b)}$('#memory-stage').textContent=`${mr.stage} / 6`;$('#memory-message').textContent='Memorize the illuminated cells.';$('#memory-submit-btn').disabled=true;setTimeout(()=>{$$('.memory-cell').forEach(c=>c.classList.remove('active'));mr.accept=true;$('#memory-message').textContent='Recreate the pattern.'},1800+mr.stage*220)}
$('#memory-submit-btn').addEventListener('click',()=>{if(!mr||!mr.accept)return;let correct=0;mr.selected.forEach(i=>{if(mr.pattern.has(i))correct++});const missed=[...mr.pattern].filter(i=>!mr.selected.has(i)).length,wrong=[...mr.selected].filter(i=>!mr.pattern.has(i)).length;mr.totalCorrect+=Math.max(0,correct-wrong-missed);mr.accept=false;if(mr.stage===6){completeGame('memory',{score:mr.totalCorrect},`Memory score recorded across six stages.`)}else{mr.stage++;$('#memory-message').textContent='Stage cleared. Preparing next matrix...';setTimeout(memoryStage,900)}})

let dr;
function startDeadeye(){dr={spawn:0,hits:0,misses:0,combo:0,maxCombo:0,start:Date.now()};show('deadeye-screen');$('#deadeye-arena').onclick=e=>{if(e.target.id!=='deadeye-target'){dr.misses++;dr.combo=0;updateDeadeyeHud()}};spawnTarget()}
function spawnTarget(){if(dr.spawn>=30){const duration=(Date.now()-dr.start)/1000;completeGame('deadeye',{hits:dr.hits,misses:dr.misses,maxCombo:dr.maxCombo,duration},`${dr.hits} hits, ${dr.misses} misses, best combo ${dr.maxCombo}.`);return}dr.spawn++;updateDeadeyeHud();const arena=$('#deadeye-arena'),t=$('#deadeye-target'),size=Math.max(28,72-dr.spawn*1.25),x=Math.random()*(arena.clientWidth-size),y=Math.random()*(arena.clientHeight-size);Object.assign(t.style,{width:size+'px',height:size+'px',left:x+'px',top:y+'px',display:'block'});t.onclick=e=>{e.stopPropagation();dr.hits++;dr.combo++;dr.maxCombo=Math.max(dr.maxCombo,dr.combo);t.style.display='none';setTimeout(spawnTarget,Math.max(120,420-dr.spawn*9))}}
function updateDeadeyeHud(){$('#deadeye-count').textContent=`${dr.spawn} / 30`;$('#deadeye-hits').textContent=dr.hits;$('#deadeye-misses').textContent=dr.misses;$('#deadeye-combo').textContent=dr.combo}

let sr;
function startSequence(){sr={level:1,seq:[],input:[],locked:true,score:0};const grid=$('#sequence-grid');grid.innerHTML='';for(let i=0;i<9;i++){const b=document.createElement('button');b.className='sequence-tile';b.dataset.i=i;b.addEventListener('click',()=>sequencePress(i,b));grid.append(b)}show('sequence-screen');sequenceLevel()}
function sequenceLevel(){sr.input=[];sr.seq=[];const len=sr.level+2;while(sr.seq.length<len){const n=Math.floor(Math.random()*9);if(n!==sr.seq.at(-1))sr.seq.push(n)}$('#sequence-level').textContent=`${sr.level} / 9`;$('#sequence-message').textContent='Watch the sequence.';$('#sequence-progress').innerHTML=sr.seq.map(()=>'<span></span>').join('');sr.locked=true;let i=0;const play=()=>{if(i>=sr.seq.length){sr.locked=false;$('#sequence-message').textContent='Repeat the sequence.';return}const tile=$$('.sequence-tile')[sr.seq[i]];tile.classList.add('active');setTimeout(()=>{tile.classList.remove('active');i++;setTimeout(play,160)},420-Math.min(sr.level*18,120))};setTimeout(play,600)}
function sequencePress(i,b){if(!sr||sr.locked)return;b.classList.add('active');setTimeout(()=>b.classList.remove('active'),120);const pos=sr.input.length;sr.input.push(i);if(i!==sr.seq[pos]){sr.locked=true;$('#sequence-message').textContent='Incorrect. Advancing with reduced score.';setTimeout(nextSequenceLevel,900);return}$('#sequence-progress').children[pos].classList.add('done');if(sr.input.length===sr.seq.length){sr.score+=sr.seq.length;sr.locked=true;$('#sequence-message').textContent='Sequence confirmed.';setTimeout(nextSequenceLevel,700)}}
function nextSequenceLevel(){if(sr.level===9){completeGame('sequence',{score:sr.score},`Sequence recall score: ${sr.score}.`)}else{sr.level++;sequenceLevel()}}

setupPlayer();if(state.player&&state.briefed){renderHub()}
firebaseReady.then(()=>{setupPlayer();if(state.player&&state.briefed)renderHub()});
