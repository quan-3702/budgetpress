// BudgetPress – envelope budgeting. Offline: every budget stays in this browser profile (IndexedDB).
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const INT = Math.floor;

// ---------- Pro (Microsoft Store add-on via Digital Goods API) ----------
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'budgetpress_pro';
const PRO_IDS = [PRO_SKU];
let STORE_URL = 'https://apps.microsoft.com/search/publisher?name=NTQ37';
let proAvailable = false;
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('budgetpress-pro') === '1'; } catch (_) {}
// one-time free trial of every Pro feature
const TRIAL_DAYS = 7, DAY = 86400000;
let trialStart = 0;
try { trialStart = Number(localStorage.getItem('budgetpress-trial')) || 0; } catch (_) {}
const trialLeft = () => (trialStart ? Math.max(0, Math.ceil((trialStart + TRIAL_DAYS * DAY - Date.now()) / DAY)) : 0);
const trialActive = () => trialLeft() > 0;
const unlocked = () => isPro || !proAvailable || trialActive();
async function loadTrial() { // kept in two places so clearing one does not restart the trial
  const t = await dbGet('trial').catch(() => 0);
  trialStart = Math.max(trialStart, Number(t) || 0);
  if (trialStart) { try { localStorage.setItem('budgetpress-trial', String(trialStart)); } catch (_) {} dbSet('trial', trialStart).catch(() => {}); }
}
async function startTrial() {
  if (trialStart) return;
  trialStart = Date.now();
  try { localStorage.setItem('budgetpress-trial', String(trialStart)); } catch (_) {}
  await dbSet('trial', trialStart).catch(() => {});
  setPro(isPro); $('proDialog').close(); toast(`★ Every Pro feature is unlocked for ${TRIAL_DAYS} days. Enjoy!`);
}
function proLabel() { return isPro ? '★ Pro' : trialActive() ? `★ Pro trial · ${trialLeft()} day${trialLeft() === 1 ? '' : 's'} left` : '★ Get Pro'; }
const FREE_ACCOUNTS = 3;
async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}
function setPro(v) {
  isPro = v;
  try { localStorage.setItem('budgetpress-pro', v ? '1' : '0'); } catch (_) {}
  const b = $('proBtn');
  b.textContent = proLabel();
  b.classList.toggle('is-pro', v || trialActive());
  b.hidden = !proAvailable && !v;
  renderAll();
}
async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}
function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }
async function openPro(reason) {
  if (!reason && !isPro && trialStart && !trialActive()) reason = 'Your free Pro trial has ended. Your budget and everything you made stay here – unlock Pro to keep using the Pro tools.';
  proMessage(reason || '');
  const t = $('trialBtn'); t.hidden = isPro || !!trialStart;
  $('trialInfo').hidden = !trialActive() || isPro; $('trialInfo').textContent = trialActive() ? `You are trying Pro: ${trialLeft()} day${trialLeft() === 1 ? '' : 's'} left.` : '';
  const svc = await billing();
  if (!svc) { $('buyBtn').textContent = 'Get BudgetPress on Microsoft Store'; $('restoreBtn').hidden = true; }
  else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}
async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) { proMessage('Thank you! Pro is unlocked. ★'); setTimeout(() => $('proDialog').close(), 1500); }
}
const needsPro = (why) => { if (unlocked()) return false; openPro(why); return true; };

