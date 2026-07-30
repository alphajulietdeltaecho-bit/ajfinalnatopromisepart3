const firebaseConfig={apiKey:"AIzaSyCC2Jp6uz0tLFpUwRzHABPGcg1JP4H0xkg",authDomain:"james-allen-cup-2026.firebaseapp.com",projectId:"james-allen-cup-2026",storageBucket:"james-allen-cup-2026.firebasestorage.app",messagingSenderId:"131020097886",appId:"1:131020097886:web:fcc0861bc195629780a7cf"};
firebase.initializeApp(firebaseConfig);
const auth=firebase.auth(),db=firebase.firestore();
const $=s=>document.querySelector(s);
let players = [];
let unsubscribe = null;
let settingsUnsubscribe = null;
let tournamentSettings = {
  revealed: false,
  locked: false
};

const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,Number(n)||0));
const dateText=v=>v?.toDate?new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short'}).format(v.toDate()):'—';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function challengeScores(p){const g=p.games||{};const reaction=clamp((600-(g.reaction?.avg||600))/450*100);const typing=clamp(clamp((g.typing?.wpm||0)/100*100)*.7+clamp(g.typing?.accuracy||0)*.3);const memory=clamp((g.memory?.score||0)/45*100);const duration=g.deadeye?.duration||60;const speed=clamp((35-duration)/27*100);const deadeye=clamp(clamp((g.deadeye?.hits||0)/30*100)*.55+clamp((g.deadeye?.maxCombo||0)/30*100)*.25+speed*.20);const sequenceBase=clamp((g.sequence?.score||0)/63*96);const sequence=clamp(sequenceBase+clamp(g.sequence?.speedBonus||0,0,4));return{reaction,typing,memory,deadeye,sequence,overall:(reaction+typing+memory+deadeye+sequence)/5}}
function getRankedPlayers() {
  return players
    .filter(p => (p.completedGames || []).length > 0)
    .map(p => ({
      ...p,
      gamesPlayed: (p.completedGames || []).length,
      scoreSet: challengeScores(p)
    }))
    .sort((a, b) => {
      const scoreDifference =
        b.scoreSet.overall - a.scoreSet.overall;

      if (Math.abs(scoreDifference) > 0.0001) {
        return scoreDifference;
      }

      // Tie-breaker 1: more completed games
      if (b.gamesPlayed !== a.gamesPlayed) {
        return b.gamesPlayed - a.gamesPlayed;
      }

      // Tie-breaker 2: earlier registration
      const aTime = a.registeredAt?.toMillis?.() || 0;
      const bTime = b.registeredAt?.toMillis?.() || 0;

      return aTime - bTime;
    });
}
function statusOf(p){const n=(p.completedGames||[]).length;if(p.completed||n===5)return['COMPLETED','Completed'];if(n>0||p.briefed)return['IN_PROGRESS','In progress'];return['REGISTERED','Registered']}

$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#login-btn'),err=$('#login-error');btn.disabled=true;err.textContent='';try{await auth.signInWithEmailAndPassword($('#admin-email').value.trim(),$('#admin-password').value)}catch(x){console.error(x);err.textContent='Sign-in failed. Check the admin email and password.'}finally{btn.disabled=false}});
$('#logout-btn').addEventListener('click',()=>auth.signOut());
$('#search-input').addEventListener('input',render);
$('#department-filter').addEventListener('change',render);
$('#status-filter').addEventListener('change',render);
$('#export-btn').addEventListener('click',exportCSV);
$('#dialog-close').addEventListener('click',()=>$('#player-dialog').close());

function beginLiveData(){if(unsubscribe)unsubscribe();unsubscribe=db.collection('players').orderBy('registeredAt','asc').onSnapshot(s=>{players=s.docs.map(d=>{const data=d.data();return{docId:d.id,...data,department:data.department==='FNB'?'HQ':data.department}});$('#live-status').textContent='● LIVE';render()},err=>{console.error(err);$('#live-status').textContent='● ACCESS ERROR';$('#players-body').innerHTML='<tr><td colspan="7" class="empty">Firestore access denied. Publish the supplied security rules.</td></tr>'})}

