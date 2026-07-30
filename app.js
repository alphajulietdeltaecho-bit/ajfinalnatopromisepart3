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
 {id:'typing',num:'I',icon:'⌨',title:'Typing Rush',desc:'Type a full passage under pressure. Speed and accuracy both determine your result.',rules:['75 SECONDS','WPM + ACCURACY','ONE OFFICIAL ATTEMPT']},
 {id:'deadeye',num:'II',icon:'◎',title:'Aim Trainer',desc:'Hit thirty targets as they shrink and move faster. Misses break your combo.',rules:['30 TARGETS','SHRINKING SIZE','COMBO SCORING']},
 {id:'minesweeper',num:'III',icon:'💣',title:'Minesweeper Sprint',desc:'Reveal every safe tile as quickly as possible. Mine hits add time, but do not end the run.',rules:['5×5 BOARD','5 HIDDEN MINES','FIRST CLICK SAFE']},
 {id:'memory',num:'IV',icon:'🃏',title:'Memory Cards',desc:'Flip cards and match all eight pairs using as few moves as possible.',rules:['8 PAIRS','TIME + MOVES','MATCH EVERY CARD']},
 {id:'coffee',num:'V',icon:'☕',title:'Coffee Rush',desc:'Finale: build and serve as many café orders as possible before time runs out.',rules:['45 SECONDS','BUILD IN ORDER','COMBO BONUS']}
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
  if(msr?.timer)clearInterval(msr.timer);
  if(mcr?.timer)clearInterval(mcr.timer);
  if(cr?.timer)clearInterval(cr.timer);
  tr=null;dr=null;msr=null;mcr=null;cr=null;
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
$('#start-mission-btn').addEventListener('click',()=>({typing:startTyping,deadeye:startDeadeye,minesweeper:startMinesweeper,memory:startMemoryCards,coffee:startCoffeeRush}[activeGame])())

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

let msr;
function startMinesweeper(){msr={size:5,mines:5,board:[],revealed:new Set(),flagged:new Set(),mineHits:0,started:false,start:0,timer:null,finished:false};$('#mine-time').textContent='0.0';$('#mine-message').textContent='Reveal every safe tile. Right-click to place a flag.';buildMineBoard();updateMineHud();show('minesweeper-screen')}
function mineKey(row,col){return row*msr.size+col}
function mineNeighbors(index){const row=Math.floor(index/msr.size),col=index%msr.size,out=[];for(let r=row-1;r<=row+1;r++)for(let c=col-1;c<=col+1;c++)if(r>=0&&c>=0&&r<msr.size&&c<msr.size&&(r!==row||c!==col))out.push(mineKey(r,c));return out}
function generateMines(firstIndex){const forbidden=new Set([firstIndex,...mineNeighbors(firstIndex)]),choices=[];for(let i=0;i<msr.size*msr.size;i++)if(!forbidden.has(i))choices.push(i);for(let i=choices.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]]}const mineSet=new Set(choices.slice(0,msr.mines));msr.board=Array.from({length:msr.size*msr.size},(_,i)=>({mine:mineSet.has(i),count:0}));msr.board.forEach((cell,i)=>{if(!cell.mine)cell.count=mineNeighbors(i).filter(n=>mineSet.has(n)).length})}
function buildMineBoard(){const board=$('#mine-board');board.innerHTML='';board.style.gridTemplateColumns=`repeat(${msr.size},1fr)`;for(let i=0;i<msr.size*msr.size;i++){const button=document.createElement('button');button.className='mine-cell';button.dataset.i=i;button.setAttribute('aria-label',`Tile ${i+1}`);button.addEventListener('click',()=>revealMineCell(i));button.addEventListener('contextmenu',event=>{event.preventDefault();toggleMineFlag(i)});board.append(button)}}
function startMineTimer(){if(msr.started)return;msr.started=true;msr.start=performance.now();msr.timer=setInterval(()=>$('#mine-time').textContent=((performance.now()-msr.start)/1000+msr.mineHits*5).toFixed(1),100)}
function revealMineCell(index){if(!msr||msr.finished||msr.flagged.has(index)||msr.revealed.has(index))return;if(!msr.started){generateMines(index);startMineTimer()}const cell=msr.board[index];if(cell.mine){msr.mineHits++;msr.flagged.add(index);const button=$(`.mine-cell[data-i="${index}"]`);button.classList.add('mine-hit');button.textContent='💥';$('#mine-message').textContent='Mine hit: +5 seconds. Keep going!';updateMineHud();return}revealSafeArea(index);updateMineHud();const safeTotal=msr.size*msr.size-msr.mines;if(msr.revealed.size>=safeTotal)finishMinesweeper()}
function revealSafeArea(startIndex){const queue=[startIndex];while(queue.length){const index=queue.shift();if(msr.revealed.has(index)||msr.flagged.has(index)||msr.board[index].mine)continue;msr.revealed.add(index);const cell=msr.board[index],button=$(`.mine-cell[data-i="${index}"]`);button.classList.add('revealed');button.textContent=cell.count||'';if(cell.count===0)mineNeighbors(index).forEach(n=>queue.push(n))}}
function toggleMineFlag(index){if(!msr||msr.finished||msr.revealed.has(index))return;if(msr.flagged.has(index)){msr.flagged.delete(index)}else if(msr.flagged.size<msr.mines){msr.flagged.add(index)}const button=$(`.mine-cell[data-i="${index}"]`);button.classList.toggle('flagged',msr.flagged.has(index));if(!button.classList.contains('mine-hit'))button.textContent=msr.flagged.has(index)?'⚑':'';updateMineHud()}
function updateMineHud(){if(!msr)return;$('#mine-safe').textContent=`${msr.revealed.size} / ${msr.size*msr.size-msr.mines}`;$('#mine-flags').textContent=`${msr.flagged.size} / ${msr.mines}`;$('#mine-hits').textContent=msr.mineHits}
function finishMinesweeper(){if(!msr||msr.finished)return;msr.finished=true;clearInterval(msr.timer);const rawTime=(performance.now()-msr.start)/1000,penalty=msr.mineHits*5,totalTime=rawTime+penalty;const result={time:Number(totalTime.toFixed(2)),rawTime:Number(rawTime.toFixed(2)),mineHits:msr.mineHits};msr=null;completeGame('minesweeper',result)}