// ---------- money and dates ----------
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'INR', 'JPY', 'SGD', 'HKD', 'ZAR', 'MXN', 'BRL', 'PHP', 'VND'];
let fmtCache = null;
function fmt(c) {
  if (!fmtCache || fmtCache.cur !== D.currency) { const nf = new Intl.NumberFormat(undefined, { style: 'currency', currency: D.currency || 'USD' }); fmtCache = { cur: D.currency, nf, dec: nf.resolvedOptions().maximumFractionDigits }; }
  return fmtCache.nf.format((c || 0) / 100);
}
function parseMoney(s) { // "1,234.56", "1.234,56", "-5", "12" → cents
  let t = String(s == null ? '' : s).trim().replace(/[^\d,.\-()]/g, '');
  if (!t) return NaN;
  let neg = /^\(.*\)$/.test(t) || t.startsWith('-'); t = t.replace(/[()\-]/g, '');
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > ld && t.length - lc - 1 <= 2) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const v = Math.round(parseFloat(t) * 100);
  return isNaN(v) ? NaN : neg ? -v : v;
}
const money2 = (c) => (c / 100).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const thisMonth = () => todayStr().slice(0, 7);
const mAdd = (m, k) => { let [y, mo] = m.split('-').map(Number); mo += k; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${pad(mo)}`; };
const mLabel = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const mShort = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
const dLabel = (d) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.slice(0, 4) === todayStr().slice(0, 4) ? undefined : 'numeric' });
const toDate = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const dStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const daysInMonth = (m) => new Date(+m.slice(0, 4), +m.slice(5), 0).getDate();

// ---------- data ----------
const ACCOUNT_TYPES = { checking: ['Checking', true], savings: ['Savings', true], cash: ['Cash', true], credit: ['Credit card', true], asset: ['Asset (tracking)', false], invest: ['Investment (tracking)', false], loan: ['Loan / mortgage (tracking)', false] };
const isBudgetAcct = (a) => a && ACCOUNT_TYPES[a.type] && ACCOUNT_TYPES[a.type][1];
const isDebtAcct = (a) => a && (a.type === 'credit' || a.type === 'loan');
const FLAGS = { red: '#e5484d', orange: '#f76b15', yellow: '#f5c400', green: '#30a46c', blue: '#0090ff', purple: '#8e4ec6' };
function defaultGroups() {
  const g = (name, cats) => ({ id: uid('g'), name, hidden: false, cats: cats.map((n) => ({ id: uid('c'), name: n, hidden: false, note: '', goal: null })) });
  return [
    g('Bills', ['Rent / Mortgage', 'Electricity', 'Water', 'Internet & Phone', 'Insurance']),
    g('Everyday', ['Groceries', 'Eating Out', 'Transportation', 'Household', 'Personal Care']),
    g('Savings Goals', ['Emergency Fund', 'Vacation', 'Car Repairs', 'Gifts & Holidays']),
    g('Fun', ['Entertainment', 'Subscriptions', 'Hobbies']),
  ];
}
const blankBudget = (name) => ({ v: 1, name: name || 'My Budget', currency: guessCurrency(), accounts: [], groups: defaultGroups(), assigned: {}, tx: [], sched: [], extraDebt: 0, strategy: 'avalanche' });
function guessCurrency() { try { const r = new Intl.NumberFormat().resolvedOptions().locale || ''; const reg = (r.split('-')[1] || '').toUpperCase(); return { US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR', JP: 'JPY', VN: 'VND', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', SE: 'SEK', CH: 'CHF', PL: 'PLN', ZA: 'ZAR', MX: 'MXN', BR: 'BRL', SG: 'SGD', PH: 'PHP' }[reg] || 'USD'; } catch (_) { return 'USD'; } }
let D = blankBudget();
let budgets = [], curBudget = null;

// IndexedDB key/value
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('budgetpress', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbGet(k) { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbSet(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function dbDel(k) { const d = await idb(); return new Promise((res) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); }
let saveTimer = 0;
function save() { scheduleSync(); const be = budgets.find((b) => b.id === curBudget); if (be && be.name !== D.name) { be.name = D.name; dbSet('budgets', budgets).catch(() => {}); } clearTimeout(saveTimer); saveTimer = setTimeout(() => dbSet('b:' + curBudget, D).catch(() => toast('Could not save – your disk may be full')), 250); }

// undo / redo: whole-budget snapshots
const undoStack = [], redoStack = [];
function allIds() { return [...D.tx.map((t) => t.id), ...D.accounts.map((a) => a.id), ...(D.sched || []).map((x) => x.id), ...D.groups.flatMap((g) => g.cats.map((c) => c.id))]; }
function change(fn) {
  undoStack.push(JSON.stringify(D)); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0;
  const before = new Set(allIds());
  fn(); ccSync();
  // remember deleted items so another PC does not bring them back when syncing
  const now = Date.now(), after = new Set(allIds()); D.deleted = D.deleted || {};
  before.forEach((id) => { if (!after.has(id)) D.deleted[id] = now; });
  D.updated = now; save(); renderAll();
}
function undo() { if (!undoStack.length) { toast('Nothing to undo'); return; } redoStack.push(JSON.stringify(D)); const del = D.deleted; D = JSON.parse(undoStack.pop()); D.deleted = Object.assign({}, del); allIds().forEach((id) => delete D.deleted[id]); D.updated = Date.now(); save(); renderAll(); toast('Undone'); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(D)); D = JSON.parse(redoStack.pop()); D.updated = Date.now(); save(); renderAll(); toast('Redone'); }

// credit card payment categories live in their own group, one per card
const CC_GROUP = 'ccg';
function ccSync() {
  let g = D.groups.find((x) => x.id === CC_GROUP);
  const cards = D.accounts.filter((a) => a.type === 'credit');
  if (!cards.length) { if (g && !g.cats.some((c) => catUsed(c.id))) D.groups = D.groups.filter((x) => x !== g); return; }
  if (!g) { g = { id: CC_GROUP, name: 'Credit Card Payments', hidden: false, cats: [] }; D.groups.unshift(g); }
  cards.forEach((a) => { const id = 'cc_' + a.id; let c = g.cats.find((x) => x.id === id); if (!c) g.cats.push({ id, name: a.name, cc: a.id, hidden: !!a.closed, note: '', goal: null }); else { c.name = a.name; c.hidden = !!a.closed; } });
}
const catUsed = (id) => Object.values(D.assigned).some((m) => m[id]);
const allCats = () => D.groups.flatMap((g) => g.cats.map((c) => Object.assign({ group: g }, c)));
const catById = (id) => { for (const g of D.groups) { const c = g.cats.find((x) => x.id === id); if (c) return c; } return null; };
const catName = (id) => (id === 'rta' ? 'Ready to Assign' : id === '__start' ? 'Starting balance (debt)' : id === '__split' ? 'Split' : !id ? 'Uncategorized' : (catById(id) || { name: '(deleted)' }).name);
const acctById = (id) => D.accounts.find((a) => a.id === id);

// ---------- calculations ----------
// every budget-affecting line (splits expanded)
function lines() {
  const out = [];
  for (const t of D.tx) {
    const a = acctById(t.acct); if (!a) continue;
    if (t.splits && t.splits.length) t.splits.forEach((s) => out.push({ t, a, cat: s.cat, amount: s.amount, date: t.date }));
    else out.push({ t, a, cat: t.cat, amount: t.amount, date: t.date });
  }
  return out;
}
let C = null; // cache of computed numbers; rebuilt after every change
function compute() {
  const act = {}, income = {}, assignedTot = {}, months = new Set([thisMonth()]);
  const add = (m, k, v) => { (act[m] = act[m] || {})[k] = ((act[m] || {})[k] || 0) + v; };
  for (const l of lines()) {
    const m = l.date.slice(0, 7); months.add(m);
    if (!isBudgetAcct(l.a)) continue;
    const t = l.t;
    if (t.xfer) {
      const other = acctById(t.xfer.acct);
      if (l.a.type === 'credit' && other && isBudgetAcct(other) && other.type !== 'credit') add(m, 'cc_' + l.a.id, -l.amount); // card payment / cash advance
      if (other && isBudgetAcct(other)) continue; // money stays inside the budget
      // transfer to a tracking account needs a category: fall through
    }
    if (l.cat === 'rta') { income[m] = (income[m] || 0) + l.amount; continue; }
    if (l.cat === '__start') continue;
    const k = l.cat || '__unc';
    add(m, k, l.amount);
    if (l.a.type === 'credit' && l.cat) add(m, 'cc_' + l.a.id, -l.amount);
  }
  Object.keys(D.assigned).forEach((m) => { months.add(m); assignedTot[m] = Object.values(D.assigned[m]).reduce((s, v) => s + v, 0); });
  const sorted = [...months].sort();
  C = { act, income, assignedTot, first: sorted[0], last: sorted[sorted.length - 1], availCache: {} };
}
function availableMap(M) { // available per category at the end of month M (rolls over, overspending carries)
  if (C.availCache[M]) return C.availCache[M];
  const out = {};
  for (let m = C.first; m <= M; m = mAdd(m, 1)) {
    const as = D.assigned[m] || {}, ac = C.act[m] || {};
    for (const k in as) out[k] = (out[k] || 0) + as[k];
    for (const k in ac) out[k] = (out[k] || 0) + ac[k];
    if (m === M) break;
  }
  C.availCache[M] = out;
  return out;
}
function readyToAssign(M) {
  let inc = 0, asg = 0;
  for (const m in C.income) if (m <= M) inc += C.income[m];
  for (const m in C.assignedTot) if (m <= M) asg += C.assignedTot[m];
  // money assigned in future months is also taken from today's pot
  for (const m in C.assignedTot) if (m > M) asg += C.assignedTot[m];
  return inc - asg;
}
const assignedIn = (M, cat) => (D.assigned[M] || {})[cat] || 0;
const activityIn = (M, cat) => ((C.act[M] || {})[cat]) || 0;
function balances() { // per account: working, cleared
  const b = {};
  D.accounts.forEach((a) => { b[a.id] = { bal: 0, cleared: 0, uncleared: 0 }; });
  D.tx.forEach((t) => { const x = b[t.acct]; if (!x) return; x.bal += t.amount; if (t.cleared !== 'u') x.cleared += t.amount; else x.uncleared += t.amount; });
  return b;
}
// how much a goal still needs this month
function goalNeed(cat, M) {
  const g = cat.goal; if (!g || !g.amount) return null;
  const asg = assignedIn(M, cat.id), availBefore = (availableMap(mAdd(M, -1))[cat.id] || 0), availNow = availableMap(M)[cat.id] || 0;
  let target = 0, note = '';
  if (g.type === 'monthly') { target = g.amount; note = `${fmt(g.amount)} every month`; return { need: Math.max(0, target - asg), have: asg, target, note }; }
  if (g.type === 'weekly') { const [y, m] = M.split('-').map(Number); let n = 0; for (let d = 1; d <= daysInMonth(M); d++) if (new Date(y, m - 1, d).getDay() === (g.weekday == null ? 5 : g.weekday)) n++; target = g.amount * n; note = `${fmt(g.amount)} every week`; return { need: Math.max(0, target - asg), have: asg, target, note }; }
  if (g.type === 'refill') { target = g.amount; note = `Refill up to ${fmt(g.amount)} each month`; return { need: Math.max(0, target - (availBefore + asg) ), have: Math.min(target, Math.max(0, availBefore + asg)), target, note }; }
  if (g.type === 'by' || g.type === 'yearly') {
    let due = g.date || M;
    if (g.type === 'yearly') { const mo = (g.date || '12').slice(-2); due = `${M.slice(0, 4)}-${mo}`; if (due < M) due = `${+M.slice(0, 4) + 1}-${mo}`; }
    const left = Math.max(1, (+due.slice(0, 4) - +M.slice(0, 4)) * 12 + (+due.slice(5) - +M.slice(5)) + 1);
    const stillNeeded = Math.max(0, g.amount - availBefore);
    const perMonth = due < M ? 0 : Math.ceil(stillNeeded / left);
    note = `${fmt(g.amount)} by ${mLabel(due)}${g.type === 'yearly' ? ' every year' : ''}`;
    return { need: Math.max(0, perMonth - asg), have: Math.max(0, availNow), target: g.amount, note, perMonth };
  }
  return null;
}

// Age of Money: average age of the last 10 spending transactions, matching spending to the oldest income first
function ageOfMoney(upTo) {
  const ins = [], outs = [];
  lines().forEach((l) => {
    if (!isBudgetAcct(l.a) || (upTo && l.date > upTo)) return;
    if (l.t.xfer) { const o = acctById(l.t.xfer.acct); if (o && isBudgetAcct(o)) return; }
    if (l.amount > 0) ins.push({ date: l.date, left: l.amount }); else if (l.amount < 0 && l.cat !== '__start') outs.push({ date: l.date, amt: -l.amount });
  });
  ins.sort((a, b) => (a.date < b.date ? -1 : 1)); outs.sort((a, b) => (a.date < b.date ? -1 : 1));
  let i = 0; const ages = [];
  for (const o of outs) {
    let need = o.amt, w = 0, sum = 0;
    while (need > 0 && i < ins.length) { if (ins[i].date > o.date) break; const take = Math.min(need, ins[i].left); sum += take * daysBetween(ins[i].date, o.date); w += take; need -= take; ins[i].left -= take; if (!ins[i].left) i++; }
    if (w) ages.push(sum / w);
  }
  if (ages.length < 3) return null;
  const last = ages.slice(-10);
  return Math.round(last.reduce((s, v) => s + v, 0) / last.length);
}

// ---------- UI basics ----------
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000); }
let tab = 'budget', month = thisMonth(), repMonth = thisMonth(), calMonth = thisMonth();
function showTab(t) { tab = t; $('tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); ['budget', 'tx', 'accounts', 'reports', 'plan'].forEach((k) => { $('pane-' + k).hidden = k !== t; }); renderAll(); }
function renderAll() {
  compute();
  if (document.activeElement !== $('currency')) $('currency').value = D.currency;
  document.querySelectorAll('.pro-only').forEach((b) => { b.hidden = unlocked(); });
  if (tab === 'budget') renderBudget(); else if (tab === 'tx') renderTx(); else if (tab === 'accounts') renderAccounts(); else if (tab === 'reports') renderReports(); else renderPlan();
}
const pillCls = (v, warn) => (v < 0 ? 'neg' : warn ? 'warn' : v > 0 ? 'pos' : 'zero');
function catOptions(sel, opts) {
  opts = opts || {};
  let h = opts.none ? `<option value="">${esc(opts.none)}</option>` : '';
  if (opts.rta !== false) h += `<option value="rta"${sel === 'rta' ? ' selected' : ''}>💵 Ready to Assign (income)</option>`;
  D.groups.forEach((g) => { if (opts.noCC && g.id === CC_GROUP) return; const cats = g.cats.filter((c) => !c.hidden || c.id === sel); if (!cats.length) return; h += `<optgroup label="${esc(g.name)}">` + cats.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + '</optgroup>'; });
  return h;
}
const acctOptions = (sel, filter) => D.accounts.filter((a) => (!a.closed || a.id === sel) && (!filter || filter(a))).map((a) => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');

// ---------- budget ----------
function renderBudget() {
  $('mTitle').textContent = mLabel(month);
  const rta = readyToAssign(month), r = $('rta');
  r.className = 'rta ' + (rta > 0 ? 'pos' : rta < 0 ? 'neg' : 'zero');
  r.innerHTML = `<b>${fmt(rta)}</b><small>${rta > 0 ? 'Ready to Assign – give it a job' : rta < 0 ? 'You assigned more than you have' : 'All money assigned 🎉'}</small>`;
  const aom = ageOfMoney(); $('aom').textContent = aom == null ? '' : `Age of Money: ${aom} day${aom === 1 ? '' : 's'}`;
  const avail = availableMap(month), showHidden = $('showHidden').checked;
  let h = '';
  const unc = avail.__unc || 0, uncAct = activityIn(month, '__unc');
  if (unc || uncAct) h += `<tr class="cat"><td class="name" data-unc="1">⚠ Uncategorized<small>Click to see these transactions and give them a category</small></td><td></td><td class="hide-sm">${fmt(uncAct)}</td><td><span class="pill neg">${fmt(unc)}</span></td></tr>`;
  D.groups.forEach((g) => {
    const cats = g.cats.filter((c) => showHidden || !c.hidden);
    if (!cats.length && g.id === CC_GROUP) return;
    const tA = cats.reduce((s, c) => s + assignedIn(month, c.id), 0), tAct = cats.reduce((s, c) => s + activityIn(month, c.id), 0), tAv = cats.reduce((s, c) => s + (avail[c.id] || 0), 0);
    h += `<tr class="grp"><td data-g="${g.id}" title="${g.id === CC_GROUP ? '' : 'Click to rename, add a category or delete the group'}">${esc(g.name)}${g.id === CC_GROUP ? '' : ' <small style="font-weight:400;color:var(--muted)">＋</small>'}</td><td>${fmt(tA)}</td><td class="hide-sm">${fmt(tAct)}</td><td>${fmt(tAv)}</td></tr>`;
    cats.forEach((c) => {
      const a = avail[c.id] || 0, gn = unlocked() ? goalNeed(c, month) : null, warn = gn && gn.need > 0;
      let sub = '';
      if (c.cc) { const bal = -(balances()[c.cc] || { bal: 0 }).bal; sub = `<small>Card balance ${fmt(bal)}${bal > a ? ` · ${fmt(bal - a)} not covered yet` : ''}</small>`; }
      else if (gn) { const pct = gn.target ? Math.min(100, Math.round((gn.have / gn.target) * 100)) : 0; sub = `<small>${esc(gn.note)}${gn.need > 0 ? ` · ${fmt(gn.need)} more needed this month` : ' · ✓ on track'}</small><div class="bar"><i style="width:${pct}%"></i></div>`; }
      else if (c.note) sub = `<small>${esc(c.note.slice(0, 80))}</small>`;
      h += `<tr class="cat"${c.hidden ? ' style="opacity:.55"' : ''}><td class="name" data-c="${c.id}">${esc(c.name)}${c.hidden ? ' (hidden)' : ''}${sub}</td><td><input class="asg" data-c="${c.id}" value="${assignedIn(month, c.id) ? money2(assignedIn(month, c.id)) : ''}" placeholder="0.00" inputmode="decimal"></td><td class="hide-sm"><a href="#" data-act="${c.id}" style="color:inherit">${fmt(activityIn(month, c.id))}</a></td><td><span class="pill ${pillCls(a, warn)}" data-av="${c.id}" style="cursor:pointer" title="Click to move money">${fmt(a)}</span></td></tr>`;
    });
  });
  $('budgetBody').innerHTML = h || '<tr><td colspan="4" class="empty">Add a group to start.</td></tr>';
  if (!D.accounts.length) $('budgetBody').insertAdjacentHTML('afterbegin', `<tr><td colspan="4"><div class="lockbox">👋 Welcome! Start by adding your bank accounts in <b>🏦 Accounts</b> – their money becomes <b>Ready to Assign</b>. Or click <b>☰ More → Load a sample budget</b> to look around.</div></td></tr>`);
}
function setAssigned(cat, cents) { change(() => { const m = (D.assigned[month] = D.assigned[month] || {}); if (cents) m[cat] = cents; else delete m[cat]; }); }
function autoAssign(kind) {
  const prev = mAdd(month, -1), cats = allCats().filter((c) => !c.hidden);
  if (kind === 'goals' && needsPro('Goals are part of BudgetPress Pro.')) return;
  change(() => {
    const m = (D.assigned[month] = D.assigned[month] || {});
    cats.forEach((c) => {
      let v = null;
      if (kind === 'goals') { compute(); const g = goalNeed(c, month); if (g && g.need > 0) v = assignedIn(month, c.id) + g.need; }
      else if (kind === 'lastAssigned') v = assignedIn(prev, c.id);
      else if (kind === 'lastSpent') v = Math.max(0, -activityIn(prev, c.id));
      else if (kind === 'avgAssigned') v = Math.round([1, 2, 3].reduce((s, k) => s + assignedIn(mAdd(month, -k), c.id), 0) / 3);
      else if (kind === 'avgSpent') v = Math.max(0, Math.round(-[1, 2, 3].reduce((s, k) => s + activityIn(mAdd(month, -k), c.id), 0) / 3));
      else if (kind === 'resetAssigned') v = 0;
      if (v != null) { if (v) m[c.id] = v; else delete m[c.id]; }
    });
  });
  toast('Done – you can undo with Ctrl+Z');
}
// move money between categories (or to/from Ready to Assign)
function openMove(from, to, amt) {
  const opts = (sel) => `<option value="rta"${sel === 'rta' ? ' selected' : ''}>💵 Ready to Assign</option>` + catOptions(sel, { rta: false });
  $('mvFrom').innerHTML = opts(from || 'rta'); $('mvTo').innerHTML = opts(to || 'rta');
  $('mvAmt').value = amt ? money2(Math.abs(amt)) : '';
  if (!to) { const first = allCats().find((c) => !c.hidden && !c.cc && c.id !== from); if (first) $('mvTo').value = first.id; }
  const av = availableMap(month);
  $('mvHint').textContent = from && from !== 'rta' ? `${catName(from)} has ${fmt(av[from] || 0)} available.` : `Ready to Assign: ${fmt(readyToAssign(month))}`;
  $('moveDlg').showModal(); $('mvAmt').focus();
}
function doMove() {
  const amt = parseMoney($('mvAmt').value), from = $('mvFrom').value, to = $('mvTo').value;
  if (!(amt > 0) || from === to) { toast('Type an amount and pick two different places'); return; }
  change(() => { const m = (D.assigned[month] = D.assigned[month] || {}); if (from !== 'rta') m[from] = (m[from] || 0) - amt; if (to !== 'rta') m[to] = (m[to] || 0) + amt; Object.keys(m).forEach((k) => { if (!m[k]) delete m[k]; }); });
  $('moveDlg').close(); toast(`Moved ${fmt(amt)} from ${catName(from)} to ${catName(to)}`);
}
// category dialog
let editCat = null;
function openCat(id) {
  const c = catById(id); if (!c) return; editCat = c;
  const g = D.groups.find((x) => x.cats.includes(c));
  $('cName').value = c.name; $('cName').disabled = !!c.cc;
  $('cGroup').innerHTML = D.groups.filter((x) => x.id !== CC_GROUP).map((x) => `<option value="${x.id}"${x === g ? ' selected' : ''}>${esc(x.name)}</option>`).join(''); $('cGroup').parentElement.hidden = !!c.cc; $('cName').parentElement.hidden = false;
  const gl = c.goal || { type: 'none' };
  $('cGoalType').value = gl.type; $('cGoalAmt').value = gl.amount ? money2(gl.amount) : ''; $('cGoalDate').value = gl.date && gl.date.length === 7 ? gl.date : mAdd(month, 6);
  $('goalBadge').hidden = unlocked(); $('cNote').value = c.note || ''; $('cHidden').checked = !!c.hidden; $('cDel').hidden = !!c.cc;
  goalRows(); $('catDlg').showModal();
}
function goalRows() { const t = $('cGoalType').value; $('cGoalRow').hidden = t === 'none'; $('cGoalDateRow').hidden = !(t === 'by' || t === 'yearly'); $('cGoalDateRow').firstChild.textContent = t === 'yearly' ? 'Due each year in' : 'By'; }
function saveCat() {
  const c = editCat; if (!c) return;
  const type = $('cGoalType').value, amt = parseMoney($('cGoalAmt').value);
  if (type !== 'none' && (!c.goal || c.goal.type !== type || c.goal.amount !== amt) && needsPro('Goals are part of BudgetPress Pro.')) return;
  change(() => {
    if (!c.cc) c.name = $('cName').value.trim() || c.name;
    c.note = $('cNote').value.trim(); c.hidden = $('cHidden').checked;
    c.goal = type === 'none' || !(amt > 0) ? null : { type, amount: amt, date: (type === 'by' || type === 'yearly') ? $('cGoalDate').value : null };
    if (!c.cc) { const from = D.groups.find((x) => x.cats.includes(c)), to = D.groups.find((x) => x.id === $('cGroup').value); if (to && from !== to) { from.cats = from.cats.filter((x) => x !== c); to.cats.push(c); } }
  });
  $('catDlg').close();
}
function moveCat(dir) { const c = editCat, g = D.groups.find((x) => x.cats.includes(c)), i = g.cats.indexOf(c), j = i + dir; if (j < 0 || j >= g.cats.length) return; change(() => { g.cats.splice(i, 1); g.cats.splice(j, 0, c); }); }
function deleteCat() {
  const c = editCat; if (!c) return;
  const used = D.tx.some((t) => t.cat === c.id || (t.splits || []).some((s) => s.cat === c.id));
  if (!confirm(used ? `Delete "${c.name}"? Its transactions will become Uncategorized and its money goes back to Ready to Assign.` : `Delete "${c.name}"?`)) return;
  change(() => { D.groups.forEach((g) => { g.cats = g.cats.filter((x) => x !== c); }); D.tx.forEach((t) => { if (t.cat === c.id) t.cat = null; (t.splits || []).forEach((s) => { if (s.cat === c.id) s.cat = null; }); }); Object.values(D.assigned).forEach((m) => delete m[c.id]); D.sched.forEach((s) => { if (s.cat === c.id) s.cat = null; }); });
  $('catDlg').close();
}
function groupMenu(gid) {
  const g = D.groups.find((x) => x.id === gid); if (!g || g.id === CC_GROUP) return;
  const a = prompt(`Group "${g.name}"\n\nType a name for a NEW CATEGORY to add it to this group.\nType "rename: New name" to rename the group, or "delete" to delete the group.`, '');
  if (a == null || !a.trim()) return;
  const t = a.trim();
  if (/^delete$/i.test(t)) { if (g.cats.length && !confirm(`Delete the group "${g.name}" and its ${g.cats.length} categories?`)) return; change(() => { g.cats.forEach((c) => { D.tx.forEach((x) => { if (x.cat === c.id) x.cat = null; }); Object.values(D.assigned).forEach((m) => delete m[c.id]); }); D.groups = D.groups.filter((x) => x !== g); }); return; }
  if (/^rename:/i.test(t)) { const n = t.slice(7).trim(); if (n) change(() => { g.name = n; }); return; }
  change(() => { g.cats.push({ id: uid('c'), name: t, hidden: false, note: '', goal: null }); });
}

// ---------- transactions ----------
let txFilter = { acct: '', cat: '', month: '', flag: '', q: '' };
function renderTx() {
  const accts = D.accounts.filter((a) => !a.closed);
  $('fAcct').innerHTML = `<option value="">All accounts</option>` + D.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}${a.closed ? ' (closed)' : ''}</option>`).join('');
  $('fAcct').value = txFilter.acct;
  $('fCat').innerHTML = catOptions(txFilter.cat, { none: 'All categories' }) + `<option value="__unc">Uncategorized</option>`; $('fCat').value = txFilter.cat;
  const months = [...new Set(D.tx.map((t) => t.date.slice(0, 7)))].sort().reverse();
  $('fMonth').innerHTML = `<option value="">All dates</option>` + months.map((m) => `<option value="${m}">${mLabel(m)}</option>`).join(''); $('fMonth').value = txFilter.month;
  $('fFlag').value = txFilter.flag; $('fSearch').value = txFilter.q;
  const q = txFilter.q.toLowerCase();
  let list = D.tx.filter((t) => (!txFilter.acct || t.acct === txFilter.acct) && (!txFilter.month || t.date.startsWith(txFilter.month))
    && (!txFilter.cat || (txFilter.cat === '__unc' ? (!t.cat && !t.xfer && !(t.splits || []).length) : t.cat === txFilter.cat || (t.splits || []).some((s) => s.cat === txFilter.cat)))
    && (!txFilter.flag || (txFilter.flag === 'uncat' ? (!t.cat && !t.xfer && !(t.splits || []).length && isBudgetAcct(acctById(t.acct))) : txFilter.flag === 'unclr' ? t.cleared === 'u' : t.flag === txFilter.flag))
    && (!q || (t.payee + ' ' + (t.memo || '')).toLowerCase().includes(q)));
  list.sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  const one = txFilter.acct && !txFilter.cat && !txFilter.month && !txFilter.flag && !q;
  $('balHead').hidden = !one; $('reconBtn').hidden = !txFilter.acct;
  let run = one ? (balances()[txFilter.acct] || { bal: 0 }).bal : 0;
  const shown = list.slice(0, 600);
  $('txBody').innerHTML = shown.map((t) => {
    const a = acctById(t.acct), other = t.xfer ? acctById(t.xfer.acct) : null;
    const cat = t.xfer && other && isBudgetAcct(other) && isBudgetAcct(a) ? `<span class="muted">Transfer</span>` : (t.splits && t.splits.length) ? `<span class="muted">✂ Split (${t.splits.length})</span>` : isBudgetAcct(a) ? (t.cat ? esc(catName(t.cat)) : '<b class="neg-t">Needs a category</b>') : '<span class="muted">Tracking</span>';
    const payee = t.xfer ? `⇄ ${esc(other ? other.name : 'Transfer')}` : esc(t.payee);
    const row = `<tr data-id="${t.id}"><td>${t.flag ? `<i class="flag" style="background:${FLAGS[t.flag]}"></i>` : ''}</td><td>${dLabel(t.date)}</td><td>${esc(a ? a.name : '?')}</td><td>${payee}</td><td>${cat}</td><td class="hide-sm muted">${esc(t.memo || '')}</td><td class="num">${t.amount < 0 ? fmt(-t.amount) : ''}</td><td class="num pos-t">${t.amount > 0 ? fmt(t.amount) : ''}</td><td class="num"${one ? '' : ' hidden'}>${one ? fmt(run) : ''}</td><td data-clr="${t.id}" title="Click to mark cleared" style="cursor:pointer;color:${t.cleared === 'r' ? 'var(--accent)' : t.cleared === 'c' ? 'var(--accent)' : 'var(--line)'}">${t.cleared === 'r' ? '🔒' : '✓'}</td></tr>`;
    if (one) run -= t.amount;
    return row;
  }).join('');
  $('txEmpty').hidden = D.tx.length > 0;
  const tin = list.reduce((s, t) => s + Math.max(0, t.amount), 0), tout = list.reduce((s, t) => s + Math.min(0, t.amount), 0);
  $('txSum').textContent = list.length ? `${list.length} transaction${list.length === 1 ? '' : 's'} · in ${fmt(tin)} · out ${fmt(-tout)}${list.length > shown.length ? ` · showing the newest ${shown.length}` : ''}` : '';
  renderSched();
}
// transaction dialog
let editTx = null, txKind = 'out', splits = null;
function payeeCategory(p) { const t = D.tx.slice().reverse().find((x) => x.payee && x.payee.toLowerCase() === p.toLowerCase() && x.cat); return t ? t.cat : null; }
function openTx(id, preset) {
  editTx = id ? D.tx.find((t) => t.id === id) : null;
  if (!D.accounts.length) { toast('Add an account first'); showTab('accounts'); return; }
  const t = editTx || Object.assign({ date: todayStr(), acct: txFilter.acct || (D.accounts.find((a) => !a.closed && isBudgetAcct(a)) || D.accounts[0]).id, payee: '', cat: null, amount: 0, memo: '', cleared: 'u', flag: '' }, preset || {});
  txKind = t.xfer ? 'xfer' : t.amount > 0 ? 'in' : 'out';
  setKind(txKind);
  $('txTitle').textContent = editTx ? 'Edit transaction' : 'New transaction';
  $('tAmt').value = t.amount ? money2(Math.abs(t.amount)) : '';
  $('tDate').value = t.date; $('tPayee').value = t.payee || ''; $('tMemo').value = t.memo || ''; $('tCleared').checked = t.cleared !== 'u'; $('tFlag').value = t.flag || '';
  $('tAcct').innerHTML = acctOptions(t.acct); $('tAcct').value = t.acct;
  $('tTo').innerHTML = acctOptions(t.xfer ? t.xfer.acct : '', (a) => a.id !== t.acct);
  $('tCat').innerHTML = catOptions(t.cat === 'rta' && txKind === 'out' ? null : t.cat, { none: '— choose a category —' });
  if (txKind === 'in' && !editTx) $('tCat').value = 'rta';
  splits = t.splits && t.splits.length ? t.splits.map((s) => Object.assign({}, s)) : null;
  renderSplits();
  $('payees').innerHTML = [...new Set(D.tx.map((x) => x.payee).filter(Boolean))].slice(-400).map((p) => `<option value="${esc(p)}">`).join('');
  $('tDel').hidden = !editTx; $('tSaveNew').hidden = !!editTx;
  $('txDlg').showModal(); $('tAmt').focus();
}
function setKind(k) {
  txKind = k; $('txKind').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  const x = k === 'xfer';
  $('tToRow').hidden = !x; $('tPayeeRow').hidden = x; $('tAcctLbl').textContent = x ? 'From account' : 'Account';
  const needCat = !x || xferNeedsCat();
  $('tCatRow').hidden = !needCat || !!splits; $('tSplitBtn').hidden = x || !!splits; $('tSplitBox').hidden = !splits || x;
}
function xferNeedsCat() { const a = acctById($('tAcct').value), b = acctById($('tTo').value); return a && b && isBudgetAcct(a) !== isBudgetAcct(b); }
function renderSplits() {
  if (!splits) { $('tSplitBox').hidden = true; setKind(txKind); return; }
  $('tSplits').innerHTML = splits.map((s, i) => `<div class="split-line"><select data-si="${i}" data-k="cat">${catOptions(s.cat, { none: '— category —' })}</select><input data-si="${i}" data-k="amount" value="${s.amount ? money2(Math.abs(s.amount)) : ''}" placeholder="0.00" inputmode="decimal"><button data-del="${i}" class="ghost" style="padding:4px">✕</button></div>`).join('');
  splitLeft(); setKind(txKind);
}
function splitLeft() { const total = parseMoney($('tAmt').value) || 0, used = splits.reduce((s, x) => s + Math.abs(x.amount || 0), 0); $('tSplitLeft').textContent = total - used ? `${fmt(total - used)} left to split` : '✓ fully split'; }
function saveTx(again) {
  const amt = parseMoney($('tAmt').value);
  if (!(amt > 0)) { toast('Type the amount'); $('tAmt').focus(); return; }
  const acct = $('tAcct').value, sign = txKind === 'in' ? 1 : -1, date = $('tDate').value || todayStr();
  if (!editTx && !acctById(acct)) return;
  if (txKind === 'xfer') {
    const to = $('tTo').value; if (!to || to === acct) { toast('Pick the account the money goes to'); return; }
    const cat = xferNeedsCat() ? ($('tCat').value || null) : null;
    change(() => {
      if (editTx) removeTx(editTx);
      const id1 = uid('t'), id2 = uid('t'), base = { date, memo: $('tMemo').value.trim(), cleared: $('tCleared').checked ? 'c' : 'u', flag: $('tFlag').value, payee: '' };
      D.tx.push(Object.assign({ id: id1, acct, amount: -amt, cat: isBudgetAcct(acctById(acct)) ? cat : null, xfer: { acct: to, pair: id2 } }, base));
      D.tx.push(Object.assign({ id: id2, acct: to, amount: amt, cat: isBudgetAcct(acctById(to)) ? (cat ? cat : null) : null, xfer: { acct, pair: id1 } }, base));
      // only the budget side of a budget↔tracking transfer carries the category
      if (cat) { const a = D.tx.find((t) => t.id === id1), b = D.tx.find((t) => t.id === id2); if (isBudgetAcct(acctById(acct))) b.cat = null; else a.cat = null; }
    });
  } else {
    let sp = null, cat = $('tCat').value || null;
    if (splits) {
      sp = splits.filter((s) => s.amount).map((s) => ({ cat: s.cat || null, amount: sign * Math.abs(s.amount), memo: '' }));
      const used = sp.reduce((s, x) => s + Math.abs(x.amount), 0);
      if (used !== amt) { toast(`The split lines add up to ${fmt(used)}, not ${fmt(amt)}`); return; }
      cat = null;
    }
    const payee = $('tPayee').value.trim();
    change(() => {
      const t = editTx && !editTx.xfer ? editTx : { id: uid('t') };
      if (editTx && editTx.xfer) removeTx(editTx);
      Object.assign(t, { date, acct, payee, amount: sign * amt, cat: sp ? null : cat, splits: sp, memo: $('tMemo').value.trim(), cleared: $('tCleared').checked ? (t.cleared === 'r' ? 'r' : 'c') : 'u', flag: $('tFlag').value, xfer: null });
      if (!D.tx.includes(t)) D.tx.push(t);
    });
  }
  if (again) { const keep = { acct, date }; $('txDlg').close(); openTx(null, keep); } else $('txDlg').close();
}
function removeTx(t) { D.tx = D.tx.filter((x) => x !== t && !(t.xfer && x.id === t.xfer.pair)); }
function deleteTx() { if (!editTx) return; change(() => removeTx(editTx)); $('txDlg').close(); }
function toggleCleared(id) { const t = D.tx.find((x) => x.id === id); if (!t || t.cleared === 'r') return; change(() => { t.cleared = t.cleared === 'u' ? 'c' : 'u'; }); }

