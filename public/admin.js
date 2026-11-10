const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const points = n => new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(n/100);
const date = n => new Date(n).toLocaleString();
let view='users',page=1,search='',rows=[],target,busy=false,reloadRequested=false;
async function api(path,input) {
  const response = await fetch(path,{method:input?'POST':'GET',headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined,signal:AbortSignal.timeout(12000)});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}
function access(error) {
  $('#admin-message').classList.remove('success');
  $('#admin-message').textContent=error.message || 'Connection failed. Retry when the server is available.';
  if([401,403,428].includes(error.status)){
    $('#admin-dashboard').hidden=true;
    $('#admin-access').hidden=error.status===428;
    $('#admin-mfa').hidden=error.status!==428;
  }
}
function table(headings,body){return `<table class="admin-table"><thead><tr>${headings.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;}
async function load() {
  if(busy){reloadRequested=true;return;}
  busy=true;$('#refresh-admin').disabled=true;
  const requested={view,page,search};
  try {
    const overview=await api('/api/admin/overview');
    $('#admin-access').hidden=$('#admin-mfa').hidden=true;$('#admin-dashboard').hidden=false;
    $('#admin-message').textContent=`PostgreSQL connected · Points mode · ${overview.healthy?'Round processor healthy':'Round processor needs attention'}`;
    $('#admin-message').classList.toggle('success',overview.healthy);
    $('#admin-metrics').innerHTML=[['Accounts',overview.users.total],['Blocked',overview.users.blocked],['Points in wallets',points(overview.users.points)],['Predictions',overview.bets.total],['Points staked',points(overview.bets.staked)],['Points returned',points(overview.bets.returned)],['Pending predictions',overview.bets.pending],['Ledger differences',overview.reconciliation.mismatches]].map(([name,value])=>`<div><span>${name}</span><strong>${value}</strong></div>`).join('');
    $('#search-form').hidden=view!=='users';
    $('#admin-table').textContent=`Loading ${view}…`;
    const data=await api(`/api/admin/${requested.view}?page=${requested.page}&q=${encodeURIComponent(requested.search)}`);
    if(view!==requested.view||page!==requested.page||search!==requested.search){reloadRequested=true;return;}
    rows=data.rows;
    let html;
    if(view==='users')html=table(['Account','Balance','Predictions','Access','Actions'],rows.map(u=>`<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.email)} · #${u.id}</small></td><td>${points(u.balance)}</td><td>${u.bet_count}</td><td>${u.blocked?'Blocked':u.role==='admin'?'Administrator':'Active'}<small>${u.verified?'Email verified':'Email unverified'}</small></td><td><button class="text-button" data-user="${u.id}">Details</button>${u.role==='admin'?'':`<button class="text-button ${u.blocked?'positive':'negative'}" data-status="${u.id}">${u.blocked?'Unblock':'Block'}</button>`}</td></tr>`).join(''));
    if(view==='bets')html=table(['Account','Room / round','Selection','Stake','Return'],rows.map(b=>`<tr><td>${esc(b.email)}<small>#${b.id} · ${esc(date(b.created))}</small></td><td>${b.room}s<small>${esc(b.round_id)}</small></td><td>${esc(b.selection)}</td><td>${points(b.stake)}</td><td>${b.payout===null?'Pending':points(b.payout)}</td></tr>`).join(''));
    if(view==='rounds')html=table(['Round','Started','Result','Pool','Surplus'],rows.map(r=>{const a=r.audit?JSON.parse(r.audit):null;return `<tr><td>${esc(r.id)}<small>${r.room}s · ${esc(r.version)}</small></td><td>${esc(date(r.start))}</td><td>${r.result===null?'Open / settling':r.result}</td><td>${a?points(a.total):'Pending'}</td><td>${a?points(a.total-a.returned):'Pending'}</td></tr>`}).join(''));
    if(view==='events')html=table(['Time','Administrator','Account','Action','Reason'],rows.map(e=>`<tr><td>${esc(date(e.created))}</td><td>${esc(e.actor_email)}</td><td>#${e.target}</td><td>${esc(e.action)}</td><td>${esc(e.reason)}</td></tr>`).join(''));
    $('#admin-table').innerHTML=rows.length?html:`<div class="empty"><strong>No ${view} to display.</strong>${view==='users'?'Try a different name or email.':'Records will appear when this activity occurs.'}</div>`;
    $('#page-label').textContent=`Page ${page} · ${data.total} records`;
    $('#previous').disabled=page===1;$('#next').disabled=page*25>=data.total;
  }catch(error){access(error);if(!$('#admin-dashboard').hidden)$('#admin-table').textContent='Could not load records. Use Refresh data to retry.';}
  finally{busy=false;$('#refresh-admin').disabled=false;if(reloadRequested){reloadRequested=false;void load();}}
}
$('#admin-login').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/login',{email:$('#admin-email').value,password:$('#admin-password').value});$('#admin-password').value='';await load();}catch(error){access(error)}finally{button.disabled=false}};
$('#mfa-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('/api/admin/verify',{code:$('#mfa-code').value});$('#mfa-code').value='';await load();}catch(error){access(error)}finally{button.disabled=false}};
$('#search-form').onsubmit=event=>{event.preventDefault();search=$('#user-search').value;page=1;void load()};
$('#refresh-admin').onclick=()=>void load();
$('#previous').onclick=()=>{page--;void load()};$('#next').onclick=()=>{page++;void load()};
$('#logout').onclick=async()=>{try{await api('/api/logout',{});location.assign('/');}catch(error){access(error)}};
$('#close-user').onclick=()=>$('#user-dialog').close();$('#close-status').onclick=()=>$('#status-dialog').close();
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.view){view=button.dataset.view;page=1;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))});await load()}
  if(button.dataset.status){target=rows.find(u=>u.id===Number(button.dataset.status));$('#status-title').textContent=target.blocked?'Unblock account':'Block account';$('#status-description').textContent=`${target.name} (${target.email}). ${target.blocked?'The player will be able to sign in again.':'Active sessions will be revoked. Existing bets still settle.'}`;$('#status-reason').value='';$('#status-message').textContent='';$('#status-dialog').showModal()}
  if(button.dataset.user){try{const data=await api(`/api/admin/users/${button.dataset.user}`);$('#user-title').textContent=data.user.name;$('#user-details').innerHTML=`<p>${esc(data.user.email)} · #${data.user.id}<br>Balance: ${points(data.user.balance)} points<br>Registered: ${esc(date(data.user.created))}<br>Status: ${data.user.blocked?'Blocked':'Active'}${data.user.block_reason?'<br>Reason: '+esc(data.user.block_reason):''}</p><h3>Latest 100 predictions</h3>${table(['Selection','Stake','Return'],data.bets.map(b=>`<tr><td>${esc(b.selection)}</td><td>${points(b.stake)}</td><td>${b.payout===null?'Pending':points(b.payout)}</td></tr>`).join(''))}<h3>Latest 100 point entries</h3>${table(['Time','Entry','Amount'],data.ledger.map(l=>`<tr><td>${esc(date(l.created))}</td><td>${esc(l.kind)}</td><td>${points(l.amount)}</td></tr>`).join(''))}`;$('#user-dialog').showModal()}catch(error){access(error)}}
});
$('#status-form').onsubmit=async event=>{event.preventDefault();$('#status-confirm').disabled=true;try{await api(`/api/admin/users/${target.id}/status`,{blocked:!target.blocked,reason:$('#status-reason').value});$('#status-dialog').close();await load()}catch(error){$('#status-message').textContent=error.message}finally{$('#status-confirm').disabled=false}};
void load();