const memorySymbols=['☕','🍩','🥐','🧁','🍪','🍓','🍫','🥛'];
let mcr;
function startMemoryCards(){const deck=[...memorySymbols,...memorySymbols].sort(()=>Math.random()-.5);mcr={deck,open:[],matched:new Set(),moves:0,start:performance.now(),timer:null,locked:false};$('#memory-pairs').textContent='0 / 8';$('#memory-moves').textContent='0';$('#memory-time').textContent='0.0';$('#memory-message').textContent='Match all eight pairs as quickly as possible.';const board=$('#memory-board');board.innerHTML='';deck.forEach((symbol,index)=>{const button=document.createElement('button');button.className='memory-card';button.dataset.i=index;button.innerHTML=`<span class="card-back">?</span><span class="card-face">${symbol}</span>`;button.addEventListener('click',()=>flipMemoryCard(index));board.append(button)});show('memory-screen');mcr.timer=setInterval(()=>{if(mcr)$('#memory-time').textContent=((performance.now()-mcr.start)/1000).toFixed(1)},100)}
function flipMemoryCard(index){if(!mcr||mcr.locked||mcr.open.includes(index)||mcr.matched.has(index))return;const button=$(`.memory-card[data-i="${index}"]`);button.classList.add('flipped');mcr.open.push(index);if(mcr.open.length<2)return;mcr.moves++;$('#memory-moves').textContent=mcr.moves;const [a,b]=mcr.open;if(mcr.deck[a]===mcr.deck[b]){mcr.matched.add(a);mcr.matched.add(b);mcr.open=[];$('#memory-pairs').textContent=`${mcr.matched.size/2} / 8`;if(mcr.matched.size===mcr.deck.length)finishMemoryCards()}else{mcr.locked=true;setTimeout(()=>{[a,b].forEach(i=>$(`.memory-card[data-i="${i}"]`)?.classList.remove('flipped'));mcr.open=[];mcr.locked=false},650)}}
function finishMemoryCards(){if(!mcr)return;clearInterval(mcr.timer);const time=(performance.now()-mcr.start)/1000,result={time:Number(time.toFixed(2)),moves:mcr.moves,pairs:8};mcr=null;completeGame('memory',result)}