// ---------- accounts ----------
function renderAccounts() {
  const b = balances(); let assets = 0, debts = 0;
  D.accounts.forEach((a) => { const v = b[a.id].bal; if (v >= 0) assets += v; else debts += v; });
  $('netWorth').className = 'rta ' + (assets + debts >= 0 ? 'pos' : 'neg');
  $('netWorth').innerHTML = `<b>${fmt(assets + debts)}</b><small>Net worth · assets ${fmt(assets)} · debts ${fmt(-debts)}</small>`;
  const card = (a) => { const x = b[a.id]; return `<div class="card" data-a="${a.id}"${a.closed ? ' style="opacity:.55"' : ''}><h3>${esc(a.name)}</h3><small>${ACCOUNT_TYPES[a.type][0]}${a.closed ? ' · closed' : ''}</small><div class="big ${x.bal < 0 ? 'neg-t' : ''}">${fmt(x.bal)}</div><small>Cleared ${fmt(x.cleared)}${x.uncleared ? ` · uncleared ${fmt(x.uncleared)}` : ''}${isDebtAcct(a) && a.apr ? ` · ${a.apr}% APR` : ''}</small><div class="row-btns" style="margin-top:8px"><button class="ghost" data-view="${a.id}" style="padding:4px 10px">Transactions</button></div></div>`; };
  const onB = D.accounts.filter(isBudgetAcct), off = D.accounts.filter((a) => !isBudgetAcct(a));
  $('acctCards').innerHTML = `<h3 style="grid-column:1/-1;margin:4px 0 0">Budget accounts</h3>` + onB.map(card).join('') + `<div class="card add" data-new="1">＋ Add account</div>` + (off.length ? `<h3 style="grid-column:1/-1;margin:10px 0 0">Tracking accounts</h3>` + off.map(card).join('') : '');
}
let editAcct = null;
function openAcct(id) {
  editAcct = id ? acctById(id) : null;
  if (!editAcct && D.accounts.length >= FREE_ACCOUNTS && needsPro(`The free version holds ${FREE_ACCOUNTS} accounts. Unlock Pro for unlimited accounts.`)) return;
  const a = editAcct || { name: '', type: 'checking', apr: '', minPay: 0 };
  $('aName').value = a.name; $('aType').value = a.type; $('aType').disabled = !!editAcct;
  $('aStartRow').hidden = !!editAcct; $('aBal').value = ''; $('aDate').value = todayStr();
  $('aApr').value = a.apr || ''; $('aMin').value = a.minPay ? money2(a.minPay) : '';
  $('aClosed').checked = !!a.closed; $('aClosedRow').hidden = !editAcct; $('aDel').hidden = !editAcct;
  acctRows(); $('acctDlg').showModal(); $('aName').focus();
}
function acctRows() { $('aDebtRow').hidden = !['credit', 'loan'].includes($('aType').value); }
function saveAcct() {
  const name = $('aName').value.trim(); if (!name) { toast('Give the account a name'); return; }
  const apr = parseFloat(String($('aApr').value).replace(',', '.')) || 0, minPay = parseMoney($('aMin').value) || 0;
  if (editAcct) { change(() => { editAcct.name = name; editAcct.apr = apr; editAcct.minPay = minPay; editAcct.closed = $('aClosed').checked; }); $('acctDlg').close(); return; }
  const type = $('aType').value, a = { id: uid('a'), name, type, apr, minPay, closed: false };
  let bal = parseMoney($('aBal').value); if (isNaN(bal)) bal = 0;
  if (isDebtAcct(a)) bal = -Math.abs(bal);
  change(() => {
    D.accounts.push(a);
    if (bal) D.tx.push({ id: uid('t'), date: $('aDate').value || todayStr(), acct: a.id, payee: 'Starting balance', cat: isBudgetAcct(a) ? (a.type === 'credit' ? '__start' : 'rta') : null, amount: bal, memo: '', cleared: 'c', flag: '', xfer: null });
  });
  $('acctDlg').close(); toast(isBudgetAcct(a) && bal > 0 ? `${fmt(bal)} is now Ready to Assign` : 'Account added');
}
function deleteAcct() {
  const a = editAcct; if (!a) return;
  const n = D.tx.filter((t) => t.acct === a.id).length;
  if (!confirm(n ? `Delete "${a.name}" and its ${n} transactions? (Tip: you can close it instead to keep the history.)` : `Delete "${a.name}"?`)) return;
  change(() => { const ids = new Set(D.tx.filter((t) => t.acct === a.id).map((t) => t.xfer && t.xfer.pair).filter(Boolean)); D.tx = D.tx.filter((t) => t.acct !== a.id && !ids.has(t.id)); D.accounts = D.accounts.filter((x) => x !== a); D.sched = D.sched.filter((s) => s.acct !== a.id && s.to !== a.id); });
  $('acctDlg').close();
}
// reconcile: compare with the bank, lock cleared transactions, add an adjustment if needed
function openRecon() { const a = acctById(txFilter.acct); if (!a) return; $('rcName').textContent = a.name; $('rcBal').value = ''; $('rcMsg').textContent = `BudgetPress cleared balance: ${fmt(balances()[a.id].cleared)}`; $('reconDlg').showModal(); $('rcBal').focus(); }
function doRecon() {
  const a = acctById(txFilter.acct); let bank = parseMoney($('rcBal').value); if (isNaN(bank)) { toast('Type the balance from your bank'); return; }
  if (isDebtAcct(a) && bank > 0) bank = -bank;
  const cleared = balances()[a.id].cleared, diff = bank - cleared;
  if (diff && !confirm(`Your bank says ${fmt(bank)} but your cleared transactions add up to ${fmt(cleared)}.\n\nAdd a ${fmt(diff)} adjustment so they match? (Cancel to look for the missing transaction first.)`)) return;
  change(() => {
    if (diff) D.tx.push({ id: uid('t'), date: todayStr(), acct: a.id, payee: 'Reconciliation adjustment', cat: isBudgetAcct(a) ? (a.type === 'credit' ? '__start' : 'rta') : null, amount: diff, memo: '', cleared: 'c', flag: '', xfer: null });
    D.tx.forEach((t) => { if (t.acct === a.id && t.cleared === 'c') t.cleared = 'r'; });
  });
  $('reconDlg').close(); toast(`✔ ${a.name} is reconciled`);
}

