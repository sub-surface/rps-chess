// JANKEN admin dashboard. The key is held only in sessionStorage (cleared when the tab
// closes) and sent per request; the Worker compares it in constant time against ADMIN_KEY.
const $ = (id) => document.getElementById(id);
const KEY = 'janken-admin-key';
const REFRESH_MS = 15000;
let auto = true, timer = null;

const num = (n) => (n ?? 0).toLocaleString('en-US');
function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
const signed = (d) => (d >= 0 ? '+' : '−') + Math.abs(Math.round(d));

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}
// Link a name to its public profile on the main site (new tab); plain text if no account id.
function profileLink(name, id) {
  if (!id) return document.createTextNode(name || '—');
  return el('a', { href: '/#u=' + encodeURIComponent(id), target: '_blank', rel: 'noopener', text: name || id });
}

function tile(parent, value, label, sub, accent) {
  const t = el('div', { class: 'tile' + (accent ? ' accent' : '') });
  t.append(el('b', { text: value }), el('span', { text: label }));
  if (sub != null) t.append(el('small', { text: sub }));
  parent.append(t);
}

function table(node, headers, rows) {
  node.innerHTML = '';
  const thead = el('thead');
  thead.append(el('tr', {}, headers.map((h) => el('th', { class: h.num ? 'num' : '', text: h.label }))));
  node.append(thead);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const cell of r) {
      const td = el('td', { class: (cell.num ? 'num ' : '') + (cell.cls || '') });
      if (cell.node) td.append(cell.node); else td.textContent = cell.text ?? '';
      tr.append(td);
    }
    tbody.append(tr);
  }
  node.append(tbody);
  if (!rows.length) {
    const tr = el('tr');
    tr.append(el('td', { class: 'muted', colspan: String(headers.length), text: 'nothing yet' }));
    node.append(el('tbody', {}, [tr]));
  }
}

function render(s) {
  const u = s.users, g = s.games;
  const ut = $('user-tiles'); ut.innerHTML = '';
  tile(ut, num(u.total), 'accounts', null, true);
  tile(ut, num(u.new24), 'new · 24h', num(u.new7) + ' in 7d');
  tile(ut, num(u.active24), 'active · 24h', num(u.active7) + ' in 7d');
  tile(ut, u.avgRating ?? '—', 'avg rating', u.maxRating ? 'peak ' + u.maxRating : null);

  const gt = $('game-tiles'); gt.innerHTML = '';
  tile(gt, num(g.total), 'rated games', null, true);
  tile(gt, num(g.last24), 'played · 24h', num(g.last7) + ' in 7d');
  tile(gt, num(g.abandoned), 'abandoned', g.total ? Math.round(g.abandoned / g.total * 100) + '% of all' : null);
  tile(gt, num(g.draws), 'draws');
  tile(gt, num(g.openNow), 'open now', 'in lobby');

  $('top-count').textContent = s.top.length ? `${s.top.length} shown` : '';
  table($('top-t'),
    [{ label: '#' }, { label: 'player' }, { label: 'rating', num: true }, { label: 'peak', num: true }, { label: 'w–d–l' }, { label: 'seen', num: true }],
    s.top.map((p, i) => [
      { text: String(i + 1), num: true },
      { node: profileLink(p.name, p.id), cls: 'name' },
      { text: Math.round(p.rating), num: true },
      { text: Math.round(p.peak), num: true },
      { text: `${p.wins}–${p.draws}–${p.losses}` },
      { text: ago(p.seen_at), num: true },
    ]));

  $('new-count').textContent = s.newest.length ? `${s.newest.length} shown` : '';
  table($('new-t'),
    [{ label: 'player' }, { label: 'rating', num: true }, { label: 'games', num: true }, { label: 'joined', num: true }],
    s.newest.map((p) => [
      { node: profileLink(p.name, p.id), cls: 'name' },
      { text: Math.round(p.rating), num: true },
      { text: num(p.games), num: true },
      { text: ago(p.created_at), num: true },
    ]));

  $('recent-count').textContent = s.recent.length ? `${s.recent.length} shown` : '';
  table($('recent-t'),
    [{ label: 'when', num: true }, { label: 'blue' }, { label: '' }, { label: 'red' }, { label: 'Δ blue', num: true }, { label: 'Δ red', num: true }, { label: 'variant' }],
    s.recent.map((m) => {
      const resB = m.winner === null ? { t: 'D', c: 'd' } : m.winner === 'B' ? { t: '▸', c: 'w' } : { t: '◂', c: 'l' };
      return [
        { text: ago(m.played_at), num: true },
        { node: profileLink(m.blueName, m.blueId), cls: 'name' },
        { node: el('span', { class: 'res ' + resB.c, text: resB.t }) },
        { node: profileLink(m.redName, m.redId), cls: 'name' },
        { node: el('span', { class: m.delta_b >= 0 ? 'pos' : 'neg', text: signed(m.delta_b) }), num: true },
        { node: el('span', { class: m.delta_r >= 0 ? 'pos' : 'neg', text: signed(m.delta_r) }), num: true },
        { node: el('span', {}, [document.createTextNode(m.variant + ' '), m.reason === 'abandon' ? el('span', { class: 'tag aband', text: '· abandoned' }) : document.createTextNode('')]) },
      ];
    }));

  $('open-count').textContent = s.openGames.length ? `${s.openGames.length} open` : '';
  table($('open-t'),
    [{ label: 'host' }, { label: 'rating', num: true }, { label: 'variant' }, { label: 'room' }, { label: 'age', num: true }],
    s.openGames.map((o) => [
      { text: o.host || 'guest', cls: 'name' },
      { text: typeof o.rating === 'number' ? Math.round(o.rating) : '—', num: true },
      { text: o.variant || '' },
      { node: el('a', { href: '/#r=' + encodeURIComponent(o.room), target: '_blank', rel: 'noopener', text: o.room }) },
      { text: ago(o.ts), num: true },
    ]));

  $('stamp').textContent = 'updated ' + new Date(s.now).toLocaleTimeString();
}

