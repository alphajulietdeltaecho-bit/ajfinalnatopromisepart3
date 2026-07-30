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
 {id:'memory',num:'I',icon:'🃏',title:'Memory Cards',desc:'Flip cards and match all eight pairs using as few moves as possible.',rules:['8 PAIRS','TIME + MOVES','ONE OFFICIAL ATTEMPT']},
 {id:'deadeye',num:'II',icon:'◎',title:'Aim Trainer',desc:'Hit thirty targets as they shrink and move faster. Misses break your combo.',rules:['30 TARGETS','SHRINKING SIZE','COMBO SCORING']},
 {id:'typing',num:'III',icon:'⌨',title:'Typing Rush',desc:'Type a full passage under pressure. Speed and accuracy both determine your result.',rules:['75 SECONDS','WPM + ACCURACY','ONE OFFICIAL ATTEMPT']},
 {id:'stack',num:'IV',icon:'▰',title:'Stack Tower',desc:'Time each drop, trim the overhang, and build the tallest tower you can.',rules:['ONE-CLICK CONTROL','PERFECT COMBOS','MISS = GAME OVER']},
 {id:'sequence',num:'V',icon:'◆',title:'Sequence Recall',desc:'Finale: watch each pattern, then repeat it from memory as the sequence grows.',rules:['9 LEVELS','PATTERNS GET LONGER','SPEED INCREASES']}
];
const defaultState={player:null,completed:[],scores:{},briefed:false};
let state=JSON.parse(localStorage.getItem('jacPhase2')||localStorage.getItem('jacPhase1')||'null')||structuredClone(defaultState);
const validGameIds=new Set(games.map(g=>g.id));
state.completed=(state.completed||[]).filter(id=>validGameIds.has(id));
state.scores=Object.fromEntries(Object.entries(state.scores||{}).filter(([id])=>validGameIds.has(id)));
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
  const cloudCompleted=Array.isArray(data.completedGames)?data.completedGames.filter(id=>games.some(game=>game.id===id)):[];
  const cloudScores=Object.fromEntries(Object.entries(data.games||{}).filter(([id])=>games.some(game=>game.id===id)));
  state={
    player:{name:data.name,department:data.department==='FNB'?'HQ':data.department,id:data.cupID},
    completed:cloudCompleted,
    scores:cloudScores,
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
function show(id,force=false){if(tournamentLocked&&!force&&id!=='champion-screen')return;screens.forEach(s=>s.classList.toggle('active',s.id===id));if(id==='complete-screen')startCompletionCountdown();window.scrollTo({top:0,behavior:'smooth'})}
function cupId(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ';return `${a[Math.floor(Math.random()*a.length)]}${a[Math.floor(Math.random()*a.length)]}-${Math.floor(1000+Math.random()*9000)}`}

function escReveal(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function stopTournamentActivity(){
  tournamentLocked=true;
  if(tr?.timer)clearInterval(tr.timer);
  if(mcr?.timer)clearInterval(mcr.timer);
  if(str?.raf)cancelAnimationFrame(str.raf);
  tr=null;dr=null;mcr=null;str=null;sr=null;
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

let completionCountdownTimer=null;
function manilaRevealTarget(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return new Date(Date.UTC(parts.year,parts.month-1,parts.day,9,0,0))}
function startCompletionCountdown(){clearInterval(completionCountdownTimer);const display=$('#completion-countdown'),label=$('#completion-countdown-label');if(!display||!label)return;const target=manilaRevealTarget();const update=()=>{const remaining=Math.max(0,target-Date.now());const totalSeconds=Math.floor(remaining/1000);const hours=String(Math.floor(totalSeconds/3600)).padStart(2,'0');const minutes=String(Math.floor(totalSeconds%3600/60)).padStart(2,'0');const seconds=String(totalSeconds%60).padStart(2,'0');display.textContent=`${hours}:${minutes}:${seconds}`;if(remaining<=0){clearInterval(completionCountdownTimer);label.textContent='Awaiting the official reveal.'}};update();completionCountdownTimer=setInterval(update,1000)}
function setupPlayer(){if(!state.player)return;if(state.player.department==='FNB')state.player.department='HQ'; $('#welcome-name').textContent=state.player.name;$('#welcome-department').textContent=state.player.department;$('#cup-id').textContent=state.player.id;$('#hub-id').textContent=state.player.id;$('#complete-id').textContent=state.player.id;$('#complete-name').textContent=state.player.name.toUpperCase();}
function renderHub(){setupPlayer();const grid=$('#challenge-grid');grid.innerHTML='';games.forEach((g,i)=>{const done=state.completed.includes(g.id),ready=!done&&i===state.completed.length;const card=document.createElement('article');card.className=`challenge-card ${done?'completed':ready?'unlocked':'locked'}`;card.innerHTML=`<div class="challenge-top"><span>CHALLENGE ${g.num}</span><em>${done?'COMPLETE':ready?'READY':'LOCKED'}</em></div><div class="challenge-icon">${g.icon}</div><h3>${g.title}</h3><p>${g.desc}</p><button class="card-btn" ${ready?'':'disabled'}>${done?'COMPLETED':ready?'PLAY CHALLENGE':'LOCKED'}</button>`;if(ready)card.querySelector('button').addEventListener('click',()=>openMission(g.id));grid.append(card)});const p=state.completed.length/5*100;$('#progress-fill').style.width=p+'%';$('#progress-label').textContent=`${state.completed.length} / 5`;}
function openMission(id){activeGame=id;const g=games.find(x=>x.id===id);$('#mission-number').textContent=`CHALLENGE ${g.num}`;$('#mission-icon').textContent=g.icon;$('#mission-title').textContent=g.title;$('#mission-description').textContent=g.desc;$('#mission-rules').innerHTML=g.rules.map(r=>`<span>${r}</span>`).join('');show('mission-screen')}
function completeGame(id,score){if(!state.completed.includes(id))state.completed.push(id);state.scores[id]=score;save();$('#result-title').textContent=games.find(g=>g.id===id).title+' Cleared';$('#result-copy').textContent='Your performance has been recorded.';show('result-screen')}
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
$('#start-mission-btn').addEventListener('click',()=>({memory:startMemoryCards,deadeye:startDeadeye,typing:startTyping,stack:startStackTower,sequence:startSequence}[activeGame])())

const passage="Minsan, kailangan munang magkalayo ang dalawang taong nagmamahalan para maintindihan ang tunay na halaga ng isa't isa. Natutunan nina Popoy at Basha na ang pagmamahal ay hindi lang tungkol sa pananatili, kundi tungkol din sa pagrespeto sa mga pangarap at pagkatao ng bawat isa. Sa huli, hindi sila nagkabalikan dahil lang mahal pa nila ang isa't isa, kundi dahil pareho na silang nagbago at naging mas mature bilang tao.";
let tr;
function startTyping(){tr={started:false,start:0,timer:null,time:75,finished:false};const passageEl=$('#typing-passage');passageEl.replaceChildren(...[...passage].map((c,i)=>{const span=document.createElement('span');span.dataset.i=i;span.textContent=c;return span}));$('#typing-input').value='';$('#typing-time').textContent='75';$('#typing-wpm').textContent='0';$('#typing-accuracy').textContent='100%';$('#typing-mistakes').textContent='0';$('#typing-focus-status').textContent='Ready.';show('typing-screen');updateTyping();setTimeout(()=>focusTyping(),250)}
function focusTyping(){const input=$('#typing-input');input.focus({preventScroll:true});$('#typing-focus-status').textContent='Typing active.'}
$('#typing-passage').addEventListener('click',focusTyping);$('#typing-passage').addEventListener('focus',focusTyping);
$('#typing-input').addEventListener('input',()=>{if(!tr||tr.finished)return;if(!tr.started){tr.started=true;tr.start=Date.now();tr.timer=setInterval(()=>{tr.time--;$('#typing-time').textContent=tr.time;updateTyping();if(tr.time<=0)finishTyping()},1000)}updateTyping();if($('#typing-input').value.length>=passage.length)finishTyping()});
function updateTyping(){if(!tr)return;const v=$('#typing-input').value;let correct=0;const chars=[...$('#typing-passage').children];chars.forEach((span,i)=>{span.className='';if(i<v.length){if(v[i]===passage[i]){span.className='ok';correct++}else span.className='bad'}else if(i===v.length){span.className='current'}});const elapsed=tr.started?Math.max((Date.now()-tr.start)/60000,1/60):1/60,words=correct/5,wpm=Math.round(words/elapsed),acc=v.length?Math.round(correct/v.length*100):100;$('#typing-wpm').textContent=wpm;$('#typing-accuracy').textContent=acc+'%';$('#typing-mistakes').textContent=v.length-correct}
function finishTyping(){if(!tr||tr.finished)return;tr.finished=true;clearInterval(tr.timer);const v=$('#typing-input').value;let correct=0;for(let i=0;i<v.length;i++)if(v[i]===passage[i])correct++;const elapsed=Math.max((Date.now()-tr.start)/60000,1/60),wpm=Math.round((correct/5)/elapsed),accuracy=v.length?Math.round(correct/v.length*100):100;tr=null;completeGame('typing',{wpm,accuracy,typed:v.length})}

let dr;
function startDeadeye(){dr={spawn:0,hits:0,misses:0,combo:0,maxCombo:0,start:Date.now()};show('deadeye-screen');$('#deadeye-arena').onclick=e=>{if(!dr)return;if(e.target.id!=='deadeye-target'){dr.misses++;dr.combo=0;updateDeadeyeHud()}};spawnTarget()}
function spawnTarget(){if(!dr)return;if(dr.spawn>=30){const duration=(Date.now()-dr.start)/1000;const result={hits:dr.hits,misses:dr.misses,maxCombo:dr.maxCombo,duration};dr=null;completeGame('deadeye',result);return}dr.spawn++;updateDeadeyeHud();const arena=$('#deadeye-arena'),target=$('#deadeye-target'),size=Math.max(28,72-dr.spawn*1.25),x=Math.random()*Math.max(1,arena.clientWidth-size),y=Math.random()*Math.max(1,arena.clientHeight-size);Object.assign(target.style,{width:size+'px',height:size+'px',left:x+'px',top:y+'px',display:'block'});target.onclick=e=>{e.stopPropagation();if(!dr)return;dr.hits++;dr.combo++;dr.maxCombo=Math.max(dr.maxCombo,dr.combo);target.style.display='none';setTimeout(spawnTarget,Math.max(120,420-dr.spawn*9))}}
function updateDeadeyeHud(){if(!dr)return;$('#deadeye-count').textContent=`${dr.spawn} / 30`;$('#deadeye-hits').textContent=dr.hits;$('#deadeye-misses').textContent=dr.misses;$('#deadeye-combo').textContent=dr.combo}

const memorySymbols=['☕','🍩','🥐','🧁','🍪','🍓','🍫','🥛'];
let mcr;
function startMemoryCards(){const deck=[...memorySymbols,...memorySymbols].sort(()=>Math.random()-.5);mcr={deck,open:[],matched:new Set(),moves:0,start:performance.now(),timer:null,locked:false};$('#memory-pairs').textContent='0 / 8';$('#memory-moves').textContent='0';$('#memory-time').textContent='0.0';$('#memory-message').textContent='Match all eight pairs as quickly as possible.';const board=$('#memory-board');board.innerHTML='';deck.forEach((symbol,index)=>{const button=document.createElement('button');button.className='memory-card';button.dataset.i=index;button.innerHTML=`<span class="card-back">?</span><span class="card-face">${symbol}</span>`;button.addEventListener('click',()=>flipMemoryCard(index));board.append(button)});show('memory-screen');mcr.timer=setInterval(()=>{if(mcr)$('#memory-time').textContent=((performance.now()-mcr.start)/1000).toFixed(1)},100)}
function flipMemoryCard(index){if(!mcr||mcr.locked||mcr.open.includes(index)||mcr.matched.has(index))return;const button=$(`.memory-card[data-i="${index}"]`);button.classList.add('flipped');mcr.open.push(index);if(mcr.open.length<2)return;mcr.moves++;$('#memory-moves').textContent=mcr.moves;const [a,b]=mcr.open;if(mcr.deck[a]===mcr.deck[b]){mcr.matched.add(a);mcr.matched.add(b);mcr.open=[];$('#memory-pairs').textContent=`${mcr.matched.size/2} / 8`;if(mcr.matched.size===mcr.deck.length)finishMemoryCards()}else{mcr.locked=true;setTimeout(()=>{[a,b].forEach(i=>$(`.memory-card[data-i="${i}"]`)?.classList.remove('flipped'));mcr.open=[];mcr.locked=false},650)}}
function finishMemoryCards(){if(!mcr)return;clearInterval(mcr.timer);const time=(performance.now()-mcr.start)/1000,result={time:Number(time.toFixed(2)),moves:mcr.moves,pairs:8};mcr=null;completeGame('memory',result)}

let str=null;
function startStackTower(){
  const canvas=$('#stack-canvas'),ctx=canvas.getContext('2d'),stage=$('#stack-stage'),overlay=$('#stack-overlay');
  const fit=()=>{const rect=stage.getBoundingClientRect();canvas.style.width=rect.width+'px';canvas.style.height=Math.min(520,Math.max(390,rect.width*.68))+'px'};fit();
  str={canvas,ctx,blocks:[{x:230,y:470,w:300,h:28}],moving:{x:40,y:442,w:300,h:28,dir:1,speed:3.2},height:0,perfects:0,combo:0,score:0,camera:0,started:false,over:false,last:performance.now(),raf:0,particles:[]};
  $('#stack-height').textContent='0';$('#stack-perfects').textContent='0';$('#stack-combo').textContent='0';$('#stack-score').textContent='0';
  overlay.classList.remove('hidden');show('stack-screen');drawStack();
  str.raf=requestAnimationFrame(stackLoop);
}
function stackLoop(now){if(!str||str.over)return;const dt=Math.min(2.2,(now-str.last)/16.67);str.last=now;if(str.started){const m=str.moving;m.x+=m.speed*m.dir*dt;if(m.x<8){m.x=8;m.dir=1}else if(m.x+m.w>str.canvas.width-8){m.x=str.canvas.width-8-m.w;m.dir=-1}str.particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.35*dt;p.life-=dt});str.particles=str.particles.filter(p=>p.life>0)}drawStack();str.raf=requestAnimationFrame(stackLoop)}
function drawStack(){if(!str)return;const {ctx,canvas}=str;ctx.clearRect(0,0,canvas.width,canvas.height);const bg=ctx.createLinearGradient(0,0,0,canvas.height);bg.addColorStop(0,'#0b121a');bg.addColorStop(1,'#07090c');ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='rgba(255,255,255,.035)';for(let y=20;y<canvas.height;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke()}const offset=str.camera;str.blocks.forEach((b,i)=>drawBlock(b.x,b.y+offset,b.w,b.h,i));if(str.moving)drawBlock(str.moving.x,str.moving.y+offset,str.moving.w,str.moving.h,str.blocks.length,true);str.particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life/30);ctx.fillStyle='#d5a94a';ctx.fillRect(p.x,p.y+offset,p.size,p.size)});ctx.globalAlpha=1}
function drawBlock(x,y,w,h,index,moving=false){const ctx=str.ctx,g=ctx.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,moving?'#f4d47b':'#d5a94a');g.addColorStop(1,moving?'#b78327':'#7f5b1e');ctx.fillStyle=g;ctx.shadowColor='rgba(213,169,74,.28)';ctx.shadowBlur=moving?18:8;ctx.fillRect(x,y,w,h);ctx.shadowBlur=0;ctx.fillStyle='rgba(255,255,255,.22)';ctx.fillRect(x,y,w,3)}
function stackDrop(){if(!str||str.over)return;$('#stack-overlay').classList.add('hidden');if(!str.started){str.started=true;return}const m=str.moving,base=str.blocks.at(-1),left=Math.max(m.x,base.x),right=Math.min(m.x+m.w,base.x+base.w),overlap=right-left;if(overlap<=0){finishStackTower();return}const delta=Math.abs(m.x-base.x),perfect=delta<=5;let x=left,w=overlap;if(perfect){x=base.x;w=base.w;str.perfects++;str.combo++;flashStack(`PERFECT ×${str.combo}`);for(let i=0;i<14;i++)str.particles.push({x:x+w/2,y:m.y,vx:(Math.random()-.5)*5,vy:-Math.random()*4,size:2+Math.random()*3,life:22+Math.random()*15})}else{str.combo=0;flashStack(`+${str.height+1}`)}str.height++;str.score+=100+str.combo*25+Math.round(w/5);str.blocks.push({x,y:m.y,w,h:m.h});const cutLeft=m.x<x,cutW=m.w-w;if(cutW>1){const cutX=cutLeft?m.x:x+w;for(let i=0;i<8;i++)str.particles.push({x:cutX+Math.random()*cutW,y:m.y,vx:(cutLeft?-1:1)*(1+Math.random()*3),vy:Math.random()*2,size:2+Math.random()*4,life:22+Math.random()*14})}const nextY=m.y-m.h;if(nextY<170)str.camera+=m.h;str.moving={x:m.dir>0?8:str.canvas.width-8-w,y:nextY,w,h:m.h,dir:m.dir,speed:Math.min(8.2,3.2+str.height*.16)};updateStackHud()}
function flashStack(text){const el=$('#stack-flash');el.textContent=text;el.classList.remove('show');void el.offsetWidth;el.classList.add('show')}
function updateStackHud(){if(!str)return;$('#stack-height').textContent=str.height;$('#stack-perfects').textContent=str.perfects;$('#stack-combo').textContent=str.combo;$('#stack-score').textContent=str.score}
function finishStackTower(){if(!str||str.over)return;str.over=true;cancelAnimationFrame(str.raf);flashStack('TOWER ENDED');const result={height:str.height,perfects:str.perfects,maxWidth:Number((str.blocks.at(-1)?.w||0).toFixed(1)),score:str.score};setTimeout(()=>{str=null;completeGame('stack',result)},850)}
$('#stack-stage').addEventListener('pointerdown',e=>{e.preventDefault();stackDrop()});
window.addEventListener('keydown',e=>{if(e.code==='Space'&&str){e.preventDefault();stackDrop()}});

