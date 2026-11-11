/* Settle: front end (no build step). Amounts from the server are in paise. */
(() => {
  const $app = document.getElementById('app');
  const $tabs = document.getElementById('tabs');
  const $sheetRoot = document.getElementById('sheet-root');
  const $toast = document.getElementById('toast');

  // ---------- utilities ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const rs = (paise) => '₹' + inr.format(Math.abs(paise) / 100);
  const rupees = (paise) => (paise / 100).toFixed(2).replace(/\.00$/, '');
  const toPaise = (v) => Math.round((parseFloat(v) || 0) * 100);
  const today = () => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    const t = new Date(today() + 'T00:00:00');
    const diff = Math.round((t - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  };
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const HUES = [['#E6EBFB', '#2B47C9'], ['#E3F0E8', '#2F6B49'], ['#FBE9DF', '#9A4422'], ['#EFE6FA', '#6338A8'], ['#E0F1F4', '#1F6A78'], ['#F8ECCF', '#7A5600'], ['#F7E3EC', '#9B2F5E']];
  const avatar = (name, cls = '') => {
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [bg, fg] = HUES[h % HUES.length];
    return `<span class="av ${cls}" style="--h:${bg};--hc:${fg}" aria-hidden="true">${esc(initials(name) || '?')}</span>`;
  };
  const icon = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    receipt: '<svg viewBox="0 0 24 24"><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9 8.5h6M9 12h6"/></svg>',
    in: '<svg viewBox="0 0 24 24"><path d="M12 4v13M6 11l6 6 6-6M5 20h14"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M12 20V7M6 13l6-6 6 6M5 4h14"/></svg>',
  };

  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.remove('show'), 2400);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !opts.allow401) { go('#/login'); throw new Error('Signed out'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  const header = (title, back) => `
    <div class="top">
      ${back ? `<a class="back" href="${back}">${icon.back}Back</a>` : `<h1>${esc(title)}</h1>`}
    </div>${back && title ? `<h1 style="margin:-8px 0 20px">${esc(title)}</h1>` : ''}`;

  function bindForm(form, handler) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.err');
      const btn = form.querySelector('[type=submit]');
      if (err) err.textContent = '';
      btn && (btn.disabled = true);
      try { await handler(Object.fromEntries(new FormData(form))); }
      catch (ex) { if (err) err.textContent = ex.message; else toast(ex.message); }
      finally { btn && (btn.disabled = false); }
    });
  }

  // ---------- sheets (bottom panels) ----------
  function openSheet(html, onMount) {
    $sheetRoot.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
    const scrim = $sheetRoot.firstElementChild;
    const close = () => { $sheetRoot.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    onMount?.(scrim.querySelector('.sheet'), close);
    setTimeout(() => scrim.querySelector('input:not([type=hidden]), select')?.focus(), 60);
  }

  function personSheet(person, onSaved) {
    const editing = !!person;
    openSheet(`
      <h2>${editing ? 'Edit person' : 'Add a person'}</h2>
      <p class="sub">${editing ? 'Update their details.' : 'Anyone you spend money for. Only you can see this list.'}</p>
      <form>
        <label class="field"><span>Name</span><input class="input" name="name" required maxlength="60" value="${esc(person?.name)}" autocomplete="off"></label>
        <label class="field"><span>Phone (optional, for WhatsApp reminders)</span><input class="input" name="phone" inputmode="tel" value="${esc(person?.phone)}"></label>
        <p class="err"></p>
        <div class="btn-row"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">${editing ? 'Save' : 'Add person'}</button></div>
      </form>`, (sheet, close) => {
      bindForm(sheet.querySelector('form'), async (v) => {
        const saved = editing
          ? (await api('/people/' + person.id, { method: 'PUT', body: v }), { ...person, ...v })
          : await api('/people', { method: 'POST', body: v });
        close();
        toast(editing ? 'Saved' : `${saved.name} added`);
        onSaved?.(saved);
      });
    });
  }

  // Plain-language balance: positive = they owe you, negative = you owe them.
  const balText = (b) => b > 0 ? 'owes you' : b < 0 ? 'you owe' : 'settled';

  async function paymentSheet(presetId, onSaved) {
    const people = await api('/people');
    if (!people.length) { toast('Add a person first'); return; }
    const open = people.filter((p) => p.balance !== 0);
    const list = presetId ? people : (open.length ? open : people);
    const label = (p) => `${esc(p.name)}${p.balance > 0 ? ` (owes you ${rs(p.balance)})` : p.balance < 0 ? ` (you owe ${rs(p.balance)})` : ''}`;
    const opts = list.map((p) => `<option value="${p.id}" ${p.id === presetId ? 'selected' : ''}>${label(p)}</option>`).join('');
    const first = people.find((p) => p.id === presetId) || list[0];
    let dir = first.balance < 0 ? 'out' : 'in';

    openSheet(`
      <h2>Record a payment</h2>
      <p class="sub">Money that changed hands. Part payments are fine.</p>
      <form>
        <div class="seg" role="group" aria-label="Direction">
          <button type="button" data-dir="in">They paid me</button><button type="button" data-dir="out">I paid them</button>
        </div>
        <label class="field"><span data-who>From</span><select class="input" name="personId">${opts}</select></label>
        <div class="due-box"><span class="muted" data-due-label></span><span class="amt" data-due></span></div>
        <label class="field"><span>Amount</span><div class="money big"><input class="input" name="amount" inputmode="decimal" placeholder="0" required></div></label>
        <div class="quick-row"><button type="button" class="link-btn" data-full>Full amount</button></div>
        <p class="after" data-after></p>
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${today()}" max="${today()}"></label>
        <label class="field"><span>Note (optional)</span><input class="input" name="note" placeholder="UPI, cash…" maxlength="80"></label>
        <p class="err"></p>
        <button class="btn pen block" type="submit">Save payment</button>
      </form>`, (sheet, close) => {
      const sel = sheet.querySelector('select');
      const amt = sheet.querySelector('[name=amount]');
      const person = () => people.find((x) => x.id === Number(sel.value));
      // How much this payment can settle in the chosen direction.
      const settleable = (p) => (dir === 'in' ? Math.max(p.balance, 0) : Math.max(-p.balance, 0));

      const update = () => {
        const p = person();
        sheet.querySelectorAll('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.dir === dir));
        sheet.querySelector('[data-who]').textContent = dir === 'in' ? 'From' : 'To';
        sheet.querySelector('[data-due-label]').textContent = p.balance === 0 ? 'Balance' : p.balance > 0 ? `${p.name} owes you` : `You owe ${p.name}`;
        sheet.querySelector('[data-due]').innerHTML = p.balance === 0 ? '<span class="amt-clear">Settled</span>'
          : `<span class="${p.balance > 0 ? 'amt-pen' : 'amt-owe'}">${rs(p.balance)}</span>`;
        sheet.querySelector('[data-full]').hidden = settleable(p) === 0;
        const paid = toPaise(amt.value);
        const next = p.balance + (dir === 'in' ? -paid : paid);
        sheet.querySelector('[data-after]').innerHTML = !paid ? ''
          : next === 0 ? `This <b>settles</b> everything between you and ${esc(p.name)}.`
            : next > 0 ? `After this, ${esc(p.name)} owes you <b>${rs(next)}</b>.`
              : `After this, you owe ${esc(p.name)} <b>${rs(next)}</b>.`;
      };
      sheet.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { dir = b.dataset.dir; update(); }));
      sheet.querySelector('[data-full]').addEventListener('click', () => { amt.value = rupees(settleable(person())); update(); amt.focus(); });
      sel.addEventListener('change', () => { const p = person(); if (p.balance) dir = p.balance < 0 ? 'out' : 'in'; update(); });
      amt.addEventListener('input', update);
      update();
      bindForm(sheet.querySelector('form'), async (v) => {
        await api('/payments', { method: 'POST', body: { ...v, personId: Number(v.personId), direction: dir } });
        const p = person();
        const next = p.balance + (dir === 'in' ? -toPaise(v.amount) : toPaise(v.amount));
        close();
        toast(next === 0 ? `Saved. You and ${p.name} are settled`
          : next > 0 ? `Saved. ${p.name} owes you ${rs(next)}` : `Saved. You owe ${p.name} ${rs(next)}`);
        onSaved?.();
      });
    });
  }

  function confirmSheet({ title, body, action, danger = true }) {
    return new Promise((resolve) => {
      openSheet(`<h2>${esc(title)}</h2><p class="sub">${body}</p>
        <div class="btn-row"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(action)}</button></div>`,
      (sheet, close) => {
        sheet.querySelector('[data-close]').addEventListener('click', () => resolve(false));
        sheet.querySelector('[data-ok]').addEventListener('click', () => { close(); resolve(true); });
      });
    });
  }

  // ---------- views ----------
  const views = {};

  views.login = () => {
    $app.innerHTML = `
      <section class="auth">
        <div class="mark"><i>₹</i><b>Settle</b></div>
        <h1>Sign in</h1>
        <p class="lead">Keep track of who owes you, and how much is left.</p>
        <form>
          <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" required></label>
          <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
          <p class="err"></p>
          <button class="btn block" type="submit">Sign in</button>
        </form>
        <p class="foot"><a class="link-btn" href="#/forgot">Forgot password?</a></p>
      </section>`;
    bindForm($app.querySelector('form'), async (v) => {
      await api('/login', { method: 'POST', body: v, allow401: true });
      go('#/');
    });
  };

  views.forgot = () => {
    $app.innerHTML = `
      <section class="auth">
        <div class="mark"><i>₹</i><b>Settle</b></div>
        <h1>Reset password</h1>
        <p class="lead">Enter the username and choose a new password.</p>
        <form>
          <label class="field"><span>Username</span><input class="input" name="username" autocapitalize="none" required></label>
          <label class="field"><span>New password</span><input class="input" type="password" name="newPassword" minlength="4" autocomplete="new-password" required></label>
          <label class="field"><span>Confirm new password</span><input class="input" type="password" name="confirm" minlength="4" autocomplete="new-password" required></label>
          <p class="err"></p>
          <button class="btn block" type="submit">Reset password</button>
        </form>
        <p class="foot"><a class="link-btn" href="#/login">Back to sign in</a></p>
      </section>`;
    bindForm($app.querySelector('form'), async (v) => {
      if (v.newPassword !== v.confirm) throw new Error('The two passwords don’t match');
      await api('/forgot-password', { method: 'POST', body: v, allow401: true });
      toast('Password reset. Sign in with the new one.');
      go('#/login');
    });
  };

  const personRow = (p, sub) => `
    <a class="row" href="#/people/${p.id}">
      ${avatar(p.name)}
      <div class="main"><div class="t">${esc(p.name)}</div><div class="s">${sub}</div></div>
      <div class="end"><div class="amt ${p.balance > 0 ? 'amt-pen' : 'amt-owe'}">${rs(p.balance)}</div></div>
    </a>`;

  views.home = async () => {
    const s = await api('/summary');
    const whole = Math.floor(s.outstanding / 100), paise = s.outstanding % 100;
    const strip = s.pendingPeople.length
      ? `<div class="strip">${s.pendingPeople.map((p) => `<a href="#/people/${p.id}" style="--w:${p.balance}" title="${esc(p.name)}: ${rs(p.balance)}">${esc(initials(p.name))}</a>`).join('')}</div>`
      : '<div class="strip empty"></div>';
    const empty = !s.pendingPeople.length && !s.owePeople.length;
    $app.innerHTML = `
      <section class="hero">
        <div class="label">${s.outstanding > 0 ? `To collect from ${s.pendingPeople.length} ${s.pendingPeople.length === 1 ? 'person' : 'people'}` : 'Nothing to collect'}</div>
        <div class="big"><span class="rs">₹</span>${inr.format(whole)}${paise ? `<span class="paise">.${String(paise).padStart(2, '0')}</span>` : ''}</div>
        ${strip}
        <div class="hero-stats">
          ${s.youOwe ? `<span>You owe <b class="amt-owe">${rs(s.youOwe)}</b></span>` : `<span>Collected <b>${rs(s.collected)}</b></span>`}
          <span>Open splits <b>${s.openSplits}</b></span>
        </div>
      </section>
      <div class="btn-row" style="margin-top:24px">
        <a class="btn pen" href="#/splits/new">New split</a>
        <button class="btn ghost" data-pay>Record payment</button>
      </div>

      ${s.pendingPeople.length ? `<div class="section-head"><h2>Who owes you</h2><a href="#/people">All people</a></div>
        <div class="list">${s.pendingPeople.map((p) => personRow(p, p.paid ? `Paid back ${rs(p.paid)} so far` : 'Nothing paid yet')).join('')}</div>` : ''}

      ${s.owePeople.length ? `<div class="section-head"><h2>You owe</h2>${s.pendingPeople.length ? '' : '<a href="#/people">All people</a>'}</div>
        <div class="list">${s.owePeople.map((p) => personRow(p, p.iPaid ? `You’ve paid ${rs(p.iPaid)} so far` : 'Not paid yet')).join('')}</div>` : ''}

      ${empty ? `<div class="section-head"><h2>Balances</h2></div><div class="empty-state"><h3>All clear</h3>
        <p>${s.lent || s.borrowed ? 'Nobody owes anybody right now.' : 'Add the people you share costs with, then record your first split.'}</p>
        ${s.lent || s.borrowed ? '' : '<a class="btn pen" href="#/splits/new">Create a split</a>'}</div>` : ''}

      ${s.activity.length ? `<div class="section-head"><h2>Recent</h2></div>
      <div class="list">${s.activity.map((a) => a.type === 'split' ? `
        <a class="row" href="#/splits/${a.id}">
          <span class="glyph ${a.paidBy ? 'out' : ''}">${icon.receipt}</span>
          <div class="main"><div class="t">${esc(a.title)}</div><div class="s">${a.paidBy ? `Paid by ${esc(a.paidBy)}` : `Split with ${a.people} ${a.people === 1 ? 'person' : 'people'}`}, ${fmtDate(a.date)}</div></div>
          <div class="end amt ${a.paidBy ? 'amt-owe' : ''}">${rs(a.amount)}</div>
        </a>` : `
        <a class="row" href="#/people/${a.personId}">
          <span class="glyph ${a.direction === 'out' ? 'out' : 'in'}">${a.direction === 'out' ? icon.out : icon.in}</span>
          <div class="main"><div class="t">${a.direction === 'out' ? `You paid ${esc(a.title)}` : `${esc(a.title)} paid you`}</div><div class="s">${fmtDate(a.date)}</div></div>
          <div class="end amt ${a.direction === 'out' ? '' : 'amt-clear'}">${a.direction === 'out' ? '−' : '+'}${rs(a.amount)}</div>
        </a>`).join('')}</div>` : ''}`;
    $app.querySelector('[data-pay]').addEventListener('click', () => paymentSheet(null, render));
  };

  views.people = async () => {
    const people = await api('/people');
    const rank = (p) => (p.balance > 0 ? 0 : p.balance < 0 ? 1 : 2);
    const sorted = [...people].sort((a, b) => rank(a) - rank(b) || Math.abs(b.balance) - Math.abs(a.balance) || a.name.localeCompare(b.name));
    $app.innerHTML = `
      <div class="top"><h1>People</h1><button class="btn sm ghost" data-add>Add person</button></div>
      ${people.length > 6 ? '<label class="field"><input class="input" type="search" placeholder="Search people" aria-label="Search people" data-search></label>' : ''}
      ${people.length ? `<div class="list" data-list>${sorted.map((p) => `
        <a class="row" href="#/people/${p.id}" data-name="${esc(p.name.toLowerCase())}">
          ${avatar(p.name)}
          <div class="main"><div class="t">${esc(p.name)}</div><div class="s">${p.owed || p.iOwe ? `${p.owed ? `Lent ${rs(p.owed)}` : ''}${p.owed && p.iOwe ? ', ' : ''}${p.iOwe ? `borrowed ${rs(p.iOwe)}` : ''}` : 'No splits yet'}</div></div>
          <div class="end">${p.balance ? `<div class="amt ${p.balance > 0 ? 'amt-pen' : 'amt-owe'}">${rs(p.balance)}</div><div class="s">${balText(p.balance)}</div>`
            : p.owed || p.iOwe ? '<span class="pill settled">Settled</span>' : ''}</div>
        </a>`).join('')}</div>`
        : '<div class="empty-state"><h3>No people yet</h3><p>Add friends, family or flatmates you share money with.</p><button class="btn pen" data-add>Add person</button></div>'}`;
    $app.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => personSheet(null, render)));
    $app.querySelector('[data-search]')?.addEventListener('input', (e) => {
      const t = e.target.value.trim().toLowerCase();
      $app.querySelectorAll('[data-list] .row').forEach((r) => { r.hidden = !r.dataset.name.includes(t); });
    });
  };

  views.person = async (id) => {
    const p = await api('/people/' + id);
    const any = p.owed || p.iOwe;
    const status = p.balance > 0 ? `<div class="bal amt-pen">${rs(p.balance)}</div><div class="bal-sub">${esc(p.name.split(' ')[0])} owes you</div>`
      : p.balance < 0 ? `<div class="bal amt-owe">${rs(p.balance)}</div><div class="bal-sub">You owe ${esc(p.name.split(' ')[0])}</div>`
        : `<div class="bal amt-clear">${any ? 'Settled' : rs(0)}</div><div class="bal-sub">${any ? 'Nobody owes anything' : 'No splits yet'}</div>`;

    const card = (inner) => `<div class="list" style="margin-bottom:6px">${inner}</div>`;
    let lastDate = '', rows = '';
    for (const e of p.ledger) {
      if (e.date !== lastDate) { rows += `<div class="date-group">${fmtDate(e.date)}</div>`; lastDate = e.date; }
      const left = e.amount - (e.settled || 0);
      if (e.type === 'share') rows += card(`<a class="row" href="#/splits/${e.splitId}">
          <span class="glyph">${icon.receipt}</span>
          <div class="main"><div class="t">${esc(e.title)}</div><div class="s">${left <= 0 ? 'Their share, paid' : e.settled ? `Their share, ${rs(left)} left` : 'Their share, not paid yet'}</div></div>
          <div class="end amt">${rs(e.amount)}</div></a>`);
      else if (e.type === 'owe') rows += card(`<a class="row" href="#/splits/${e.splitId}">
          <span class="glyph out">${icon.receipt}</span>
          <div class="main"><div class="t">${esc(e.title)}</div><div class="s">${left <= 0 ? 'They paid, your share cleared' : e.settled ? `They paid, you owe ${rs(left)} more` : 'They paid, your share'}</div></div>
          <div class="end amt amt-owe">${rs(e.amount)}</div></a>`);
      else rows += card(`<div class="row">
          <span class="glyph ${e.direction === 'out' ? 'out' : 'in'}">${e.direction === 'out' ? icon.out : icon.in}</span>
          <div class="main"><div class="t">${e.direction === 'out' ? 'You paid them' : 'They paid you'}</div><div class="s">${esc(e.note || 'Payment')}</div></div>
          <div class="end"><div class="amt ${e.direction === 'out' ? '' : 'amt-clear'}">${e.direction === 'out' ? '−' : '+'}${rs(e.amount)}</div>
            <button class="link-btn" style="font-size:13px;color:var(--ink-3)" data-del-pay="${e.id}">Undo</button></div></div>`);
    }

    const pending = p.ledger.filter((e) => e.type === 'share' && e.settled < e.amount);
    const reminder = `Hi ${p.name.split(' ')[0]}, a quick reminder: ${rs(p.balance)} is pending${pending.length ? ` for ${pending.map((e) => e.title).join(', ')}` : ''}. Thanks!`;

    $app.innerHTML = `
      <div class="top"><a class="back" href="#/people">${icon.back}People</a><button class="btn sm ghost" data-edit>Edit</button></div>
      <section class="profile">
        ${avatar(p.name, 'lg')}
        <h1>${esc(p.name)}</h1>
        ${status}
      </section>
      <div class="kv">
        <div><div class="k">You lent</div><div class="v">${rs(p.owed)}</div></div>
        <div><div class="k">You borrowed</div><div class="v">${rs(p.iOwe)}</div></div>
        <div><div class="k">Net</div><div class="v ${p.balance > 0 ? 'amt-pen' : p.balance < 0 ? 'amt-owe' : 'amt-clear'}">${p.balance < 0 ? '−' : ''}${rs(p.balance)}</div></div>
      </div>
      <div class="btn-row">
        <button class="btn pen" data-pay>${p.balance < 0 ? 'Pay back' : 'Record payment'}</button>
        ${p.balance > 0 ? '<button class="btn ghost" data-remind>Send reminder</button>' : ''}
      </div>
      <div class="section-head"><h2>History</h2></div>
      ${p.ledger.length ? rows : '<div class="empty-state"><p>No splits with this person yet.</p><a class="btn pen" href="#/splits/new">Create a split</a></div>'}
      <div style="margin-top:32px"><button class="btn danger block" data-delete>Delete ${esc(p.name)}</button></div>`;

    $app.querySelector('[data-pay]').addEventListener('click', () => paymentSheet(p.id, render));
    $app.querySelector('[data-edit]').addEventListener('click', () => personSheet(p, render));
    $app.querySelector('[data-remind]')?.addEventListener('click', () => {
      const phone = (p.phone || '').replace(/\D/g, '');
      const wa = `https://wa.me/${phone.length === 10 ? '91' + phone : phone}?text=${encodeURIComponent(reminder)}`;
      openSheet(`<h2>Send a reminder</h2><p class="sub">Copy it, or open WhatsApp with the message ready.</p>
        <div class="due-box" style="display:block;line-height:1.5">${esc(reminder)}</div>
        <div class="btn-row"><button class="btn ghost" data-copy>Copy</button><a class="btn pen" href="${wa}" target="_blank" rel="noopener">Open WhatsApp</a></div>`,
      (sheet) => sheet.querySelector('[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(reminder); toast('Copied'); } catch { toast('Select the text to copy it'); }
      }));
    });
    $app.querySelectorAll('[data-del-pay]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmSheet({ title: 'Undo this payment?', body: 'The balance goes back to what it was before it.', action: 'Undo payment' }))) return;
      await api('/payments/' + b.dataset.delPay, { method: 'DELETE' });
      toast('Payment removed'); render();
    }));
    $app.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!(await confirmSheet({ title: `Delete ${p.name}?`, body: 'Their shares, the splits they paid for, and payments with them are removed. This can’t be undone.', action: 'Delete' }))) return;
      await api('/people/' + p.id, { method: 'DELETE' });
      toast(`${p.name} deleted`); go('#/people');
    });
  };

  views.splits = async () => {
    const splits = await api('/splits');
    const open = splits.filter((s) => s.status !== 'settled');
    const done = splits.filter((s) => s.status === 'settled');
    const row = (s) => {
      const theirs = s.paidBy != null;
      return `
      <a class="row" href="#/splits/${s.id}">
        <span class="glyph ${theirs ? 'out' : ''}">${icon.receipt}</span>
        <div class="main">
          <div class="t">${esc(s.title)}</div>
          <div class="s">${fmtDate(s.date)}, ${theirs ? `paid by ${esc(s.paidByName)}` : `${s.people} ${s.people === 1 ? 'person' : 'people'}`}</div>
          ${s.due ? `<div class="bar"><i style="width:${Math.round(((s.due - s.pending) / s.due) * 100)}%"></i></div>` : ''}
        </div>
        <div class="end"><div class="amt">${rs(s.total)}</div>
          <div class="s">${s.status === 'settled' ? '<span class="pill settled">Settled</span>' : theirs ? `<span class="amt-owe">you owe ${rs(s.pending)}</span>` : `${rs(s.pending)} pending`}</div></div>
      </a>`;
    };
    $app.innerHTML = `
      <div class="top"><h1>Splits</h1><a class="btn sm pen" href="#/splits/new">New split</a></div>
      ${!splits.length ? '<div class="empty-state"><h3>No splits yet</h3><p>A split is any shared cost: a trip, a dinner, a cab. You can record ones you paid for and ones someone else paid for.</p><a class="btn pen" href="#/splits/new">Create a split</a></div>' : ''}
      ${open.length ? `<div class="section-head" style="margin-top:0"><h2>Not settled yet</h2></div><div class="list">${open.map(row).join('')}</div>` : ''}
      ${done.length ? `<div class="section-head"><h2>Settled</h2></div><div class="list">${done.map(row).join('')}</div>` : ''}`;
  };

  views.split = async (id) => {
    const s = await api('/splits/' + id);
    const pct = s.due ? Math.round(((s.due - s.pending) / s.due) * 100) : 100;
    const theirs = s.paidBy != null;
    const head = `
      <div class="top"><a class="back" href="#/splits">${icon.back}Splits</a><a class="btn sm ghost" href="#/splits/${s.id}/edit">Edit</a></div>
      <h1>${esc(s.title)}</h1>`;
    const del = `<div style="margin-top:28px"><button class="btn danger block" data-delete>Delete split</button></div>`;

    if (theirs) {
      $app.innerHTML = `${head}
        <p class="muted" style="margin:4px 0 20px">${fmtDate(s.date)}. ${esc(s.paidByName)} paid ${rs(s.total)}.</p>
        <div class="kv">
          <div><div class="k">Your share</div><div class="v amt-owe">${rs(s.myShare)}</div></div>
          <div><div class="k">Cleared</div><div class="v amt-clear">${rs(s.mySettled)}</div></div>
          <div><div class="k">You owe</div><div class="v">${rs(s.pending)}</div></div>
        </div>
        <div class="bar" style="height:6px;margin:0 0 6px"><i style="width:${pct}%"></i></div>
        <p class="faint" style="margin:0 0 20px">${s.status === 'settled' ? `Your share is paid back. This split is settled.` : `${pct}% of your share cleared`}</p>
        ${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}
        ${s.pending ? `<button class="btn pen block" data-pay="${s.paidBy}">Pay ${esc(s.paidByName.split(' ')[0])} back</button>` : ''}
        <p class="faint" style="margin-top:10px">Anything ${esc(s.paidByName.split(' ')[0])} owes you also counts toward clearing this.</p>
        ${del}`;
    } else {
      $app.innerHTML = `${head}
        <p class="muted" style="margin:4px 0 20px">${fmtDate(s.date)}. You paid ${rs(s.total)}${s.myShare ? `, your own share ${rs(s.myShare)}` : ''}.</p>
        <div class="kv">
          <div><div class="k">To collect</div><div class="v">${rs(s.due)}</div></div>
          <div><div class="k">Received</div><div class="v amt-clear">${rs(s.due - s.pending)}</div></div>
          <div><div class="k">Pending</div><div class="v ${s.pending ? 'amt-pen' : ''}">${rs(s.pending)}</div></div>
        </div>
        <div class="bar" style="height:6px;margin:0 0 6px"><i style="width:${pct}%"></i></div>
        <p class="faint" style="margin:0 0 4px">${s.status === 'settled' ? 'Everyone has paid. This split is settled.' : `${pct}% collected`}</p>
        ${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}
        <div class="section-head"><h2>Shares</h2><span class="faint">${s.method === 'equal' ? 'Split equally' : 'Exact amounts'}</span></div>
        <div class="list">${s.shares.map((x) => `
          <div class="row">
            ${avatar(x.name)}
            <a class="main" href="#/people/${x.personId}"><div class="t">${esc(x.name)}</div>
              <div class="s">${x.settled >= x.amount ? 'Paid' : x.settled ? `Paid ${rs(x.settled)}, ${rs(x.amount - x.settled)} left` : 'Not paid yet'}</div></a>
            <div class="end">
              ${x.settled >= x.amount ? `<span class="amt amt-clear">${rs(x.amount)}</span>` : `<button class="btn sm ghost" data-pay="${x.personId}">${rs(x.amount - x.settled)}</button>`}
            </div>
          </div>`).join('')}</div>
        <p class="faint" style="margin-top:10px">Tap an amount to record a payment. Payments clear each person’s oldest splits first.</p>
        ${del}`;
    }
    $app.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => paymentSheet(Number(b.dataset.pay), render)));
    $app.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!(await confirmSheet({ title: 'Delete this split?', body: 'The shares for it are removed. Payments already recorded stay with each person.', action: 'Delete split' }))) return;
      await api('/splits/' + s.id, { method: 'DELETE' });
      toast('Split deleted'); go('#/splits');
    });
  };

  // The split builder: who paid, what, who for, how.
  views.splitForm = async (id) => {
    let people = await api('/people');
    const existing = id ? await api('/splits/' + id) : null;
    const theirsBefore = existing && existing.paidBy != null;
    const st = {
      payer: theirsBefore ? 'them' : 'me',
      paidBy: theirsBefore ? existing.paidBy : null,
      method: existing?.method || 'equal',
      includeMe: existing ? existing.myShare > 0 : true,
      picked: new Set(existing && !theirsBefore ? existing.shares.map((x) => x.personId) : []),
      exact: new Map(existing && !theirsBefore ? existing.shares.map((x) => [x.personId, rupees(x.amount)]) : []),
      myExact: existing && existing.myShare ? rupees(existing.myShare) : '',
      heads: 2,
    };
    if (theirsBefore && existing.method === 'equal' && existing.myShare) st.heads = Math.max(1, Math.round(existing.total / existing.myShare));

    $app.innerHTML = `
      ${header(existing ? 'Edit split' : 'New split', existing ? '#/splits/' + id : '#/')}
      <form novalidate>
        <div class="seg" role="group" aria-label="Who paid">
          <button type="button" data-payer="me">I paid</button><button type="button" data-payer="them">Someone else paid</button>
        </div>
        <section class="step">
          <h2><span class="n">1</span><span data-q1></span></h2>
          <label class="field"><span>Name</span><input class="input" name="title" placeholder="Goa trip, Friday dinner…" maxlength="80" value="${esc(existing?.title)}"></label>
          <label class="field"><span data-total-label>Total</span><div class="money big"><input class="input" name="total" inputmode="decimal" placeholder="0" value="${existing ? rupees(existing.total) : ''}"></div></label>
          <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${existing?.date || today()}"></label>
        </section>
        <section class="step">
          <h2><span class="n">2</span><span data-q2></span></h2>
          <div class="chips" data-chips></div>
          <div class="quick-row" data-quick><button type="button" class="link-btn" data-all>Select everyone</button><span class="faint" data-count></span></div>
        </section>
        <section class="step">
          <h2><span class="n">3</span><span data-q3></span></h2>
          <div class="seg" role="group"><button type="button" data-m="equal">Equally</button><button type="button" data-m="exact">Exact amounts</button></div>
          <div data-shares></div>
          <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="140" value="${esc(existing?.note)}"></label>
        </section>
        <p class="err" data-err></p>
        <div class="sticky-save"><button class="btn pen block" type="submit" data-save>Save split</button></div>
      </form>`;

    const form = $app.querySelector('form');
    const $chips = form.querySelector('[data-chips]');
    const $shares = form.querySelector('[data-shares]');
    const $err = form.querySelector('[data-err]');
    const totalP = () => toPaise(form.total.value);
    const pickedPeople = () => people.filter((p) => st.picked.has(p.id));
    const payerName = () => people.find((p) => p.id === st.paidBy)?.name;
    const meAv = '<span class="av" style="background:var(--paper);color:var(--ink-2)" aria-hidden="true">Me</span>';

    // Equal split in paise; leftover paise go to the first few people so it adds up exactly.
    function equalShares() {
      const ppl = pickedPeople();
      const n = ppl.length + (st.includeMe ? 1 : 0);
      if (!n) return { me: 0, rows: [] };
      const base = Math.floor(totalP() / n);
      let extra = totalP() - base * n;
      const rows = ppl.map((p) => ({ p, amount: base + (extra-- > 0 ? 1 : 0) }));
      return { me: st.includeMe ? base + Math.max(extra, 0) : 0, rows };
    }
    // When someone else paid: your share.
    const theirModeShare = () => (st.method === 'equal' ? Math.ceil(totalP() / Math.max(st.heads, 1)) : toPaise(st.myExact));

    function drawHeadings() {
      const mine = st.payer === 'me';
      form.querySelectorAll('[data-payer]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.payer === st.payer));
      form.querySelector('[data-q1]').textContent = mine ? 'What did you pay for?' : 'What was it for?';
      form.querySelector('[data-total-label]').textContent = mine ? 'Total you paid' : 'Total they paid';
      form.querySelector('[data-q2]').textContent = mine ? 'Who was it for?' : 'Who paid?';
      form.querySelector('[data-q3]').textContent = mine ? 'How to split it?' : 'What’s your share?';
      form.querySelector('[data-quick]').hidden = !mine;
    }

    function drawChips() {
      const add = '<button type="button" class="chip add" data-new>+ New person</button>';
      if (st.payer === 'them') {
        $chips.innerHTML = people.map((p) => `<button type="button" class="chip" aria-pressed="${st.paidBy === p.id}" data-pid="${p.id}">${avatar(p.name)}${esc(p.name)}</button>`).join('') + add;
        return;
      }
      $chips.innerHTML =
        `<button type="button" class="chip me" aria-pressed="${st.includeMe}" data-me>${meAv}Me</button>` +
        people.map((p) => `<button type="button" class="chip" aria-pressed="${st.picked.has(p.id)}" data-pid="${p.id}">${avatar(p.name)}${esc(p.name)}</button>`).join('') + add;
      const n = st.picked.size;
      form.querySelector('[data-count]').textContent = n ? `${n} ${n === 1 ? 'person' : 'people'}${st.includeMe ? ' and you' : ''}` : '';
      form.querySelector('[data-all]').hidden = !people.length || st.picked.size === people.length;
    }

    function drawShares() {
      form.querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === st.method));
      if (st.payer === 'them') {
        if (!st.paidBy) { $shares.innerHTML = '<p class="faint" style="margin:0 0 16px">Pick who paid above.</p>'; return; }
        $shares.innerHTML = st.method === 'equal'
          ? `<div class="share-line"><span class="name">People sharing it, including you</span>
               <div class="stepper"><button type="button" data-step="-1" aria-label="Fewer">−</button><b data-heads>${st.heads}</b><button type="button" data-step="1" aria-label="More">+</button></div></div>
             <div class="remain"><span>You owe ${esc(payerName())}</span><b class="amt amt-owe" data-mine>${rs(theirModeShare())}</b></div>`
          : `<div class="share-line">${meAv}<span class="name">Your share</span>
               <div class="money"><input class="input" inputmode="decimal" placeholder="0" data-exme value="${esc(st.myExact)}" aria-label="Your share"></div></div>
             <div class="remain"><span>You owe ${esc(payerName())}</span><b class="amt amt-owe" data-mine>${rs(theirModeShare())}</b></div>
             <p class="faint" style="margin:-6px 0 14px">Borrowed money? Make your share the full amount.</p>`;
        return;
      }
      const ppl = pickedPeople();
      if (!ppl.length) { $shares.innerHTML = '<p class="faint" style="margin:0 0 16px">Pick at least one person above.</p>'; return; }
      if (st.method === 'equal') {
        const { me, rows } = equalShares();
        $shares.innerHTML = rows.map((r) => `<div class="share-line">${avatar(r.p.name)}<span class="name">${esc(r.p.name)}</span><span class="amt">${rs(r.amount)}</span></div>`).join('') +
          (st.includeMe ? `<div class="share-line">${meAv}<span class="name muted">Your share</span><span class="amt muted">${rs(me)}</span></div>` : '') +
          `<div class="remain"><span>You get back</span><b class="amt amt-pen">${rs(rows.reduce((a, r) => a + r.amount, 0))}</b></div>`;
      } else {
        $shares.innerHTML = ppl.map((p) => `<div class="share-line">${avatar(p.name)}<span class="name">${esc(p.name)}</span>
            <div class="money"><input class="input" inputmode="decimal" placeholder="0" data-ex="${p.id}" value="${esc(st.exact.get(p.id) || '')}" aria-label="${esc(p.name)}'s share"></div></div>`).join('') +
          (st.includeMe ? `<div class="share-line">${meAv}<span class="name muted">Your share</span>
            <div class="money"><input class="input" inputmode="decimal" placeholder="0" data-exme value="${esc(st.myExact)}" aria-label="Your share"></div></div>` : '') +
          '<div class="remain" data-remain></div>';
        updateRemain();
      }
    }

    const exactSum = () => pickedPeople().reduce((a, p) => a + toPaise(st.exact.get(p.id)), 0) + (st.includeMe ? toPaise(st.myExact) : 0);
    function updateRemain() {
      const mine = form.querySelector('[data-mine]');
      if (mine) mine.textContent = rs(theirModeShare());
      const el = form.querySelector('[data-remain]');
      if (!el) return;
      const left = totalP() - exactSum();
      el.className = 'remain ' + (left === 0 ? 'ok' : 'bad');
      el.innerHTML = left === 0 ? '<span>Adds up to the total</span><b>✓</b>'
        : left > 0 ? `<span>Still to assign</span><b>${rs(left)}</b>` : `<span>Over the total by</span><b>${rs(left)}</b>`;
    }
    const redraw = () => { drawHeadings(); drawChips(); drawShares(); };

    form.querySelectorAll('[data-payer]').forEach((b) => b.addEventListener('click', () => { st.payer = b.dataset.payer; $err.textContent = ''; redraw(); }));
    $chips.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.new !== undefined) {
        return personSheet(null, (p) => {
          people = [...people, p].sort((a, c) => a.name.localeCompare(c.name));
          if (st.payer === 'them') st.paidBy = p.id; else st.picked.add(p.id);
          redraw();
        });
      }
      if (b.dataset.me !== undefined) st.includeMe = !st.includeMe;
      else {
        const pid = Number(b.dataset.pid);
        if (st.payer === 'them') st.paidBy = pid;
        else st.picked.has(pid) ? st.picked.delete(pid) : st.picked.add(pid);
      }
      drawChips(); drawShares();
    });
    form.querySelector('[data-all]').addEventListener('click', () => { people.forEach((p) => st.picked.add(p.id)); drawChips(); drawShares(); });
    form.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      // Switching to exact: start from the equal amounts so there is less to type.
      if (b.dataset.m === 'exact' && st.method === 'equal' && totalP()) {
        if (st.payer === 'them') { if (!st.myExact) st.myExact = rupees(theirModeShare()); }
        else {
          const { me, rows } = equalShares();
          rows.forEach((r) => { if (!st.exact.get(r.p.id)) st.exact.set(r.p.id, rupees(r.amount)); });
          if (st.includeMe && !st.myExact) st.myExact = rupees(me);
        }
      }
      st.method = b.dataset.m; drawShares();
    }));
    form.total.addEventListener('input', () => { st.method === 'equal' && st.payer === 'me' ? drawShares() : updateRemain(); });
    $shares.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      st.heads = Math.min(50, Math.max(1, st.heads + Number(b.dataset.step)));
      form.querySelector('[data-heads]').textContent = st.heads;
      updateRemain();
    });
    $shares.addEventListener('input', (e) => {
      if (e.target.dataset.ex) st.exact.set(Number(e.target.dataset.ex), e.target.value);
      if (e.target.dataset.exme !== undefined) st.myExact = e.target.value;
      updateRemain();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $err.textContent = '';
      const title = form.title.value.trim();
      const total = totalP();
      if (!title) return ($err.textContent = 'Give the split a name.', form.title.focus());
      if (!total) return ($err.textContent = 'Enter the total.', form.total.focus());
      let body = { title, total: total / 100, date: form.date.value, note: form.note.value, method: st.method };

      if (st.payer === 'them') {
        if (!st.paidBy) return ($err.textContent = 'Pick who paid.');
        const mine = Math.min(theirModeShare(), total);
        if (!mine) return ($err.textContent = 'Enter your share.');
        body = { ...body, paidBy: st.paidBy, myShare: mine / 100, shares: [] };
      } else {
        const ppl = pickedPeople();
        if (!ppl.length) return ($err.textContent = 'Pick at least one person.');
        let shares, myShare;
        if (st.method === 'equal') {
          const eq = equalShares();
          shares = eq.rows.map((r) => ({ personId: r.p.id, amount: r.amount / 100 }));
          myShare = eq.me / 100;
        } else {
          if (exactSum() !== total) return ($err.textContent = 'The shares need to add up to the total.');
          shares = ppl.map((p) => ({ personId: p.id, amount: toPaise(st.exact.get(p.id)) / 100 }));
          if (shares.some((s) => s.amount <= 0)) return ($err.textContent = 'Each person needs an amount, or unselect them.');
          myShare = st.includeMe ? toPaise(st.myExact) / 100 : 0;
        }
        body = { ...body, paidBy: null, myShare, shares };
      }
      const btn = form.querySelector('[data-save]');
      btn.disabled = true;
      try {
        const r = await api(existing ? '/splits/' + id : '/splits', { method: existing ? 'PUT' : 'POST', body });
        toast(existing ? 'Split updated' : 'Split saved');
        go('#/splits/' + r.id);
      } catch (ex) { $err.textContent = ex.message; }
      finally { btn.disabled = false; }
    });

    redraw();
    if (!existing) form.title.focus();
  };

  views.settings = async () => {
    const me = await api('/me');
    $app.innerHTML = `
      <div class="top"><h1>Account</h1></div>
      <div class="list" style="margin-bottom:24px"><div class="row">${avatar(me.username)}<div class="main"><div class="t">${esc(me.username)}</div><div class="s">Signed in</div></div></div></div>
      <section class="step">
        <h2>Change password</h2>
        <form>
          <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
          <label class="field"><span>New password</span><input class="input" type="password" name="newPassword" minlength="4" autocomplete="new-password" required></label>
          <p class="err"></p>
          <button class="btn block" type="submit" style="margin-bottom:16px">Change password</button>
        </form>
      </section>
      <button class="btn danger block" data-logout>Sign out</button>`;
    bindForm($app.querySelector('form'), async (v) => {
      await api('/change-password', { method: 'POST', body: v });
      $app.querySelector('form').reset();
      toast('Password changed');
    });
    $app.querySelector('[data-logout]').addEventListener('click', async () => {
      await api('/logout', { method: 'POST' });
      go('#/login');
    });
  };

  // ---------- router ----------
  const routes = [
    [/^#\/login$/, 'login', true],
    [/^#\/forgot$/, 'forgot', true],
    [/^#\/?$/, 'home'],
    [/^#\/people$/, 'people'],
    [/^#\/people\/(\d+)$/, 'person'],
    [/^#\/splits$/, 'splits'],
    [/^#\/splits\/new$/, 'splitForm'],
    [/^#\/splits\/(\d+)\/edit$/, 'splitForm'],
    [/^#\/splits\/(\d+)$/, 'split'],
    [/^#\/settings$/, 'settings'],
  ];

  async function render() {
    $sheetRoot.innerHTML = '';
    const hash = location.hash || '#/';
    const match = routes.find(([re]) => re.test(hash));
    if (!match) return go('#/');
    const [re, name, isPublic] = match;
    const arg = hash.match(re)[1];
    $tabs.hidden = !!isPublic;
    const tab = { home: 'home', people: 'people', person: 'people', splits: 'splits', split: 'splits', settings: 'settings' }[name];
    $tabs.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    $app.innerHTML = '<div class="loading">Loading…</div>';
    window.scrollTo(0, 0);
    try { await views[name](arg); }
    catch (e) { if (e.message !== 'Signed out') $app.innerHTML = `<div class="empty-state" style="margin-top:40px"><h3>Couldn’t load this</h3><p>${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div>`; }
  }

  window.addEventListener('hashchange', render);
  render();
})();