// ---------- scheduled ----------
function renderSched() {
  $('schedBadge').hidden = unlocked();
  const list = D.sched.slice().sort((a, b) => (a.next < b.next ? -1 : 1));
  $('schedList').innerHTML = list.map((s) => `<div class="sched" data-s="${s.id}"><span><b>${esc(s.kind === 'xfer' ? `Transfer to ${(acctById(s.to) || {}).name || '?'}` : s.payee || '(no payee)')}</b><br><small>${{ month: 'Every month', week: 'Every week', '2week': 'Every 2 weeks', year: 'Every year' }[s.every]} · next ${dLabel(s.next)} · ${esc((acctById(s.acct) || {}).name || '')}${s.kind !== 'xfer' ? ' · ' + esc(catName(s.cat)) : ''}</small></span><b class="${s.kind === 'in' ? 'pos-t' : ''}">${s.kind === 'in' ? '+' : '−'}${fmt(s.amount)}</b></div>`).join('') || '<p class="hint">Nothing scheduled yet.</p>';
}
let editSched = null, sKind = 'out';
function openSched(id) {
  if (!id && needsPro('Scheduled bills and income are part of BudgetPress Pro.')) return;
  if (!D.accounts.length) { toast('Add an account first'); return; }
  editSched = id ? D.sched.find((s) => s.id === id) : null;
  const s = editSched || { kind: 'out', amount: 0, payee: '', cat: null, acct: (D.accounts.find((a) => isBudgetAcct(a) && !a.closed) || D.accounts[0]).id, every: 'month', next: todayStr() };
  setSKind(s.kind);
  $('sAmt').value = s.amount ? money2(s.amount) : ''; $('sDate').value = s.next; $('sPayee').value = s.payee; $('sEvery').value = s.every;
  $('sCat').innerHTML = catOptions(s.cat, { none: '— category —' }); $('sAcct').innerHTML = acctOptions(s.acct); $('sTo').innerHTML = acctOptions(s.to || '');
  $('sDel').hidden = !editSched; $('schedDlg').showModal();
}
function setSKind(k) { sKind = k; $('sKind').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); $('sToRow').hidden = k !== 'xfer'; $('sPayeeRow').hidden = k === 'xfer'; $('sCatRow').hidden = k === 'xfer'; }
function saveSched() {
  const amt = parseMoney($('sAmt').value); if (!(amt > 0)) { toast('Type the amount'); return; }
  const s = { id: editSched ? editSched.id : uid('s'), kind: sKind, amount: amt, payee: $('sPayee').value.trim(), cat: sKind === 'in' && !$('sCat').value ? 'rta' : ($('sCat').value || null), acct: $('sAcct').value, to: sKind === 'xfer' ? $('sTo').value : null, every: $('sEvery').value, next: $('sDate').value || todayStr() };
  if (s.kind === 'xfer' && (!s.to || s.to === s.acct)) { toast('Pick the account the money goes to'); return; }
  change(() => { if (editSched) Object.assign(editSched, s); else D.sched.push(s); });
  $('schedDlg').close(); runScheduled();
}
function nextDate(d, every) { const x = toDate(d); if (every === 'week') x.setDate(x.getDate() + 7); else if (every === '2week') x.setDate(x.getDate() + 14); else if (every === 'year') x.setFullYear(x.getFullYear() + 1); else { const day = toDate(d).getDate(); x.setDate(1); x.setMonth(x.getMonth() + 1); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); } return dStr(x); }
function runScheduled() {
  if (!unlocked()) return;
  const today = todayStr(); let n = 0;
  const due = D.sched.some((s) => s.next <= today); if (!due) return;
  change(() => {
    D.sched.forEach((s) => {
      let guard = 0;
      while (s.next <= today && guard++ < 60) {
        if (s.kind === 'xfer') { const id1 = `s_${s.id}_${s.next}_a`, id2 = `s_${s.id}_${s.next}_b`; if (D.tx.some((t) => t.id === id1)) { s.next = nextDate(s.next, s.every); continue; } D.tx.push({ id: id1, date: s.next, acct: s.acct, payee: '', cat: null, amount: -s.amount, memo: 'Scheduled', cleared: 'u', flag: '', xfer: { acct: s.to, pair: id2 } }, { id: id2, date: s.next, acct: s.to, payee: '', cat: null, amount: s.amount, memo: 'Scheduled', cleared: 'u', flag: '', xfer: { acct: s.acct, pair: id1 } }); }
        else if (!D.tx.some((t) => t.id === `s_${s.id}_${s.next}`)) D.tx.push({ id: `s_${s.id}_${s.next}`, date: s.next, acct: s.acct, payee: s.payee, cat: s.cat, amount: (s.kind === 'in' ? 1 : -1) * s.amount, memo: 'Scheduled', cleared: 'u', flag: '', xfer: null });
        s.next = nextDate(s.next, s.every); n++;
      }
    });
  });
  if (n) toast(`Added ${n} scheduled transaction${n === 1 ? '' : 's'}`);
}