let sr;
function startSequence(){sr={level:1,seq:[],input:[],locked:true,score:0,correctLevels:0};const grid=$('#sequence-grid');grid.innerHTML='';for(let i=0;i<9;i++){const b=document.createElement('button');b.className='sequence-tile';b.dataset.i=i;b.setAttribute('aria-label',`Sequence tile ${i+1}`);b.addEventListener('click',()=>sequencePress(i,b));grid.append(b)}show('sequence-screen');sequenceLevel()}
function sequenceLevel(){if(!sr)return;sr.input=[];sr.seq=[];const len=sr.level+2;while(sr.seq.length<len){const n=Math.floor(Math.random()*9);if(n!==sr.seq.at(-1))sr.seq.push(n)}$('#sequence-level').textContent=`${sr.level} / 9`;$('#sequence-message').textContent='Watch the sequence.';$('#sequence-progress').innerHTML=sr.seq.map(()=>'<span></span>').join('');sr.locked=true;let i=0;const play=()=>{if(!sr)return;if(i>=sr.seq.length){sr.locked=false;$('#sequence-message').textContent='Repeat the sequence.';return}const tile=$$('.sequence-tile')[sr.seq[i]];tile.classList.add('active');setTimeout(()=>{tile.classList.remove('active');i++;setTimeout(play,150)},Math.max(210,430-sr.level*20))};setTimeout(play,650)}
function sequencePress(i,b){if(!sr||sr.locked)return;b.classList.add('active');setTimeout(()=>b.classList.remove('active'),130);const pos=sr.input.length;sr.input.push(i);if(i!==sr.seq[pos]){sr.locked=true;$('#sequence-message').textContent='Incorrect. Preparing the next level.';setTimeout(nextSequenceLevel,850);return}$('#sequence-progress').children[pos]?.classList.add('done');if(sr.input.length===sr.seq.length){sr.score+=sr.seq.length;sr.correctLevels++;sr.locked=true;$('#sequence-message').textContent='Sequence confirmed.';setTimeout(nextSequenceLevel,650)}}
function nextSequenceLevel(){if(!sr)return;if(sr.level===9){const result={score:sr.score,maxScore:63,correctLevels:sr.correctLevels};sr=null;completeGame('sequence',result)}else{sr.level++;sequenceLevel()}}

setupPlayer();if(state.player&&state.briefed){renderHub()}
firebaseReady.then(()=>{setupPlayer();if(state.player&&state.briefed)renderHub()});
