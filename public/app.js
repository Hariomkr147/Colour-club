const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = cents => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(cents / 100);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const colour = n => n === 0 || n === 5 ? 'violet' : n % 2 ? 'green' : 'red';
const label = selection => /^\d$/.test(selection) ? `Number ${selection}` : selection.charAt(0) + selection.slice(1).toLowerCase();
const ball = n => `<span class="ball ${colour(n)}" aria-label="${n}, ${colour(n)}">${n}</span>`;
const time = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
let state, room = 30, selection = 'GREEN', multiplier = 1, historyTab = 'results', authMode = 'register';
let syncedAt = 0, fetching = false, sending = false, connected = false, generation = 0, pending = null;
try { pending = JSON.parse(sessionStorage.getItem('pendingPrediction') || 'null'); } catch { pending = null; }

async function api(path, input) {
  let response;
  try {
    response = await fetch(path, { method: input ? 'POST' : 'GET', headers: input ? { 'Content-Type': 'application/json' } : {}, body: input ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(8000) });
  } catch { throw new Error('Connection lost. Reconnect and try again; retrying a prediction will not charge twice.'); }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: response.status });
  return data;
}
function message(selector, text, success = false) {
  $(selector).textContent = text;
  $(selector).classList.toggle('success', success);
}
function savePending(value) {
  pending = value;
  try { if (value) sessionStorage.setItem('pendingPrediction', JSON.stringify(value)); else sessionStorage.removeItem('pendingPrediction'); } catch { /* Retry protection still works within this page when browser storage is unavailable. */ }
}
function odds() { return state?.rules.returns[selection] ?? state?.rules.returns.NUMBER ?? (selection === 'VIOLET' ? 4.5 : /^\d$/.test(selection) ? 9 : ['BIG', 'SMALL'].includes(selection) ? 1.9 : 2); }
function updateSlip() {
  const stake = Number($('#base').value) * multiplier;
  $('#selected-name').textContent = label(selection);
  $('#selected-odds').textContent = `${odds()}× total return`;
  $('.selected-preview').className = `selected-preview ${/^\d$/.test(selection) ? colour(Number(selection)) : selection.toLowerCase()}`;
  $('#total-stake').textContent = `${Number.isFinite(stake) ? money(stake * 100) : '0'} pts`;
  $('#potential-return').textContent = `${Number.isFinite(stake) ? money(Math.floor(stake * 100 * Math.round(odds() * 10) / 10)) : '0'} pts`;
  $$('[data-choice]').forEach(button => {
    const selected = button.dataset.choice === selection;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    const mark = button.querySelector('.choice-mark');
    if (mark) mark.textContent = selected ? '✓' : '+';
  });
  $$('[data-base]').forEach(button => button.classList.toggle('active', Number(button.dataset.base) === Number($('#base').value)));
  $$('[data-multiplier]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.multiplier) === multiplier);
    button.setAttribute('aria-pressed', String(Number(button.dataset.multiplier) === multiplier));
  });
  updateTimer();
}
function updateTimer() {
  const stale = !connected || !state || performance.now() - syncedAt > 6000;
  const now = state ? state.now + performance.now() - syncedAt : 0;
  const remaining = state ? Math.max(0, Math.ceil((state.round.end - now) / 1000)) : 0;
  const locked = !state || now >= state.round.lock;
  $('#timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  $('#round-status').textContent = stale ? 'Reconnecting' : locked ? 'Predictions closed' : 'Open for predictions';
  $('#round-status').classList.toggle('locked', locked);
  $('.timer-box').classList.toggle('locked', locked);
  $('#timer-caption').textContent = locked ? 'NEXT ROUND IN' : 'TIME LEFT';
  const button = $('#place-button');
  const registrationsPaused = !state?.user && state?.registrationEnabled === false;
  button.disabled = sending || stale || registrationsPaused || (locked && !!state?.user && !pending);
  button.textContent = sending ? 'Saving prediction…' : stale ? 'Waiting for connection…' : registrationsPaused ? 'Registrations temporarily paused' : !state?.user ? 'Create account to play' : pending ? 'Retry pending prediction' : locked ? 'Next round opening soon' : 'Place prediction';
  $$('[data-choice], [data-base], [data-multiplier], #base').forEach(control => { control.disabled = sending || !!pending; });
  if (stale && state) { $('#connection').textContent = 'Connection interrupted. Predictions pause until the server reconnects.'; $('#connection').classList.add('error'); }
}
function renderHistory() {
  if (!state) return;
  if (historyTab === 'bets') {
    if (!state.user) {
      const html = '<div class="empty"><strong>Your picks will live here.</strong>Sign in to see your predictions and returns.<button class="text-button" id="history-signin">Sign in</button></div>';
      if ($('#history-content').innerHTML !== html) $('#history-content').innerHTML = html;
      $('#history-signin').onclick = () => openAuth('login'); return;
    }
    const bets = state.bets.filter(bet => bet.room === room);
    const html = bets.length ? `<table><thead><tr><th>Placed</th><th>Pick</th><th>Stake</th><th>Result</th><th>Return</th></tr></thead><tbody>${bets.map(bet => `<tr><td>${esc(time(bet.created))}</td><td>${esc(label(bet.selection))}</td><td>${money(bet.stake)}</td><td>${bet.result === null ? 'Pending' : ball(bet.result)}</td><td>${bet.payout === null ? 'Pending' : money(bet.payout) + ' pts'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><strong>No predictions in this room yet.</strong>Choose a colour, number or size to make your first pick.</div>';
    if ($('#history-content').innerHTML !== html) $('#history-content').innerHTML = html;
    $('.history-note').textContent = 'This room’s predictions from your latest 100 across all rooms. Returns include the original stake.';
  } else {
    const html = state.history.length ? `<table><thead><tr><th>Round opened</th><th>Number</th><th>Colour</th><th>Size</th></tr></thead><tbody>${state.history.map(round => `<tr><td><time title="${esc(new Date(round.start).toLocaleString())}">${esc(time(round.start))}</time></td><td>${ball(round.result)}</td><td>${label(colour(round.result).toUpperCase())}</td><td>${round.result < 5 ? 'Small' : 'Big'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><strong>Waiting for the next result.</strong>Results appear here when this room’s current round ends.</div>';
    if ($('#history-content').innerHTML !== html) $('#history-content').innerHTML = html;
    $('.history-note').textContent = 'Latest 20 results · Previous results do not predict the next result.';
  }
}
function renderWallet() {
  $('#wallet-content').innerHTML = !state?.user ? '<p>Sign in to see your point activity.</p>' : state.ledger.map(entry => `<div class="wallet-row"><div>${({ WELCOME: 'Welcome points', STAKE: 'Prediction placed', RETURN: 'Winning return' })[entry.kind]}<small>${esc(new Date(entry.created).toLocaleString())}</small></div><strong class="${entry.amount >= 0 ? 'positive' : 'negative'}">${entry.amount > 0 ? '+' : ''}${money(entry.amount)} pts</strong></div>`).join('');
}
function render() {
  const user = state.user;
  $('#balance-label').textContent = user ? 'YOUR POINT BALANCE' : 'YOUR STARTING POINTS';
  $('#balance').innerHTML = `${money(user ? user.balance : state.rules.welcomePoints * 100)}<span> pts</span>`;
  $('#balance-note').textContent = user ? `Welcome, ${user.name}. All points are virtual.` : 'Free to play. No deposits. No cash value.';
  $('#join-button').hidden = !!user;
  $('#join-button').disabled = state.registrationEnabled === false;
  $('#join-button').textContent = state.registrationEnabled === false ? 'Registration paused' : 'Create account';
  $('#admin-link').hidden = user?.role !== 'admin';
  $('#verification-notice').hidden = !user || !!user.verified || state.emailAvailable === false || state.verificationRequired === false;
  $('#account-button').textContent = user ? 'Sign out' : 'Sign in';
  $('#round-id').textContent = `Round ${state.round.id}`;
  $('#pool-amount').innerHTML = `${money(state.pool.stake)} <small>pts</small>`;
  $('#pool-count').textContent = `${state.pool.count} prediction${state.pool.count === 1 ? '' : 's'} placed this round`;
  const recent = state.history.length ? state.history.slice(0, 9).map(round => ball(round.result)).join('') : 'The first result will appear after this round.';
  if ($('#recent-balls').innerHTML !== recent) {
    $('#recent-balls').innerHTML = recent;
    $('#recent-balls').classList.remove('result-reveal');
    requestAnimationFrame(() => $('#recent-balls').classList.add('result-reveal'));
  }
  if (pending && user && pending.userId !== user.id) savePending(null);
  if (pending && state.bets.some(bet => bet.request_key === pending.key)) {
    savePending(null);
    message('#bet-message', 'Your prediction is saved. Check My predictions for the result.', true);
  }
  renderHistory(); renderWallet(); updateSlip();
}
async function refresh() {
  if (fetching) return;
  fetching = true;
  const version = generation;
  try {
    const data = await api(`/api/state?room=${room}`);
    if (version !== generation) return;
    state = data; syncedAt = performance.now(); connected = true;
    $('#connection').textContent = 'Connected · Live rounds · All amounts in free points';
    $('#connection').classList.remove('error');
    render();
  } catch (error) {
    if (version !== generation) return;
    connected = false; $('#connection').textContent = error.message; $('#connection').classList.add('error'); updateTimer();
  } finally { fetching = false; if (version !== generation) void refresh(); }
}
function openAuth(mode) {
  authMode = mode;
  const signup = mode === 'register';
  if (signup && state?.registrationEnabled === false) { message('#bet-message','New registrations are temporarily unavailable.'); return; }
  $('#auth-title').textContent = signup ? 'Join Colour Club.' : 'Welcome back.';
  $('#auth-description').textContent = signup ? 'Create your account and receive 10,000 welcome points.' : 'Sign in to access your wallet and predictions.';
  $('#name-field').hidden = !signup; $('#name').required = signup;
  $('#acceptance-field').hidden = !signup; $('#accepted').required = signup;
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('#auth-toggle').textContent = signup ? 'Already registered? Sign in' : 'New here? Create account';
  message('#auth-message', '');
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}

$('#number-choices').innerHTML = Array.from({ length: 10 }, (_, n) => `<button class="number ${colour(n)}" data-choice="${n}" aria-label="Number ${n}, ${colour(n)}, 9 times return" aria-pressed="false">${n}</button>`).join('');
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.dialog) $(`#${button.dataset.dialog}`).showModal();
  if (button.hasAttribute('data-close')) button.closest('dialog').close();
  if (button.dataset.choice) { selection = button.dataset.choice; updateSlip(); }
  if (button.dataset.base) { $('#base').value = button.dataset.base; updateSlip(); }
  if (button.dataset.multiplier) { multiplier = Number(button.dataset.multiplier); updateSlip(); }
  if (button.dataset.room) {
    room = Number(button.dataset.room); generation++; connected = false;
    $$('[data-room]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
    $('#history-content').textContent = 'Loading this room…'; updateTimer(); void refresh();
  }
  if (button.dataset.history) {
    historyTab = button.dataset.history;
    $$('[data-history]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); }); renderHistory();
  }
});
$('#base').addEventListener('input', updateSlip);
$('#join-button').onclick = () => openAuth('register');
$('#auth-toggle').onclick = () => openAuth(authMode === 'register' ? 'login' : 'register');
$('#wallet-button').onclick = () => state?.user ? $('#wallet-dialog').showModal() : openAuth('register');
$('#account-button').onclick = async () => {
  if (!state?.user) return openAuth('login');
  try { await api('/api/logout', {}); savePending(null); generation++; connected = false; await refresh(); }
  catch (error) { $('#connection').textContent = error.message; }
};
$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  $('#auth-submit').disabled = true;
  $('#auth-toggle').disabled = true;
  message('#auth-message', 'Saving your account session…', true);
  try {
    await api(`/api/${authMode}`, { name: $('#name').value, email: $('#email').value, password: $('#password').value, accepted: $('#accepted').checked });
    $('#password').value = ''; $('#auth-dialog').close(); generation++; connected = false; await refresh();
  } catch (error) { message('#auth-message', error.message); }
  finally { $('#auth-submit').disabled = false; $('#auth-toggle').disabled = false; }
};
$('#bet-form').onsubmit = async event => {
  event.preventDefault();
  if (!state?.user) return openAuth('register');
  if (sending) return;
  if (!pending) savePending({ userId: state.user.id, round: state.round.id, selection, base: Number($('#base').value), multiplier, key: crypto.randomUUID() });
  sending = true; updateTimer(); message('#bet-message', 'Saving your prediction…', true);
  try {
    const result = await api('/api/bets', pending);
    savePending(null);
    message('#bet-message', `${label(result.bet.selection)} saved for ${money(result.bet.stake)} points.`, true);
    await refresh();
  } catch (error) {
    if (error.status && error.status < 500) savePending(null);
    message('#bet-message', error.message);
  } finally { sending = false; updateSlip(); }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
window.addEventListener('online', () => void refresh());
// shortcut: full-state polling suits the local demo, split snapshots and add SSE before public-scale traffic.
setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
setInterval(updateTimer, 250);
updateSlip(); void refresh();

let recoveryToken = null;
$('#forgot-password').onclick = () => {
  if (state?.emailAvailable === false) { message('#auth-message','Password recovery is currently unavailable. Keep your password safe.'); return; }
  recoveryToken = null;
  $('#auth-dialog').close();
  $('#recovery-form').hidden=false;
  $('#recovery-email').hidden = $('#recovery-email-label').hidden = false;
  $('#recovery-email').required = true;
  $('#new-password').hidden = $('#new-password-label').hidden = true;
  $('#new-password').required = false;
  $('#recovery-submit').hidden=false;
  $('#recovery-title').textContent='Recover your account';
  $('#recovery-submit').textContent = 'Send recovery link';
  $('#recovery-dialog').showModal();
};
$('#recovery-form').onsubmit = async event => {
  event.preventDefault(); $('#recovery-submit').disabled = true;
  try {
    await api(recoveryToken ? '/api/reset-password' : '/api/forgot-password', recoveryToken ? {token:recoveryToken,password:$('#new-password').value} : {email:$('#recovery-email').value});
    message('#recovery-message',recoveryToken ? 'Password updated. Sign in with your new password.' : 'If the address is registered, a recovery link will be sent.',true);
    $('#new-password').value = '';
  } catch(error) { message('#recovery-message',error.message); }
  finally { $('#recovery-submit').disabled = false; }
};
$('#resend-verification').onclick = async () => {
  $('#resend-verification').disabled = true;
  try { await api('/api/resend-verification',{}); $('#verification-message').textContent='Verification link requested. Check your email.'; }
  catch(error) { $('#verification-message').textContent=error.message; }
  finally { $('#resend-verification').disabled=false; }
};
async function accountLink() {
  const match = /^#(reset|verify)=([a-f0-9]{64})$/.exec(location.hash);
  if (!match) return;
  history.replaceState(null,'',location.pathname);
  if (match[1]==='reset') {
    recoveryToken = match[2];
    $('#recovery-email').hidden = $('#recovery-email-label').hidden = true;
    $('#recovery-email').required = false;
    $('#new-password').hidden = $('#new-password-label').hidden = false;
    $('#new-password').required = true;
    $('#recovery-submit').textContent='Set new password';
    $('#recovery-dialog').showModal();
  } else {
    $('#recovery-email').hidden=$('#recovery-email-label').hidden=true;
    $('#recovery-email').required=false;
    $('#new-password').hidden=$('#new-password-label').hidden=true;
    $('#new-password').required=false;
    $('#recovery-submit').hidden=true;
    $('#recovery-title').textContent='Email verification';
    $('#recovery-dialog').showModal();
    try { await api('/api/verify-email',{token:match[2]}); message('#recovery-message','Email verified. You can continue playing.',true); await refresh(); }
    catch(error) { message('#recovery-message',error.message); }
  }
}
void accountLink();