const coffeeIngredients=[['espresso','Espresso','☕'],['milk','Milk','🥛'],['ice','Ice','🧊'],['chocolate','Chocolate','🍫'],['vanilla','Vanilla','🌼'],['foam','Foam','☁️']];
const coffeeOrders=[
 {name:'Espresso',recipe:['espresso']},{name:'Iced Americano',recipe:['ice','espresso']},{name:'Latte',recipe:['espresso','milk','foam']},{name:'Iced Latte',recipe:['ice','milk','espresso']},{name:'Mocha',recipe:['chocolate','espresso','milk']},{name:'Vanilla Latte',recipe:['vanilla','espresso','milk','foam']},{name:'Iced Mocha',recipe:['chocolate','ice','milk','espresso']}
];
let cr;
function startCoffeeRush(){cr={time:45,served:0,combo:0,maxCombo:0,attempts:0,correctActions:0,totalActions:0,current:[],order:null,timer:null,finished:false};$('#coffee-time').textContent='45';$('#coffee-served').textContent='0';$('#coffee-combo').textContent='0';$('#coffee-accuracy').textContent='100%';const grid=$('#coffee-ingredients');grid.innerHTML='';coffeeIngredients.forEach(([id,label,icon])=>{const button=document.createElement('button');button.className='ingredient-btn';button.dataset.id=id;button.innerHTML=`<span>${icon}</span><strong>${label}</strong>`;button.addEventListener('click',()=>addCoffeeIngredient(id));grid.append(button)});$('#coffee-serve-btn').disabled=false;show('coffee-screen');nextCoffeeOrder();cr.timer=setInterval(()=>{if(!cr)return;cr.time--;$('#coffee-time').textContent=cr.time;if(cr.time<=0)finishCoffeeRush()},1000)}
function nextCoffeeOrder(){if(!cr)return;let next;do{next=coffeeOrders[Math.floor(Math.random()*coffeeOrders.length)]}while(cr.order&&next.name===cr.order.name&&coffeeOrders.length>1);cr.order=next;cr.current=[];$('#coffee-order-name').textContent=next.name;$('#coffee-avatar').textContent=['🙂','😎','🤓','🥳','🧑‍💼'][Math.floor(Math.random()*5)];$('#coffee-recipe').innerHTML=next.recipe.map(id=>`<span>${coffeeIngredients.find(x=>x[0]===id)[2]}</span>`).join('<b>→</b>');renderCoffeeCup();$('#coffee-message').textContent='Build the drink in the correct order, then serve it.'}
function addCoffeeIngredient(id){if(!cr||cr.finished)return;cr.totalActions++;cr.current.push(id);const position=cr.current.length-1;if(cr.order.recipe[position]===id){cr.correctActions++;$('#coffee-message').textContent=cr.current.length===cr.order.recipe.length?'Drink ready — serve it!':'Good. Add the next ingredient.'}else{$('#coffee-message').textContent='Wrong ingredient. Cup reset!';cr.combo=0;cr.current=[]}renderCoffeeCup();updateCoffeeHud()}
function renderCoffeeCup(){if(!cr)return;const host=$('#coffee-cup');host.innerHTML=cr.current.length?cr.current.map(id=>`<span>${coffeeIngredients.find(x=>x[0]===id)[2]}</span>`).join(''):'<span>EMPTY</span>'}
$('#coffee-serve-btn').addEventListener('click',()=>{if(!cr||cr.finished)return;cr.attempts++;const correct=cr.current.length===cr.order.recipe.length&&cr.current.every((id,i)=>id===cr.order.recipe[i]);if(correct){cr.served++;cr.combo++;cr.maxCombo=Math.max(cr.maxCombo,cr.combo);$('#coffee-message').textContent=cr.combo>=5?`Perfect service! ${cr.combo}× combo!`:'Order served!';updateCoffeeHud();setTimeout(nextCoffeeOrder,220)}else{cr.combo=0;cr.current=[];$('#coffee-message').textContent='That order was not ready. Cup reset!';renderCoffeeCup();updateCoffeeHud()}})
function updateCoffeeHud(){if(!cr)return;const accuracy=cr.totalActions?Math.round(cr.correctActions/cr.totalActions*100):100;$('#coffee-served').textContent=cr.served;$('#coffee-combo').textContent=cr.combo;$('#coffee-accuracy').textContent=accuracy+'%'}
function finishCoffeeRush(){if(!cr||cr.finished)return;cr.finished=true;clearInterval(cr.timer);const accuracy=cr.totalActions?Math.round(cr.correctActions/cr.totalActions*100):100,result={served:cr.served,maxCombo:cr.maxCombo,accuracy,actions:cr.totalActions};cr=null;completeGame('coffee',result)}

setupPlayer();if(state.player&&state.briefed){renderHub()}
firebaseReady.then(()=>{setupPlayer();if(state.player&&state.briefed)renderHub()});