// ---------- charts ----------
const PALETTE = ['#1f7a5c', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#06b6d4', '#a16207'];
function barsH(items, total) { // horizontal bars: [{label, value, color}]
  if (!items.length) return '<p class="empty">No spending this month yet.</p>';
  const max = Math.max(...items.map((i) => i.value)), W = 760, rh = 30, H = items.length * rh + 10;
  return `<svg viewBox="0 0 ${W} ${H}" role="img">` + items.map((it, k) => { const y = k * rh + 5, w = Math.max(2, (it.value / max) * 420); return `<text x="0" y="${y + 19}" font-size="13" fill="currentColor">${esc(it.label.slice(0, 26))}</text><rect x="200" y="${y + 6}" width="${w}" height="18" rx="4" fill="${it.color}"/><text x="${210 + w}" y="${y + 19}" font-size="13" fill="currentColor">${esc(fmt(it.value))}${total ? ` · ${Math.round((it.value / total) * 100)}%` : ''}</text>`; }).join('') + '</svg>';
}
function barsV(months, series) { // grouped vertical bars per month
  const W = 760, H = 240, pad = 40, max = Math.max(1, ...series.flatMap((s) => s.values)), bw = (W - pad) / months.length;
  let s = `<svg viewBox="0 0 ${W} ${H + 30}" role="img"><line x1="${pad}" y1="${H}" x2="${W}" y2="${H}" stroke="currentColor" opacity=".25"/>`;
  [0.5, 1].forEach((f) => { s += `<text x="0" y="${H - f * (H - 20) + 4}" font-size="11" fill="currentColor" opacity=".6">${esc(fmt(max * f).replace(/\.\d+$/, ''))}</text>`; });
  months.forEach((m, i) => {
    series.forEach((se, k) => { const v = se.values[i], h = (v / max) * (H - 20), w = (bw * 0.7) / series.length, x = pad + i * bw + bw * 0.15 + k * w; s += `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${se.color}"><title>${se.name} ${mLabel(m)}: ${fmt(v)}</title></rect>`; });
    s += `<text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H + 18}" font-size="11" text-anchor="middle" fill="currentColor">${mShort(m)}</text>`;
  });
  return s + `</svg><p class="hint">${series.map((x) => `<span style="color:${x.color}">■</span> ${x.name}`).join(' &nbsp; ')}</p>`;
}
function lineChart(points, opts) { // [{x:label, y:cents}]
  if (points.length < 2) return '<p class="empty">Not enough data yet.</p>';
  const W = 760, H = 220, pad = 50, ys = points.map((p) => p.y), min = Math.min(0, ...ys), max = Math.max(1, ...ys), sx = (i) => pad + (i / (points.length - 1)) * (W - pad - 10), sy = (v) => 10 + (1 - (v - min) / (max - min || 1)) * (H - 30);
  let s = `<svg viewBox="0 0 ${W} ${H + 20}" role="img">`;
  if (min < 0) s += `<line x1="${pad}" y1="${sy(0)}" x2="${W}" y2="${sy(0)}" stroke="#ef4444" stroke-dasharray="4 4" opacity=".7"/>`;
  s += `<text x="0" y="${sy(max) + 4}" font-size="11" fill="currentColor" opacity=".6">${esc(fmt(max))}</text><text x="0" y="${sy(min) + 4}" font-size="11" fill="currentColor" opacity=".6">${esc(fmt(min))}</text>`;
  s += `<polyline fill="none" stroke="${(opts && opts.color) || '#1f7a5c'}" stroke-width="2.5" points="${points.map((p, i) => `${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}"/>`;
  const step = Math.ceil(points.length / 8);
  points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) s += `<text x="${sx(i).toFixed(1)}" y="${H + 14}" font-size="11" text-anchor="middle" fill="currentColor">${esc(p.x)}</text>`; });
  return s + '</svg>';
}
const lockbox = (what) => `<div class="lockbox">${what} is part of <b>BudgetPress Pro</b>.<br><button class="primary" data-pro="1" style="margin-top:10px">See Pro</button></div>`;

// ---------- reports ----------
function renderReports() {
  $('rTitle').textContent = mLabel(repMonth);
  $('repBadge').hidden = $('repBadge2').hidden = unlocked();
  const act = C.act[repMonth] || {}, items = [];
  let total = 0;
  D.groups.forEach((g, gi) => { if (g.id === CC_GROUP) return; g.cats.forEach((c) => { const v = -(act[c.id] || 0); if (v > 0) { items.push({ label: c.name, value: v, color: PALETTE[gi % PALETTE.length], group: g.name }); total += v; } }); });
  if ((act.__unc || 0) < 0) { items.push({ label: 'Uncategorized', value: -act.__unc, color: '#9ca3af' }); total += -act.__unc; }
  items.sort((a, b) => b.value - a.value);
  const aom = ageOfMoney(repMonth + '-31');
  $('repSpend').innerHTML = `<p><b>${fmt(total)}</b> spent in ${mLabel(repMonth)} · income ${fmt(C.income[repMonth] || 0)}${aom != null ? ` · Age of Money ${aom} days` : ''}</p>` + barsH(items, total);
  if (!unlocked()) { $('repTrend').innerHTML = lockbox('The 12-month report'); $('repNet').innerHTML = lockbox('Net worth over time'); return; }
  const ms = Array.from({ length: 12 }, (_, i) => mAdd(repMonth, i - 11));
  const spend = ms.map((m) => -Object.entries(C.act[m] || {}).filter(([k]) => !k.startsWith('cc_')).reduce((s, [, v]) => s + v, 0));
  const startInc = {}; D.tx.forEach((t) => { if (t.payee === 'Starting balance' && t.cat === 'rta') { const m = t.date.slice(0, 7); startInc[m] = (startInc[m] || 0) + t.amount; } });
  const inc = ms.map((m) => (C.income[m] || 0) - (startInc[m] || 0));
  const net = inc.reduce((s, v) => s + v, 0) - spend.reduce((s, v) => s + v, 0);
  $('repTrend').innerHTML = barsV(ms, [{ name: 'Income', values: inc.map((v) => Math.max(0, v)), color: '#1f7a5c' }, { name: 'Spending', values: spend.map((v) => Math.max(0, v)), color: '#ef4444' }]) + `<p class="hint">12 months: income ${fmt(inc.reduce((s, v) => s + v, 0))}, spending ${fmt(spend.reduce((s, v) => s + v, 0))}, ${net >= 0 ? 'saved' : 'overspent'} <b>${fmt(Math.abs(net))}</b> · average spending ${fmt(Math.round(spend.reduce((s, v) => s + v, 0) / 12))}/month</p>`;
  const pts = ms.map((m) => ({ x: mShort(m), y: D.tx.filter((t) => t.date.slice(0, 7) <= m).reduce((s, t) => s + t.amount, 0) }));
  $('repNet').innerHTML = lineChart(pts);
}