function beginTournamentSettings(){
  if(settingsUnsubscribe) settingsUnsubscribe();

  const tournamentRef=db.collection('settings').doc('tournament');

  settingsUnsubscribe=tournamentRef.onSnapshot(async snapshot=>{
    if(!snapshot.exists){
      await tournamentRef.set({
        revealed:false,
        locked:false,
        championId:null,
        championName:null,
        championScore:null,
        leaderboard:[],
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      return;
    }

    tournamentSettings={
      revealed:false,
      locked:false,
      ...snapshot.data()
    };

    updateRevealButton();
    renderLeaderboard();
  },error=>{
    console.error('Tournament settings error:',error);
  });
}
auth.onAuthStateChanged(user => {
  const admin = Boolean(
    user &&
    !user.isAnonymous &&
    user.email
  );

  $('#login-view').classList.toggle('hidden', admin);
  $('#dashboard-view').classList.toggle('hidden', !admin);

  if (admin) {
    beginLiveData();
    beginTournamentSettings();
  } else {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (settingsUnsubscribe) {
      settingsUnsubscribe();
      settingsUnsubscribe = null;
    }

    players = [];

    tournamentSettings = {
      revealed: false,
      locked: false
    };
  }
});
function filteredPlayers(){const q=$('#search-input').value.trim().toLowerCase(),dept=$('#department-filter').value,status=$('#status-filter').value;return players.filter(p=>{const st=statusOf(p)[0];return(!q||`${p.name||''} ${p.cupID||''}`.toLowerCase().includes(q))&&(dept==='ALL'||p.department===dept)&&(status==='ALL'||st===status)})}
function render(){const completed=players.filter(p=>p.completed||(p.completedGames||[]).length===5).length;const progress=players.filter(p=>{const n=(p.completedGames||[]).length;return !p.completed&&n>0}).length;$('#metric-registered').textContent=players.length;$('#metric-progress').textContent=progress;$('#metric-completed').textContent=completed;$('#metric-rate').textContent=players.length?`${Math.round(completed/players.length*100)}%`:'0%';const list=filteredPlayers();$('#visible-count').textContent=`${list.length} shown`;$('#players-body').innerHTML=list.length?list.map(playerRow).join(''):'<tr><td colspan="7" class="empty">No matching competitors.</td></tr>';document.querySelectorAll('.view-btn').forEach(b=>b.addEventListener('click',()=>openPlayer(b.dataset.id)));renderLeaderboard()}
function playerRow(p){const n=(p.completedGames||[]).length,[key,label]=statusOf(p);return`<tr><td><strong>${esc(p.cupID||'—')}</strong></td><td>${esc(p.name||'Unnamed')}</td><td>${esc(p.department||'—')}</td><td class="progress-cell"><div class="progress-line"><div class="progress-track"><i style="width:${n/5*100}%"></i></div><span>${n}/5</span></div></td><td><span class="status ${key==='COMPLETED'?'completed':key==='IN_PROGRESS'?'progress':'registered'}">${label}</span></td><td>${esc(dateText(p.updatedAt||p.registeredAt))}</td><td><button class="view-btn" data-id="${esc(p.docId)}">VIEW</button></td></tr>`}
function renderLeaderboard() {
  const ranked = getRankedPlayers();

  $('#leaderboard-body').innerHTML = ranked.length
    ? ranked.map((p, i) => `
        <tr class="${i === 0 ? 'current-leader' : ''}">
          <td class="rank">${i === 0 ? '🏆 1' : i + 1}</td>

          <td>
            ${esc(p.name || 'Unnamed')}

            ${i === 0 && !tournamentSettings.revealed
              ? '<span class="leader-label">CURRENT LEADER</span>'
              : ''}

            ${i === 0 && tournamentSettings.revealed
              ? '<span class="leader-label">CHAMPION</span>'
              : ''}
          </td>

          <td>${esc(p.department || '—')}</td>

          <td class="score">
            <strong>${p.scoreSet.overall.toFixed(1)}</strong>
            <small class="games-played">
              ${p.gamesPlayed}/5 played
            </small>
          </td>

          <td class="score">
            ${p.scoreSet.reaction.toFixed(1)}
          </td>

          <td class="score">
            ${p.scoreSet.typing.toFixed(1)}
          </td>

          <td class="score">
            ${p.scoreSet.memory.toFixed(1)}
          </td>

          <td class="score">
            ${p.scoreSet.deadeye.toFixed(1)}
          </td>

          <td class="score">
            ${p.scoreSet.sequence.toFixed(1)}
          </td>
        </tr>
      `).join('')
    : `
      <tr>
        <td colspan="9" class="empty">
          No competitors have completed a challenge yet.
        </td>
      </tr>
    `;

  updateRevealButton();
}
function openPlayer(id){const p=players.find(x=>x.docId===id);if(!p)return;const g=p.games||{},s=challengeScores(p);$('#dialog-name').textContent=p.name||'Player';$('#dialog-content').innerHTML=`<div class="detail-meta"><div class="detail-box"><small>CUP ID</small><strong>${esc(p.cupID||'—')}</strong></div><div class="detail-box"><small>DEPARTMENT</small><strong>${esc(p.department||'—')}</strong></div><div class="detail-box"><small>PROGRESS</small><strong>${(p.completedGames||[]).length} / 5</strong></div><div class="detail-box"><small>OVERALL NORMALIZED</small><strong>${s.overall.toFixed(1)}</strong></div></div><div class="game-grid"><div class="detail-box"><small>REFLEX PROTOCOL</small><strong>${g.reaction?`${esc(g.reaction.avg)} ms`:'Not completed'}</strong></div><div class="detail-box"><small>TYPING RUSH</small><strong>${g.typing?`${esc(g.typing.wpm)} WPM · ${esc(g.typing.accuracy)}%`:'Not completed'}</strong></div><div class="detail-box"><small>MEMORY MATRIX</small><strong>${g.memory?`${esc(g.memory.score)} / 45`:'Not completed'}</strong></div><div class="detail-box"><small>DEADEYE</small><strong>${g.deadeye?`${esc(g.deadeye.hits)} hits · ${esc(g.deadeye.misses)} misses · combo ${esc(g.deadeye.maxCombo)}`:'Not completed'}</strong></div><div class="detail-box"><small>SEQUENCE RECALL</small><strong>${g.sequence?`${esc(g.sequence.score)} / 63 · speed bonus ${Number(g.sequence.speedBonus||0).toFixed(1)}`:'Not completed'}</strong></div><div class="detail-box"><small>LAST UPDATE</small><strong>${esc(dateText(p.updatedAt||p.registeredAt))}</strong></div></div>`;$('#player-dialog').showModal()}
function updateRevealButton() {
  const button = $('#reveal-btn');

  if (!button) {
    return;
  }

  const ranked = getRankedPlayers();

  if (tournamentSettings.revealed) {
    button.disabled = true;
    button.textContent = '🏆 CHAMPION REVEALED';
    return;
  }

  if (!ranked.length) {
    button.disabled = true;
    button.textContent = 'NO SCORES YET';
    return;
  }

  button.disabled = false;
  button.textContent = '🏆 REVEAL CHAMPION';
}

async function revealChampion() {
  const button = $('#reveal-btn');
  const ranked = getRankedPlayers();

  if (tournamentSettings.revealed) {
    alert('The champion has already been revealed.');
    return;
  }

  if (!ranked.length) {
    alert('No competitor has completed a challenge yet.');
    return;
  }

  const champion = ranked[0];

  const confirmed = window.confirm(
    `Reveal ${champion.name} as the James Allen Cup Season 4 Champion?\n\n` +
    `Overall Score: ${champion.scoreSet.overall.toFixed(1)}\n\n` +
    `This will lock the tournament for all players.`
  );

  if (!confirmed) {
    return;
  }

  button.disabled = true;
  button.textContent = 'REVEALING...';

  const leaderboardSnapshot = ranked
    .slice(0, 10)
    .map((player, index) => ({
      rank: index + 1,
      playerId: player.docId,
      cupID: player.cupID || '',
      name: player.name || 'Unnamed',
      department: player.department || '',
      gamesPlayed: player.gamesPlayed,
      overall: Number(player.scoreSet.overall.toFixed(2)),
      reaction: Number(player.scoreSet.reaction.toFixed(2)),
      typing: Number(player.scoreSet.typing.toFixed(2)),
      memory: Number(player.scoreSet.memory.toFixed(2)),
      deadeye: Number(player.scoreSet.deadeye.toFixed(2)),
      sequence: Number(player.scoreSet.sequence.toFixed(2))
    }));

  try {
    await db
      .collection('settings')
      .doc('tournament')
      .set({
        revealed: true,
        locked: true,

        championId: champion.docId,
        championCupID: champion.cupID || '',
        championName: champion.name || 'Unnamed',
        championDepartment: champion.department || '',
        championScore: Number(
          champion.scoreSet.overall.toFixed(2)
        ),

        leaderboard: leaderboardSnapshot,

        revealedBy: auth.currentUser?.email || 'Admin',
        revealedAt:
          firebase.firestore.FieldValue.serverTimestamp()
      }, {
        merge: true
      });

    alert(
      `${champion.name} is now the James Allen Cup Season 4 Champion!`
    );
  } catch (error) {
    console.error('Champion reveal failed:', error);

    button.disabled = false;
    button.textContent = '🏆 REVEAL CHAMPION';

    alert(
      'Champion reveal failed. Check the console and Firestore rules.'
    );
  }
}

$('#reveal-btn').addEventListener(
  'click',
  revealChampion
);
function exportCSV(){const headers=['Cup ID','Name','Department','Completed Games','Status','Reaction Avg ms','Typing WPM','Typing Accuracy','Memory Score','Deadeye Hits','Deadeye Misses','Deadeye Max Combo','Deadeye Duration','Sequence Score','Normalized Overall','Registered At','Updated At'];const rows=players.map(p=>{const g=p.games||{},s=challengeScores(p);return[p.cupID,p.name,p.department,(p.completedGames||[]).length,statusOf(p)[1],g.reaction?.avg,g.typing?.wpm,g.typing?.accuracy,g.memory?.score,g.deadeye?.hits,g.deadeye?.misses,g.deadeye?.maxCombo,g.deadeye?.duration,g.sequence?.score,s.overall.toFixed(1),dateText(p.registeredAt),dateText(p.updatedAt)]});const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`James-Allen-Cup-Season-4-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url)}