function cfLinks() {
  const to = (path) => 'https://dash.cloudflare.com/?to=' + encodeURIComponent(path);
  const links = [
    ['Worker metrics & observability', to('/:account/workers/services/view/rps-chess/production/observability')],
    ['Live logs (tail)', to('/:account/workers/services/view/rps-chess/production/observability/logs')],
    ['D1 database (console & metrics)', to('/:account/workers/d1/databases/af563d71-f96d-4758-9bad-1215443feef5')],
    ['Durable Objects', to('/:account/workers/durable-objects')],
  ];
  const box = $('cf-links'); box.innerHTML = '';
  for (const [label, href] of links) box.append(el('a', { href, target: '_blank', rel: 'noopener', text: label }));
}

function showDash() { $('login').hidden = true; $('dash').hidden = false; }
function showLogin(msg) {
  $('dash').hidden = true; $('login').hidden = false;
  $('login-err').textContent = msg || '';
  stopAuto();
}

async function load() {
  const key = sessionStorage.getItem(KEY);
  if (!key) return showLogin();
  try {
    const res = await fetch('/api/admin/stats', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }),
    });
    if (res.status === 401) { sessionStorage.removeItem(KEY); return showLogin('Key rejected.'); }
    if (!res.ok) throw new Error('status ' + res.status);
    const { stats } = await res.json();
    render(stats);
    showDash();
    scheduleAuto();
  } catch {
    $('stamp').textContent = 'refresh failed — retrying';
    scheduleAuto();
  }
}

function scheduleAuto() {
  stopAuto();
  if (auto && !document.hidden && !$('dash').hidden) timer = setTimeout(load, REFRESH_MS);
}
function stopAuto() { if (timer) { clearTimeout(timer); timer = null; } }

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const key = $('key').value.trim();
  if (!key) return;
  sessionStorage.setItem(KEY, key);
  $('key').value = '';
  $('login-err').textContent = 'checking…';
  load();
});
$('refresh').onclick = load;
$('logout').onclick = () => { sessionStorage.removeItem(KEY); stopAuto(); showLogin('Logged out.'); };
$('auto').onclick = () => { auto = !auto; $('auto').textContent = 'auto: ' + (auto ? 'on' : 'off'); if (auto) scheduleAuto(); else stopAuto(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAuto(); else if (!$('dash').hidden) load(); });

cfLinks();
load();