// ---------- plan: forecast, calendar, debt payoff ----------
function occurrences(from, to) { // scheduled items between two dates
  const out = [];
  D.sched.forEach((s) => { let d = s.next, g = 0; while (d <= to && g++ < 400) { if (d >= from) out.push({ date: d, s }); d = nextDate(d, s.every); } });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
function renderPlan() {
  if (!unlocked()) { $('forecast').innerHTML = lockbox('The balance forecast'); $('calendar').innerHTML = lockbox('The bill calendar'); $('debtPlan').innerHTML = lockbox('The debt payoff plan'); $('calTitle').textContent = ''; return; }
  // forecast
  const cashIds = new Set(D.accounts.filter((a) => ['checking', 'savings', 'cash'].includes(a.type) && !a.closed).map((a) => a.id));
  const b = balances(); let bal = [...cashIds].reduce((s, id) => s + b[id].bal, 0);
  const start = todayStr(), end = dStr(new Date(toDate(start).getTime() + 60 * 864e5)), occ = occurrences(start, end);
  const pts = []; let low = { v: bal, d: start };
  for (let i = 0; i <= 60; i++) {
    const d = dStr(new Date(toDate(start).getTime() + i * 864e5));
    occ.filter((o) => o.date === d).forEach(({ s }) => { if (s.kind === 'in' && cashIds.has(s.acct)) bal += s.amount; else if (s.kind === 'out' && cashIds.has(s.acct)) bal -= s.amount; else if (s.kind === 'xfer') { if (cashIds.has(s.acct)) bal -= s.amount; if (cashIds.has(s.to)) bal += s.amount; } });
    pts.push({ x: dLabel(d), y: bal }); if (bal < low.v) low = { v: bal, d };
  }
  $('forecast').innerHTML = (D.sched.length ? '' : '<p class="hint">Add your paychecks and bills under 🧾 Transactions → Scheduled to see the forecast.</p>') + lineChart(pts) + `<p class="${low.v < 0 ? 'neg-t' : 'hint'}"><b>${low.v < 0 ? '⚠ ' : ''}Lowest point: ${fmt(low.v)} on ${dLabel(low.d)}</b>${low.v < 0 ? ' – move money or delay a bill before then.' : ''}</p>`;
  // calendar
  $('calTitle').textContent = mLabel(calMonth);
  const first = new Date(+calMonth.slice(0, 4), +calMonth.slice(5) - 1, 1), off = first.getDay(), n = daysInMonth(calMonth);
  const cOcc = occurrences(calMonth + '-01', calMonth + '-' + pad(n));
  const txIn = D.tx.filter((t) => t.date.startsWith(calMonth) && t.memo === 'Scheduled');
  let cal = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="h">${d}</div>`).join('') + '<div style="background:none"></div>'.repeat(off);
  for (let d = 1; d <= n; d++) {
    const ds = `${calMonth}-${pad(d)}`, items = cOcc.filter((o) => o.date === ds).map(({ s }) => `<span class="${s.kind === 'in' ? 'pos-t' : ''}">${s.kind === 'in' ? '+' : '−'}${esc(fmt(s.amount))} ${esc(s.kind === 'xfer' ? '⇄' : s.payee)}</span>`).concat(txIn.filter((t) => t.date === ds).map((t) => `<span class="muted">✓ ${esc(t.payee || 'Transfer')}</span>`));
    cal += `<div class="${ds === todayStr() ? 'today' : ''}"><b>${d}</b>${items.join('')}</div>`;
  }
  $('calendar').innerHTML = `<div class="cal">${cal}</div>`;
  // debt payoff
  if (document.activeElement !== $('extraDebt')) $('extraDebt').value = D.extraDebt ? money2(D.extraDebt) : '';
  $('strategy').value = D.strategy || 'avalanche';
  const debts = D.accounts.filter((a) => isDebtAcct(a) && !a.closed && b[a.id].bal < 0).map((a) => ({ a, bal: -b[a.id].bal, apr: a.apr || 0, min: a.minPay || Math.max(2500, Math.round(-b[a.id].bal * 0.02)) }));
  if (!debts.length) { $('debtPlan').innerHTML = '<p class="hint">No debts – add a credit card or loan in 🏦 Accounts. 🎉</p>'; return; }
  const sim = (extra, strat) => {
    const ds = debts.map((d) => ({ ...d })), res = {}; let month = 0, interest = 0;
    while (ds.some((d) => d.bal > 0) && month < 600) {
      month++; let pool = extra;
      ds.forEach((d) => { if (d.bal <= 0) return; const i = Math.round((d.bal * d.apr) / 1200); d.bal += i; interest += i; });
      ds.forEach((d) => { if (d.bal <= 0) { pool += d.min; return; } const p = Math.min(d.min, d.bal); d.bal -= p; if (d.bal <= 0) { res[d.a.id] = month; pool += d.min - p; } });
      const order = ds.filter((d) => d.bal > 0).sort((x, y) => (strat === 'snowball' ? x.bal - y.bal : y.apr - x.apr || x.bal - y.bal));
      for (const d of order) { if (pool <= 0) break; const p = Math.min(pool, d.bal); d.bal -= p; pool -= p; if (d.bal <= 0) res[d.a.id] = month; }
    }
    return { months: month, interest, res, stuck: month >= 600 };
  };
  const plan = sim(D.extraDebt || 0, D.strategy), base = sim(0, D.strategy);
  const when = (k) => { const d = new Date(); d.setMonth(d.getMonth() + k); return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
  $('debtPlan').innerHTML = (plan.stuck ? '<p class="neg-t"><b>⚠ With these payments the debt never gets paid off – the interest is bigger than the payments. Raise the minimum payments or the extra amount.</b></p>' : `<p><b>Debt-free in ${when(plan.months)}</b> (${plan.months} months) · total interest ${fmt(plan.interest)}${base.stuck ? '' : plan.months < base.months ? ` · <span class="pos-t">${base.months - plan.months} months sooner and ${fmt(base.interest - plan.interest)} less interest than minimum payments only</span>` : ''}</p>`) +
    `<table class="grid dp"><thead><tr><th>Debt</th><th>Balance</th><th>APR</th><th>Minimum</th><th>Paid off</th></tr></thead><tbody>${debts.sort((x, y) => (plan.res[x.a.id] || 999) - (plan.res[y.a.id] || 999)).map((d) => `<tr><td>${esc(d.a.name)}</td><td>${fmt(d.bal)}</td><td>${d.apr ? d.apr + '%' : '<span class="muted">set it</span>'}</td><td>${fmt(d.min)}${d.a.minPay ? '' : ' <span class="muted">(est.)</span>'}</td><td>${plan.res[d.a.id] ? when(plan.res[d.a.id]) : '—'}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- printing ----------
function printHtml(html, landscape) {
  $('pageRule').textContent = `@page { size: letter ${landscape ? 'landscape' : 'portrait'}; margin: 0.45in; } #printArea { font: 12px 'Segoe UI', Arial, sans-serif; color: #222; } #printArea table { width: 100%; border-collapse: collapse; } #printArea td, #printArea th { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: right; } #printArea td:first-child, #printArea th:first-child { text-align: left; } .env { width: 3.6in; height: 4.85in; border: 1.5px dashed #999; border-radius: 10px; padding: 12px; box-sizing: border-box; float: left; margin: 0 0.1in 0.12in 0; page-break-inside: avoid; } .env h2 { margin: 0; font-size: 22px; color: #1f7a5c; } .env .amt { font-size: 26px; font-weight: 800; margin: 2px 0 8px; } .env table td { height: 20px; border-bottom: 1px solid #ccc; font-size: 10px; }`;
  $('printArea').innerHTML = html; window.print(); setTimeout(() => { $('printArea').innerHTML = ''; $('pageRule').textContent = ''; }, 1500);
}
function printBudget() {
  if (needsPro('Printing the monthly budget is part of BudgetPress Pro.')) return;
  compute(); const av = availableMap(month);
  let rows = '';
  D.groups.forEach((g) => { const cats = g.cats.filter((c) => !c.hidden); if (!cats.length) return; rows += `<tr><th colspan="4" style="text-align:left;background:#eef6f2">${esc(g.name)}</th></tr>` + cats.map((c) => `<tr><td>${esc(c.name)}</td><td>${fmt(assignedIn(month, c.id))}</td><td>${fmt(activityIn(month, c.id))}</td><td>${fmt(av[c.id] || 0)}</td></tr>`).join(''); });
  printHtml(`<h1 style="color:#1f7a5c;margin:0">${esc(D.name)} – ${mLabel(month)}</h1><p>Ready to Assign: <b>${fmt(readyToAssign(month))}</b> · Income this month ${fmt(C.income[month] || 0)}</p><table><thead><tr><th>Category</th><th>Assigned</th><th>Activity</th><th>Available</th></tr></thead><tbody>${rows}</tbody></table><p style="color:#888">Printed from BudgetPress</p>`);
}
function printEnvelopes() {
  compute(); const cats = allCats().filter((c) => !c.hidden && !c.cc && assignedIn(month, c.id) > 0);
  if (!cats.length) { toast('Assign money to some categories this month first – one envelope is printed for each'); return; }
  const env = (c) => `<div class="env"><div style="font-size:10px;color:#888">${esc(mLabel(month))} · cut along the dashed line, fold or tape to an envelope</div><h2>${esc(c.name)}</h2><div class="amt">${fmt(assignedIn(month, c.id))}</div><table><tr><th>Date</th><th style="text-align:left">For</th><th>Spent</th><th>Left</th></tr>${'<tr><td></td><td></td><td></td><td></td></tr>'.repeat(10)}</table></div>`;
  printHtml(cats.map(env).join(''));
}

// ---------- import / export ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function parseDate(s, fmtHint) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; let mo, d; if (fmtHint === 'dmy' || (fmtHint !== 'mdy' && a > 12)) { d = a; mo = b; } else { mo = a; d = b; } if (mo > 12) [mo, d] = [d, mo]; return `${y}-${pad(mo)}-${pad(d)}`; }
  const t = Date.parse(s); return isNaN(t) ? null : dStr(new Date(t));
}
let imp = null;
function startImport(file, text) {
  if (needsPro('Importing bank files is part of BudgetPress Pro.')) return;
  if (!D.accounts.length) { toast('Add an account first'); return; }
  $('iAcct').innerHTML = acctOptions(txFilter.acct || D.accounts[0].id);
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text)) {
    const items = [...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi)].map((m) => { const g = (k) => ((m[1].match(new RegExp('<' + k + '>([^<\\r\\n]*)', 'i')) || [])[1] || '').trim(); return { date: parseDate(g('DTPOSTED')), amount: parseMoney(g('TRNAMT')), payee: g('NAME') || g('MEMO'), memo: g('NAME') ? g('MEMO') : '', fitid: g('FITID') }; }).filter((x) => x.date && !isNaN(x.amount));
    imp = { kind: 'ofx', items }; $('iCsv').hidden = true; $('impInfo').textContent = `${items.length} transactions found in ${file.name}.`;
  } else {
    const rows = parseCsv(text); if (rows.length < 2) { toast('No transactions found in that file'); return; }
    const head = rows[0].map((h) => h.trim()), opt = (re, none) => (none ? '<option value="-1">—</option>' : '') + head.map((h, i) => `<option value="${i}"${re && re.test(h) ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('');
    $('iDate').innerHTML = opt(/date|posted/i); $('iPayee').innerHTML = opt(/desc|payee|name|merchant|details/i); $('iAmt').innerHTML = opt(/^amount$|amount|value|betrag/i, true); $('iOut').innerHTML = opt(null, true);
    const debit = head.findIndex((h) => /debit|withdraw|out/i.test(h)); if (debit >= 0) { $('iOut').value = debit; const cr = head.findIndex((h) => /credit|deposit|in$/i.test(h)); if (cr >= 0) $('iAmt').value = cr; }
    imp = { kind: 'csv', rows }; $('iCsv').hidden = false; $('impInfo').textContent = `${rows.length - 1} rows in ${file.name}. Check the columns below.`;
  }
  $('impDlg').showModal();
}
function doImport() {
  const acct = $('iAcct').value; let items = [];
  if (imp.kind === 'ofx') items = imp.items;
  else {
    const di = +$('iDate').value, pi = +$('iPayee').value, ai = +$('iAmt').value, oi = +$('iOut').value, flip = $('iFlip').checked, df = $('iDateFmt').value;
    items = imp.rows.slice(1).map((r) => { let amt; if (oi >= 0) { const o = parseMoney(r[oi]), inn = ai >= 0 ? parseMoney(r[ai]) : NaN; amt = (isNaN(inn) ? 0 : Math.abs(inn)) - (isNaN(o) ? 0 : Math.abs(o)); } else amt = parseMoney(r[ai]); if (flip) amt = -amt; return { date: parseDate(r[di], df), amount: amt, payee: (r[pi] || '').trim(), memo: '' }; }).filter((x) => x.date && !isNaN(x.amount) && x.amount);
  }
  const isB = isBudgetAcct(acctById(acct)), seen = new Set(D.tx.filter((t) => t.acct === acct).map((t) => t.fitid || `${t.date}|${t.amount}|${(t.payee || '').toLowerCase()}`));
  let added = 0, dup = 0;
  change(() => { items.forEach((x) => { const key = x.fitid || `${x.date}|${x.amount}|${x.payee.toLowerCase()}`; if (seen.has(key) || seen.has(`${x.date}|${x.amount}|${x.payee.toLowerCase()}`)) { dup++; return; } seen.add(key); D.tx.push({ id: uid('t'), date: x.date, acct, payee: x.payee, cat: isB ? payeeCategory(x.payee) || (x.amount > 0 ? null : null) : null, amount: x.amount, memo: x.memo || '', cleared: 'c', flag: '', xfer: null, fitid: x.fitid || undefined }); added++; }); });
  $('impDlg').close(); txFilter = Object.assign(txFilter, { acct, flag: 'uncat' }); showTab('tx');
  toast(`Imported ${added} transaction${added === 1 ? '' : 's'}${dup ? `, skipped ${dup} already there` : ''}. Give the new ones a category.`);
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); toast(`Saved ${name} to your Downloads folder`); }
function exportCsv() {
  const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const rows = [['Date', 'Account', 'Payee', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared', 'Flag'].join(',')];
  D.tx.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((t) => { const parts = t.splits && t.splits.length ? t.splits : [{ cat: t.cat, amount: t.amount }]; parts.forEach((p) => rows.push([t.date, q((acctById(t.acct) || {}).name), q(t.xfer ? 'Transfer: ' + ((acctById(t.xfer.acct) || {}).name || '') : t.payee), q(t.xfer && !p.cat ? '' : catName(p.cat)), q(t.memo), p.amount < 0 ? money2(-p.amount) : '', p.amount > 0 ? money2(p.amount) : '', t.cleared === 'u' ? '' : t.cleared === 'r' ? 'Reconciled' : 'Cleared', t.flag || ''].join(','))); });
  download(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' }), `${D.name.replace(/[\\/:*?"<>|]+/g, ' ')} transactions.csv`);
}

// ---------- budgets, payees, PIN ----------
async function loadBudget(id) { const d = await dbGet('b:' + id); D = normalize(d || blankBudget()); curBudget = id; await dbSet('cur', id); undoStack.length = redoStack.length = 0; month = thisMonth(); txFilter = { acct: '', cat: '', month: '', flag: '', q: '' }; ccSync(); await loadSyncMeta(); runScheduled(); renderAll(); }
function normalize(d) { const b = blankBudget(); const o = Object.assign(b, d || {}); o.deleted = o.deleted || {}; o.groups = (d && d.groups) || b.groups; o.accounts = o.accounts || []; o.tx = o.tx || []; o.sched = o.sched || []; o.assigned = o.assigned || {}; return o; }
function renderBudgets() { $('budgetsList').innerHTML = budgets.map((b) => `<div class="sched" data-b="${b.id}"><span>${b.id === curBudget ? '✓ ' : ''}<b>${esc(b.name)}</b></span><small>${b.id === curBudget ? 'open now' : 'click to open'}</small></div>`).join(''); }
async function newBudget() {
  if (needsPro('Keeping several budgets is part of BudgetPress Pro.')) return;
  const name = prompt('Name of the new budget:', 'Household'); if (!name) return;
  const id = uid('b'); budgets.push({ id, name }); await dbSet('budgets', budgets); await dbSet('b:' + id, blankBudget(name)); await loadBudget(id); renderBudgets(); toast(`Opened "${name}"`);
}
async function renameBudget() { const b = budgets.find((x) => x.id === curBudget), n = prompt('Rename this budget:', b.name); if (!n) return; b.name = n; D.name = n; await dbSet('budgets', budgets); save(); renderBudgets(); }
async function deleteBudget() {
  if (budgets.length < 2) { toast('This is your only budget – use “Start over” instead'); return; }
  const b = budgets.find((x) => x.id === curBudget); if (!confirm(`Delete the budget "${b.name}" and everything in it? Save a backup first if you might need it.`)) return;
  budgets = budgets.filter((x) => x !== b); await dbSet('budgets', budgets); await dbDel('b:' + b.id); await loadBudget(budgets[0].id); renderBudgets();
}
function renderPayees() {
  const counts = {}; D.tx.forEach((t) => { if (t.payee) counts[t.payee] = (counts[t.payee] || 0) + 1; });
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  $('payeesList').innerHTML = names.map((n) => `<div class="sched" data-p="${esc(n)}"><span>${esc(n)}</span><small>${counts[n]} transaction${counts[n] === 1 ? '' : 's'} · ${esc(catName(payeeCategory(n)))}</small></div>`).join('') || '<p class="hint">No payees yet.</p>';
}
function renamePayee(old) { const n = prompt(`Rename "${old}" to:`, old); if (!n || n === old) return; change(() => { D.tx.forEach((t) => { if (t.payee === old) t.payee = n.trim(); }); D.sched.forEach((s) => { if (s.payee === old) s.payee = n.trim(); }); }); renderPayees(); }
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('budgetpress:' + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function savePin() { const p = $('pinNew').value.trim(); if (p && !/^\d{4,8}$/.test(p)) { toast('Use 4 to 8 digits'); return; } try { if (p) localStorage.setItem('budgetpress-pin', await sha(p)); else localStorage.removeItem('budgetpress-pin'); } catch (_) {} $('pinDlg').close(); toast(p ? '🔒 PIN saved – BudgetPress will ask for it when it opens' : 'PIN lock turned off'); }
async function tryUnlock() { let h = ''; try { h = localStorage.getItem('budgetpress-pin') || ''; } catch (_) {} if (!h || (await sha($('lockPin').value.trim())) === h) { $('lock').hidden = true; } else { $('lockMsg').textContent = 'Wrong PIN'; $('lockPin').value = ''; } }

// ---------- sample budget ----------
function sampleBudget() {
  const d = blankBudget('Sample Budget'); D = d;
  const ch = { id: uid('a'), name: 'Everyday Checking', type: 'checking' }, sv = { id: uid('a'), name: 'Savings', type: 'savings' }, cc = { id: uid('a'), name: 'Visa Card', type: 'credit', apr: 22.9, minPay: 4000 }, car = { id: uid('a'), name: 'Car Loan', type: 'loan', apr: 6.5, minPay: 32000 };
  d.accounts.push(ch, sv, cc, car); ccSync();
  const cat = (n) => allCats().find((c) => c.name === n).id;
  const m0 = mAdd(thisMonth(), -2), tx = (date, acct, payee, c, amount) => d.tx.push({ id: uid('t'), date, acct: acct.id, payee, cat: c, amount, memo: '', cleared: date < todayStr() ? 'c' : 'u', flag: '', xfer: null });
  tx(m0 + '-01', ch, 'Starting balance', 'rta', 285000); tx(m0 + '-01', sv, 'Starting balance', 'rta', 600000); tx(m0 + '-01', cc, 'Starting balance', '__start', -45000); tx(m0 + '-01', car, 'Starting balance', null, -1240000);
  const today = todayStr();
  for (let k = 0; k < 3; k++) {
    const m = mAdd(m0, k), dd = (n) => `${m}-${pad(n)}`, ok = (n) => dd(n) <= today;
    if (ok(1)) tx(dd(1), ch, 'Oakwood Apartments', cat('Rent / Mortgage'), -140000);
    [1, 15].forEach((n) => { if (ok(n)) tx(dd(n), ch, 'Acme Corp Payroll', 'rta', 215000); });
    [3, 10, 17, 24].forEach((n, i) => { if (ok(n)) tx(dd(n), i % 2 ? cc : ch, i % 2 ? 'Trader Joe’s' : 'Walmart', cat('Groceries'), -(9800 + i * 1700 + k * 900)); });
    if (ok(6)) tx(dd(6), ch, 'City Power', cat('Electricity'), -(8400 + k * 600));
    if (ok(8)) tx(dd(8), cc, 'Netflix', cat('Subscriptions'), -1549);
    if (ok(12)) tx(dd(12), cc, 'Shell', cat('Transportation'), -(4800 + k * 300));
    if (ok(19)) tx(dd(19), cc, 'Olive Garden', cat('Eating Out'), -(6200 - k * 800));
    if (ok(21)) tx(dd(21), ch, 'Comcast', cat('Internet & Phone'), -8999);
    if (ok(26)) { const id1 = uid('t'), id2 = uid('t'); d.tx.push({ id: id1, date: dd(26), acct: ch.id, payee: '', cat: null, amount: -30000, memo: 'Card payment', cleared: 'c', flag: '', xfer: { acct: cc.id, pair: id2 } }, { id: id2, date: dd(26), acct: cc.id, payee: '', cat: null, amount: 30000, memo: 'Card payment', cleared: 'c', flag: '', xfer: { acct: ch.id, pair: id1 } }); }
    d.assigned[m] = { [cat('Rent / Mortgage')]: 140000, [cat('Groceries')]: 60000, [cat('Electricity')]: 10000, [cat('Internet & Phone')]: 9000, [cat('Subscriptions')]: 1600, [cat('Transportation')]: 20000, [cat('Eating Out')]: 15000, [cat('Emergency Fund')]: k === 0 ? 450000 : 50000, [cat('Vacation')]: 25000, [cat('Gifts & Holidays')]: 10000, ['cc_' + cc.id]: k === 0 ? 45000 : 0 };
  }
  allCats().forEach((c) => { const o = catById(c.id); if (c.name === 'Emergency Fund') o.goal = { type: 'by', amount: 1000000, date: mAdd(thisMonth(), 12) }; if (c.name === 'Groceries') o.goal = { type: 'monthly', amount: 60000 }; if (c.name === 'Vacation') o.goal = { type: 'by', amount: 250000, date: mAdd(thisMonth(), 7) }; if (c.name === 'Insurance') o.goal = { type: 'yearly', amount: 120000, date: thisMonth().slice(0, 4) + '-03' }; });
  const nx = (day) => { const t = toDate(todayStr()); const x = new Date(t.getFullYear(), t.getMonth() + (t.getDate() >= day ? 1 : 0), day); return dStr(x); };
  d.sched.push({ id: uid('s'), kind: 'in', amount: 215000, payee: 'Acme Corp Payroll', cat: 'rta', acct: ch.id, every: '2week', next: nx(15) }, { id: uid('s'), kind: 'out', amount: 140000, payee: 'Oakwood Apartments', cat: cat('Rent / Mortgage'), acct: ch.id, every: 'month', next: nx(1) }, { id: uid('s'), kind: 'out', amount: 1549, payee: 'Netflix', cat: cat('Subscriptions'), acct: cc.id, every: 'month', next: nx(8) }, { id: uid('s'), kind: 'xfer', amount: 30000, payee: '', cat: null, acct: ch.id, to: cc.id, every: 'month', next: nx(26) });
  d.extraDebt = 20000;
  return d;
}

// ---------- wiring ----------
$('tabs').querySelectorAll('button').forEach((b) => { b.onclick = () => showTab(b.dataset.t); });
$('mPrev').onclick = () => { month = mAdd(month, -1); renderAll(); }; $('mNext').onclick = () => { month = mAdd(month, 1); renderAll(); };
$('rPrev').onclick = () => { repMonth = mAdd(repMonth, -1); renderAll(); }; $('rNext').onclick = () => { repMonth = mAdd(repMonth, 1); renderAll(); };
$('calPrev').onclick = () => { calMonth = mAdd(calMonth, -1); renderAll(); }; $('calNext').onclick = () => { calMonth = mAdd(calMonth, 1); renderAll(); };
$('budgetBody').addEventListener('change', (e) => { const i = e.target.closest('input.asg'); if (!i) return; const v = i.value.trim() === '' ? 0 : parseMoney(i.value); if (isNaN(v)) { toast('That is not an amount'); renderAll(); return; } setAssigned(i.dataset.c, v); });
$('budgetBody').addEventListener('keydown', (e) => { const i = e.target.closest('input.asg'); if (!i || e.key !== 'Enter') return; e.preventDefault(); const all = [...document.querySelectorAll('input.asg')], k = all.indexOf(i); i.blur(); setTimeout(() => { const nx = document.querySelectorAll('input.asg')[k + 1]; if (nx) { nx.focus(); nx.select(); } }, 30); });
$('budgetBody').addEventListener('focusin', (e) => { if (e.target.matches('input.asg')) e.target.select(); });
$('budgetBody').addEventListener('click', (e) => {
  const n = e.target.closest('td.name'), g = e.target.closest('tr.grp td[data-g]'), av = e.target.closest('[data-av]'), ac = e.target.closest('[data-act]');
  if (ac) { e.preventDefault(); txFilter = { acct: '', cat: ac.dataset.act, month, flag: '', q: '' }; showTab('tx'); return; }
  if (av) { const v = availableMap(month)[av.dataset.av] || 0; if (v < 0) openMove('rta', av.dataset.av, -v); else openMove(av.dataset.av, 'rta'); return; }
  if (n && n.dataset.unc) { txFilter = { acct: '', cat: '', month: '', flag: 'uncat', q: '' }; showTab('tx'); return; }
  if (n) openCat(n.dataset.c); else if (g) groupMenu(g.dataset.g);
});
$('autoAssign').onchange = (e) => { const v = e.target.value; e.target.value = ''; if (v) autoAssign(v); };
$('moveBtn').onclick = () => openMove('rta', '');
$('showHidden').onchange = renderAll;
$('addGroup').onclick = () => { const n = prompt('Name of the new group:', ''); if (n && n.trim()) change(() => { D.groups.push({ id: uid('g'), name: n.trim(), hidden: false, cats: [{ id: uid('c'), name: 'New category', hidden: false, note: '', goal: null }] }); }); };
$('mvGo').onclick = doMove; $('mvClose').onclick = () => $('moveDlg').close();
$('cGoalType').onchange = goalRows; $('cSave').onclick = saveCat; $('cDel').onclick = deleteCat; $('cClose').onclick = () => $('catDlg').close(); $('cUp').onclick = () => moveCat(-1); $('cDown').onclick = () => moveCat(1);
// transactions
['fAcct', 'fCat', 'fMonth', 'fFlag'].forEach((id) => { $(id).onchange = (e) => { txFilter[{ fAcct: 'acct', fCat: 'cat', fMonth: 'month', fFlag: 'flag' }[id]] = e.target.value; renderAll(); }; });
$('fSearch').addEventListener('input', (e) => { txFilter.q = e.target.value; clearTimeout(window.__sq); window.__sq = setTimeout(renderAll, 200); });
$('txBody').addEventListener('click', (e) => { const c = e.target.closest('[data-clr]'); if (c) { toggleCleared(c.dataset.clr); return; } const r = e.target.closest('tr[data-id]'); if (r) openTx(r.dataset.id); });
$('addTx').onclick = () => openTx(); $('addTxTop').onclick = () => openTx();
$('txKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { if (b.dataset.k === 'xfer') splits = null; setKind(b.dataset.k); if (b.dataset.k === 'in' && !$('tCat').value) $('tCat').value = 'rta'; if (b.dataset.k === 'out' && $('tCat').value === 'rta') $('tCat').value = ''; } });
$('tAcct').onchange = () => { $('tTo').innerHTML = acctOptions($('tTo').value, (a) => a.id !== $('tAcct').value); setKind(txKind); };
$('tTo').onchange = () => setKind(txKind);
$('tPayee').addEventListener('change', () => { if (!editTx && !splits) { const c = payeeCategory($('tPayee').value.trim()); if (c) $('tCat').value = c; } });
$('tAmt').addEventListener('input', () => { if (splits) splitLeft(); });
$('tSplitBtn').onclick = () => { const amt = parseMoney($('tAmt').value) || 0; splits = [{ cat: $('tCat').value || null, amount: amt }, { cat: null, amount: 0 }]; renderSplits(); };
$('tAddSplit').onclick = () => { const total = parseMoney($('tAmt').value) || 0, used = splits.reduce((s, x) => s + Math.abs(x.amount || 0), 0); splits.push({ cat: null, amount: Math.max(0, total - used) }); renderSplits(); };
$('tSplits').addEventListener('change', (e) => { const i = e.target.dataset.si; if (i == null) return; if (e.target.dataset.k === 'cat') splits[i].cat = e.target.value || null; else { const v = parseMoney(e.target.value); splits[i].amount = isNaN(v) ? 0 : Math.abs(v); } splitLeft(); });
$('tSplits').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (!d) return; splits.splice(+d.dataset.del, 1); if (splits.length < 2) { $('tCat').value = (splits[0] && splits[0].cat) || ''; splits = null; } renderSplits(); });
$('tSave').onclick = () => saveTx(false); $('tSaveNew').onclick = () => saveTx(true); $('tDel').onclick = deleteTx; $('tClose').onclick = () => $('txDlg').close();
$('txDlg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveTx(false); } });
$('reconBtn').onclick = openRecon; $('rcGo').onclick = doRecon; $('rcClose').onclick = () => $('reconDlg').close();
$('addSched').onclick = () => openSched(); $('schedList').addEventListener('click', (e) => { const s = e.target.closest('[data-s]'); if (s) openSched(s.dataset.s); });
$('sKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSKind(b.dataset.k); });
$('sSave').onclick = saveSched; $('sDel').onclick = () => { if (!editSched) return; change(() => { D.sched = D.sched.filter((x) => x !== editSched); }); $('schedDlg').close(); }; $('sClose').onclick = () => $('schedDlg').close();
// accounts
$('acctCards').addEventListener('click', (e) => { const v = e.target.closest('[data-view]'); if (v) { e.stopPropagation(); txFilter = { acct: v.dataset.view, cat: '', month: '', flag: '', q: '' }; showTab('tx'); return; } const c = e.target.closest('[data-a]'); if (c) openAcct(c.dataset.a); else if (e.target.closest('[data-new]')) openAcct(); });
$('aType').onchange = acctRows; $('aSave').onclick = saveAcct; $('aDel').onclick = deleteAcct; $('aClose').onclick = () => $('acctDlg').close();
// plan
$('extraDebt').addEventListener('change', (e) => { const v = parseMoney(e.target.value); change(() => { D.extraDebt = isNaN(v) ? 0 : Math.max(0, v); }); });
$('strategy').onchange = (e) => change(() => { D.strategy = e.target.value; });
document.addEventListener('click', (e) => { if (e.target.closest('[data-pro]')) openPro(''); });
// menu
$('moreBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
$('menu').addEventListener('click', (e) => { if (!e.target.closest('select, label')) $('menu').hidden = true; });
document.addEventListener('click', (e) => { if (!e.target.closest('#menu') && e.target !== $('moreBtn')) $('menu').hidden = true; });
$('currency').innerHTML = CURRENCIES.map((c) => `<option>${c}</option>`).join('');
$('currency').onchange = (e) => change(() => { D.currency = e.target.value; });
$('undoBtn').onclick = undo;
$('budgetsBtn').onclick = () => { renderBudgets(); $('budgetsDlg').showModal(); };
$('budgetsList').addEventListener('click', async (e) => { const b = e.target.closest('[data-b]'); if (b && b.dataset.b !== curBudget) { await loadBudget(b.dataset.b); renderBudgets(); $('budgetsDlg').close(); toast(`Opened "${D.name}"`); } });
$('bNew').onclick = newBudget; $('bRename').onclick = renameBudget; $('bDelete').onclick = deleteBudget; $('bClose').onclick = () => $('budgetsDlg').close();
$('payeesBtn').onclick = () => { renderPayees(); $('payeesDlg').showModal(); }; $('payeesList').addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (p) renamePayee(p.dataset.p); }); $('pyClose').onclick = () => $('payeesDlg').close();
$('pinBtn').onclick = () => { $('pinNew').value = ''; $('pinDlg').showModal(); }; $('pinSave').onclick = savePin; $('pinClose').onclick = () => $('pinDlg').close();
$('lockGo').onclick = tryUnlock; $('lockPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
$('printBudgetBtn').onclick = printBudget; $('printEnvBtn').onclick = printEnvelopes;
$('backupBtn').onclick = () => download(new Blob([JSON.stringify({ app: 'budgetpress', v: 1, budget: D })], { type: 'application/json' }), `${D.name.replace(/[\\/:*?"<>|]+/g, ' ')} ${todayStr()}.budgetpress.json`);
function pickFile(accept, cb) { const i = $('fileIn'); i.value = ''; i.accept = accept; i.onchange = async () => { if (i.files[0]) cb(i.files[0], await i.files[0].text()); }; i.click(); }
$('restoreBtn2').onclick = () => pickFile('.json,application/json', (f, text) => { try { const d = JSON.parse(text); if (d.app !== 'budgetpress' || !d.budget) throw 0; if (!confirm(`Replace the budget "${D.name}" with the one in this backup?`)) return; change(() => { const keepName = D.name; D = normalize(d.budget); D.name = D.name || keepName; }); toast('Backup opened'); } catch (_) { toast('That file is not a BudgetPress backup'); } });
$('importBtn').onclick = () => { if (needsPro('Importing bank files is part of BudgetPress Pro.')) return; pickFile('.csv,.ofx,.qfx,.txt', startImport); };
$('iGo').onclick = doImport; $('iClose').onclick = () => $('impDlg').close();
$('exportBtn').onclick = exportCsv;
$('sampleBtn').onclick = () => { if (D.tx.length && !confirm(`Replace "${D.name}" with a sample budget? Save a backup first if you want to keep it.`)) return; change(() => { const keep = D.name; D = sampleBudget(); D.name = keep === 'My Budget' ? 'Sample Budget' : keep; }); toast('Sample loaded – click around, nothing here is real'); };
$('clearBtn').onclick = () => { if (!confirm(`Erase everything in "${D.name}" and start over? (You can undo with Ctrl+Z.)`)) return; change(() => { const n = D.name, c = D.currency; D = blankBudget(n); D.currency = c; }); };
$('proBtn').onclick = () => { if (!isPro) openPro(''); }; $('trialBtn').onclick = startTrial;
setInterval(() => { if (!isPro && trialStart) { const was = $('proBtn').textContent; if (was !== proLabel()) setPro(false); } }, 3600000); $('buyBtn').onclick = buyPro; $('closePro').onclick = () => $('proDialog').close();
$('restoreBtn').onclick = async () => { proMessage('Checking your purchases…'); proMessage((await checkPro()) ? 'Pro is unlocked. ★' : 'No Pro purchase was found on this Microsoft account.'); };
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || !$('lock').hidden) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
  else if (!typing && e.key.toLowerCase() === 'n' && !e.ctrlKey) { e.preventDefault(); openTx(); }
});

// ---------- start ----------
(async () => {
  try { if (localStorage.getItem('budgetpress-pin')) { $('lock').hidden = false; setTimeout(() => $('lockPin').focus(), 50); } } catch (_) {}
  try {
    await loadTrial();
    budgets = (await dbGet('budgets')) || [];
    if (!budgets.length) { const id = uid('b'); budgets = [{ id, name: 'My Budget' }]; await dbSet('budgets', budgets); await dbSet('b:' + id, blankBudget('My Budget')); }
    const cur = await dbGet('cur');
    await loadBudget(budgets.some((b) => b.id === cur) ? cur : budgets[0].id);
  } catch (_) { D = blankBudget(); curBudget = 'mem'; renderAll(); toast('Storage is not available – changes will not be saved'); }
  $('currency').value = D.currency;
  checkPro();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// ---------- sync between PCs through a file in the user's cloud-drive folder ----------
// The budget is written to one file (optionally AES-GCM encrypted). OneDrive / Google Drive / Dropbox move the file between PCs.
const canSync = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
let sync = null; // { handle, salt, key, enc, seen, pushed, ok }
let syncTimer = 0, syncBusy = false;
const syncKey = () => 'sync:' + curBudget;
function scheduleSync() { if (!sync || !sync.ok) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 2500); }
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const b64 = (u8) => btoa(String.fromCharCode(...u8)), unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function packFile(data) {
  const body = { app: 'budgetpress-sync', v: 1, updated: data.updated || Date.now() };
  if (sync.enc) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sync.key, new TextEncoder().encode(JSON.stringify(data)))); Object.assign(body, { enc: true, salt: b64(sync.salt), iv: b64(iv), ct: b64(ct) }); }
  else body.data = data;
  return JSON.stringify(body);
}
async function unpackFile(text) {
  const f = JSON.parse(text); if (f.app !== 'budgetpress-sync') throw new Error('not a sync file');
  if (!f.enc) return { updated: f.updated, data: f.data };
  if (!sync.key) throw new Error('password');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, sync.key, unb64(f.ct));
  return { updated: f.updated, data: JSON.parse(new TextDecoder().decode(pt)) };
}
// combine two versions edited on different PCs
function mergeBudgets(a, b) {
  const [older, newer] = (a.updated || 0) > (b.updated || 0) ? [b, a] : [a, b];
  const out = JSON.parse(JSON.stringify(newer));
  const del = Object.assign({}, older.deleted || {}, newer.deleted || {}); out.deleted = del;
  const byId = new Map(); older.tx.forEach((t) => byId.set(t.id, t)); newer.tx.forEach((t) => byId.set(t.id, t));
  out.tx = [...byId.values()].filter((t) => !del[t.id]);
  const union = (key) => { const m = new Map(); (older[key] || []).forEach((x) => m.set(x.id, x)); (newer[key] || []).forEach((x) => m.set(x.id, x)); return [...m.values()]; };
  out.accounts = union('accounts').filter((x) => !del[x.id]); out.sched = union('sched').filter((x) => !del[x.id]);
  out.groups.forEach((g) => { g.cats = g.cats.filter((c) => !del[c.id]); });
  const have = new Set([...out.groups.flatMap((g) => g.cats.map((c) => c.id)), ...Object.keys(del)]);
  older.groups.forEach((g) => {
    const missing = g.cats.filter((c) => !have.has(c.id)); missing.forEach((c) => have.add(c.id));
    if (!missing.length) return;
    const tg = out.groups.find((x) => x.id === g.id);
    if (tg) tg.cats.push(...missing); else out.groups.push(Object.assign({}, g, { cats: missing }));
  });
  Object.entries(older.assigned || {}).forEach(([m, cats]) => { const t = (out.assigned[m] = out.assigned[m] || {}); Object.entries(cats).forEach(([k, v]) => { if (!(k in t)) t[k] = v; }); });
  out.updated = Math.max(a.updated || 0, b.updated || 0) + 1;
  return out;
}
function syncStatus(text, cls) { const b = $('syncState'); b.hidden = !sync; b.textContent = text; b.style.color = cls === 'warn' ? '#b42318' : ''; }
async function syncNow(manual) {
  if (!sync || syncBusy) return;
  if (!unlocked()) { syncStatus('☁ Sync paused – Pro', 'warn'); return; }
  if (!sync.ok) { syncStatus('☁ Click to resume sync', 'warn'); return; }
  syncBusy = true; syncStatus('☁ Syncing…');
  try {
    const file = await sync.handle.getFile(); let remote = null;
    if (file.size) { try { remote = await unpackFile(await file.text()); } catch (e) { if (e.message === 'password' || e.name === 'OperationError') { syncStatus('☁ Wrong password', 'warn'); toast('The sync file is encrypted with a different password – open ☁ Sync to type it'); syncBusy = false; return; } throw e; } }
    const localChanged = (D.updated || 0) > (sync.pushed || 0);
    let changed = false;
    if (remote && remote.updated > (sync.seen || 0)) {
      const incoming = normalize(remote.data);
      D = localChanged && sync.seen ? normalize(mergeBudgets(D, incoming)) : incoming;
      sync.seen = remote.updated; changed = true; ccSync(); compute(); renderAll();
      dbSet('b:' + curBudget, D).catch(() => {});
    }
    if (!remote || localChanged || (changed && D.updated > remote.updated)) {
      D.updated = D.updated || Date.now();
      const w = await sync.handle.createWritable(); await w.write(await packFile(D)); await w.close();
      sync.seen = D.updated; sync.pushed = D.updated;
    } else sync.pushed = Math.max(sync.pushed || 0, D.updated || 0);
    await saveSyncMeta();
    syncStatus('☁ Synced ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    if (manual) toast(changed ? 'Synced – changes from your other PC are in' : 'Synced');
  } catch (e) {
    syncStatus('☁ Sync problem', 'warn');
    if (e && e.name === 'NotAllowedError') { sync.ok = false; syncStatus('☁ Click to resume sync', 'warn'); }
    else if (manual) toast('Could not sync: ' + (e.message || e));
  }
  syncBusy = false;
}
async function saveSyncMeta() { if (!sync) return; await dbSet(syncKey(), { handle: sync.handle, salt: sync.salt, key: sync.key, enc: sync.enc, seen: sync.seen, pushed: sync.pushed }); }
async function loadSyncMeta() {
  sync = null; syncStatus('');
  if (!canSync) return;
  const m = await dbGet(syncKey()).catch(() => null); if (!m || !m.handle) return;
  sync = Object.assign({ ok: false }, m);
  try { sync.ok = (await m.handle.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (_) { sync.ok = false; }
  if (sync.ok) syncNow(false); else syncStatus('☁ Click to resume sync', 'warn');
}
async function resumeSync() { if (!sync) return; try { sync.ok = (await sync.handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (_) { sync.ok = false; } if (sync.ok) syncNow(true); else toast('BudgetPress needs permission to use the sync file'); }
function openSyncDlg() {
  if (!canSync) { toast('Sync needs the Microsoft Store app or Microsoft Edge / Google Chrome'); return; }
  if (!sync && needsPro('Syncing between PCs is part of BudgetPress Pro.')) return;
  $('syncSetup').hidden = !!sync && sync.ok;
  $('syncInfo').textContent = sync ? `This budget syncs with “${sync.handle.name}”${sync.enc ? ' (encrypted)' : ''}.${sync.ok ? '' : ' Click “Sync now” to give permission again.'}` : 'This budget is not synced yet. Create a sync file inside your OneDrive (or Google Drive, Dropbox…) folder on this PC, then on your other PC choose “Use a sync file from another PC”.';
  $('syncNowBtn').hidden = $('syncStop').hidden = !sync; $('syncPass').value = '';
  $('syncDlg').showModal();
}
async function syncCreate() {
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: `${D.name.replace(/[\\/:*?"<>|]+/g, ' ')}.budgetpress-sync`, types: [{ description: 'BudgetPress sync file', accept: { 'application/json': ['.budgetpress-sync'] } }] });
    const pass = $('syncPass').value, salt = crypto.getRandomValues(new Uint8Array(16));
    sync = { handle, ok: true, enc: !!pass, salt, key: pass ? await deriveKey(pass, salt) : null, seen: 0, pushed: 0 };
    D.updated = D.updated || Date.now();
    const w = await handle.createWritable(); await w.write(await packFile(D)); await w.close();
    sync.seen = sync.pushed = D.updated; await saveSyncMeta();
    $('syncDlg').close(); syncStatus('☁ Synced'); toast(`☁ Syncing with ${handle.name}. On your other PC: ☰ More → Sync → Use a sync file from another PC.`);
  } catch (e) { if (e && e.name !== 'AbortError') toast('Could not create the sync file: ' + (e.message || e)); }
}
async function syncOpen() {
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: 'BudgetPress sync file', accept: { 'application/json': ['.budgetpress-sync'] } }] });
    const text = await (await handle.getFile()).text(), f = JSON.parse(text);
    if (f.app !== 'budgetpress-sync') throw new Error('That is not a BudgetPress sync file');
    const pass = $('syncPass').value;
    if (f.enc && !pass) { toast('This sync file is encrypted – type its password first, then choose the file again'); $('syncPass').focus(); return; }
    const salt = f.enc ? unb64(f.salt) : crypto.getRandomValues(new Uint8Array(16));
    sync = { handle, ok: true, enc: !!f.enc, salt, key: f.enc ? await deriveKey(pass, salt) : null, seen: 0, pushed: 0 };
    let remote; try { remote = await unpackFile(text); } catch (_) { sync = null; toast('Wrong password for this sync file'); return; }
    // open it as this budget when this one is empty, otherwise as a new budget
    if (D.tx.length || D.accounts.length) {
      if (!confirm(`Open “${remote.data.name || handle.name}” as a new budget on this PC? (Cancel to keep your current budget unchanged.)`)) { sync = null; return; }
      const id = uid('b'); budgets.push({ id, name: remote.data.name || 'Synced budget' }); await dbSet('budgets', budgets); curBudget = id; await dbSet('cur', id);
    }
    D = normalize(remote.data); sync.seen = sync.pushed = remote.updated; D.updated = remote.updated;
    await dbSet('b:' + curBudget, D); await saveSyncMeta(); undoStack.length = 0;
    $('syncDlg').close(); syncStatus('☁ Synced'); renderAll(); toast(`☁ Opened “${D.name}” – it now stays in sync with your other PC`);
  } catch (e) { if (e && e.name !== 'AbortError') toast(e.message || String(e)); }
}
async function syncStop() { if (!confirm('Stop syncing this budget on this PC? The budget stays here and the sync file stays in your cloud folder.')) return; await dbDel(syncKey()); sync = null; syncStatus(''); $('syncDlg').close(); toast('Sync turned off on this PC'); }
$('syncBtn').onclick = openSyncDlg; $('syncState').onclick = () => { if (sync && !sync.ok) resumeSync(); else openSyncDlg(); };
$('syncCreate').onclick = syncCreate; $('syncOpen').onclick = syncOpen; $('syncStop').onclick = syncStop; $('syncClose').onclick = () => $('syncDlg').close();
$('syncNowBtn').onclick = async () => { if (sync && !sync.ok) await resumeSync(); else await syncNow(true); openSyncDlg(); };
window.addEventListener('focus', () => { if (sync && sync.ok) syncNow(false); });
setInterval(() => { if (sync && sync.ok && document.visibilityState === 'visible') syncNow(false); }, 60000);
