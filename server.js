require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { pool, init } = require('./db');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const q = (text, params) => pool.query(text, params);
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong' });
  });
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });

// ---------- helpers ----------

// Amounts travel as rupees (e.g. 450.5) and are stored as paise (45050).
function toPaise(v, field = 'Amount') {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw fail(400, `${field} must be more than 0`);
  return Math.round(n * 100);
}
const today = () => new Date().toISOString().slice(0, 10);
function cleanDate(d) {
  if (!d) return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw fail(400, 'Invalid date');
  return d;
}
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 4) throw fail(400, 'Password must be at least 4 characters');
}

/**
 * Builds everything the app shows from raw rows.
 *
 * For each person:
 *   owed   = their shares in splits you paid        (they owe you)
 *   iOwe   = your share in splits they paid         (you owe them)
 *   paid   = payments they made to you
 *   iPaid  = payments you made to them
 *   balance = owed - iOwe - paid + iPaid   (> 0 they owe you, < 0 you owe them)
 *
 * What one side owes cancels out what the other owes, then payments settle the
 * rest. Settled amounts are applied to the oldest splits first, so each split
 * can show open, partly paid or settled.
 */
async function loadBook(userId) {
  const [people, splits, shares, payments] = await Promise.all([
    q('select id, name, phone, note, created_at from settle.people where user_id=$1 order by lower(name)', [userId]),
    q(`select id, title, total_paise, my_share_paise, method, paid_by, to_char(spent_on,'YYYY-MM-DD') spent_on, note, created_at
       from settle.splits where user_id=$1 order by spent_on desc, id desc`, [userId]),
    q(`select sh.id, sh.split_id, sh.person_id, sh.amount_paise
       from settle.shares sh join settle.splits s on s.id = sh.split_id
       where s.user_id=$1`, [userId]),
    q(`select id, person_id, amount_paise, direction, to_char(paid_on,'YYYY-MM-DD') paid_on, note, created_at
       from settle.payments where user_id=$1 order by paid_on, id`, [userId]),
  ]);

  const splitById = new Map(splits.rows.map((s) => [s.id, {
    ...s, total_paise: +s.total_paise, my_share_paise: +s.my_share_paise, shares: [], my_settled_paise: 0,
  }]));
  const personById = new Map(people.rows.map((p) => [p.id, {
    ...p, owed: 0, iOwe: 0, paid: 0, iPaid: 0, shares: [], theirSplits: [], payments: [],
  }]));

  for (const sh of shares.rows) {
    const s = { ...sh, amount_paise: +sh.amount_paise, settled_paise: 0 };
    splitById.get(s.split_id)?.shares.push(s);
    const p = personById.get(s.person_id);
    if (p) { p.owed += s.amount_paise; p.shares.push(s); }
  }
  for (const s of splitById.values()) {
    if (s.paid_by == null) continue;
    const p = personById.get(s.paid_by);
    if (p) { p.iOwe += s.my_share_paise; p.theirSplits.push(s); }
  }
  for (const pm of payments.rows) {
    const p = personById.get(pm.person_id);
    if (!p) continue;
    const row = { ...pm, amount_paise: +pm.amount_paise };
    if (row.direction === 'out') p.iPaid += row.amount_paise; else p.paid += row.amount_paise;
    p.payments.push(row);
  }

  const bySplitDate = (getSplit) => (a, b) => {
    const sa = getSplit(a), sb = getSplit(b);
    return sa.spent_on.localeCompare(sb.spent_on) || sa.id - sb.id;
  };
  const clamp = (v, max) => Math.max(0, Math.min(v, max));

  for (const p of personById.values()) {
    // Their debts to you get cleared by what they paid plus what you owe them.
    let credit = clamp(p.paid + p.iOwe - p.iPaid, p.owed);
    p.shares.sort(bySplitDate((x) => splitById.get(x.split_id)));
    for (const s of p.shares) { s.settled_paise = Math.min(credit, s.amount_paise); credit -= s.settled_paise; }

    // Your debts to them get cleared by what you paid plus what they owe you.
    let mine = clamp(p.iPaid + p.owed - p.paid, p.iOwe);
    p.theirSplits.sort(bySplitDate((x) => x));
    for (const s of p.theirSplits) { s.my_settled_paise = Math.min(mine, s.my_share_paise); mine -= s.my_settled_paise; }

    p.balance = p.owed - p.iOwe - p.paid + p.iPaid;
  }

  for (const s of splitById.values()) {
    let due, settled;
    if (s.paid_by == null) {
      due = s.shares.reduce((a, x) => a + x.amount_paise, 0);
      settled = s.shares.reduce((a, x) => a + x.settled_paise, 0);
    } else {
      due = s.my_share_paise;
      settled = s.my_settled_paise;
    }
    s.due_paise = due;
    s.pending_paise = due - settled;
    s.status = due === 0 || settled >= due ? 'settled' : settled > 0 ? 'partial' : 'open';
    s.paid_by_name = s.paid_by == null ? null : personById.get(s.paid_by)?.name || null;
  }

  return { people: personById, splits: splitById };
}

function personSummary(p) {
  return {
    id: p.id, name: p.name, phone: p.phone, note: p.note,
    owed: p.owed, iOwe: p.iOwe, paid: p.paid, iPaid: p.iPaid, balance: p.balance,
  };
}

async function ownPerson(userId, personId) {
  const r = await q('select id from settle.people where id=$1 and user_id=$2', [personId, userId]);
  if (!r.rowCount) throw fail(404, 'Person not found');
}

// ---------- auth ----------

async function auth(req, res, next) {
  try {
    const token = req.cookies.settle_session;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const r = await q(
      'select u.id, u.username from settle.sessions s join settle.users u on u.id=s.user_id where s.token=$1',
      [token]
    );
    if (!r.rowCount) return res.status(401).json({ error: 'Not signed in' });
    req.user = r.rows[0];
    next();
  } catch (e) { next(e); }
}

app.post('/api/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const r = await q('select * from settle.users where username=$1', [username]);
  const ok = r.rowCount && (await bcrypt.compare(String(req.body.password || ''), r.rows[0].password_hash));
  if (!ok) throw fail(401, 'Wrong username or password');
  const token = crypto.randomBytes(32).toString('hex');
  await q('insert into settle.sessions (token, user_id) values ($1,$2)', [token, r.rows[0].id]);
  res.cookie('settle_session', token, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 });
  res.json({ username: r.rows[0].username });
}));

app.post('/api/logout', wrap(async (req, res) => {
  if (req.cookies.settle_session) await q('delete from settle.sessions where token=$1', [req.cookies.settle_session]);
  res.clearCookie('settle_session');
  res.json({ ok: true });
}));

// Version 1 behaviour, as requested: anyone who knows a username can set its password.
app.post('/api/forgot-password', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  checkPassword(req.body.newPassword);
  const hash = await bcrypt.hash(req.body.newPassword, 10);
  const r = await q('update settle.users set password_hash=$1 where username=$2 returning id', [hash, username]);
  if (!r.rowCount) throw fail(404, 'No account with that username');
  await q('delete from settle.sessions where user_id=$1', [r.rows[0].id]);
  res.json({ ok: true });
}));

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.post('/api/change-password', auth, wrap(async (req, res) => {
  const r = await q('select password_hash from settle.users where id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.current || ''), r.rows[0].password_hash))) throw fail(400, 'Current password is wrong');
  checkPassword(req.body.newPassword);
  await q('update settle.users set password_hash=$1 where id=$2', [await bcrypt.hash(req.body.newPassword, 10), req.user.id]);
  res.json({ ok: true });
}));

// ---------- dashboard ----------

app.get('/api/summary', auth, wrap(async (req, res) => {
  const book = await loadBook(req.user.id);
  const people = [...book.people.values()];
  const splits = [...book.splits.values()];
  const outstanding = people.reduce((a, p) => a + Math.max(p.balance, 0), 0);
  const youOwe = people.reduce((a, p) => a + Math.max(-p.balance, 0), 0);
  const collected = people.reduce((a, p) => a + p.paid, 0);
  const lent = people.reduce((a, p) => a + p.owed, 0);
  const borrowed = people.reduce((a, p) => a + p.iOwe, 0);

  const activity = [];
  for (const s of splits) activity.push({
    type: 'split', id: s.id, title: s.title, amount: s.paid_by == null ? s.due_paise : s.my_share_paise,
    paidBy: s.paid_by_name, date: s.spent_on, at: s.created_at, people: s.shares.length,
  });
  for (const p of people) for (const pm of p.payments) activity.push({
    type: 'payment', id: pm.id, personId: p.id, title: p.name, direction: pm.direction,
    amount: pm.amount_paise, date: pm.paid_on, at: pm.created_at,
  });
  activity.sort((a, b) => b.date.localeCompare(a.date) || new Date(b.at) - new Date(a.at));

  res.json({
    outstanding, youOwe, collected, lent, borrowed,
    openSplits: splits.filter((s) => s.status !== 'settled').length,
    pendingPeople: people.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance).map(personSummary),
    owePeople: people.filter((p) => p.balance < 0).sort((a, b) => a.balance - b.balance).map(personSummary),
    activity: activity.slice(0, 8),
  });
}));

// ---------- people ----------

app.get('/api/people', auth, wrap(async (req, res) => {
  const book = await loadBook(req.user.id);
  res.json([...book.people.values()].map(personSummary));
}));

app.post('/api/people', auth, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw fail(400, 'Name is required');
  const r = await q(
    'insert into settle.people (user_id, name, phone, note) values ($1,$2,$3,$4) returning id, name, phone, note',
    [req.user.id, name, req.body.phone?.trim() || null, req.body.note?.trim() || null]
  );
  res.json({ ...r.rows[0], owed: 0, iOwe: 0, paid: 0, iPaid: 0, balance: 0 });
}));

app.put('/api/people/:id', auth, wrap(async (req, res) => {
  await ownPerson(req.user.id, req.params.id);
  const name = String(req.body.name || '').trim();
  if (!name) throw fail(400, 'Name is required');
  await q('update settle.people set name=$1, phone=$2, note=$3 where id=$4', [name, req.body.phone?.trim() || null, req.body.note?.trim() || null, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/people/:id', auth, wrap(async (req, res) => {
  await ownPerson(req.user.id, req.params.id);
  // Take their share out of each split's total so the split still adds up.
  await q(`update settle.splits s set total_paise = s.total_paise - sh.amount_paise
           from settle.shares sh where sh.split_id = s.id and sh.person_id = $1`, [req.params.id]);
  await q('delete from settle.people where id=$1', [req.params.id]);
  // Remove splits left with nobody in them and no personal share.
  await q(`delete from settle.splits s where s.user_id=$1 and s.my_share_paise=0
           and not exists (select 1 from settle.shares sh where sh.split_id=s.id)`, [req.user.id]);
  res.json({ ok: true });
}));

app.get('/api/people/:id', auth, wrap(async (req, res) => {
  const book = await loadBook(req.user.id);
  const p = book.people.get(Number(req.params.id));
  if (!p) throw fail(404, 'Person not found');
  const ledger = [
    ...p.shares.map((s) => {
      const sp = book.splits.get(s.split_id);
      return { type: 'share', splitId: sp.id, title: sp.title, date: sp.spent_on, amount: s.amount_paise, settled: s.settled_paise, at: sp.created_at };
    }),
    ...p.theirSplits.map((sp) => ({
      type: 'owe', splitId: sp.id, title: sp.title, date: sp.spent_on, amount: sp.my_share_paise,
      settled: sp.my_settled_paise, total: sp.total_paise, at: sp.created_at,
    })),
    ...p.payments.map((pm) => ({
      type: 'payment', id: pm.id, direction: pm.direction, note: pm.note,
      date: pm.paid_on, amount: pm.amount_paise, at: pm.created_at,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || new Date(b.at) - new Date(a.at));
  res.json({ ...personSummary(p), ledger });
}));

// ---------- splits ----------

app.get('/api/splits', auth, wrap(async (req, res) => {
  const book = await loadBook(req.user.id);
  res.json([...book.splits.values()].map((s) => ({
    id: s.id, title: s.title, total: s.total_paise, date: s.spent_on, people: s.shares.length,
    due: s.due_paise, pending: s.pending_paise, status: s.status,
    paidBy: s.paid_by, paidByName: s.paid_by_name, myShare: s.my_share_paise,
  })));
}));

app.get('/api/splits/:id', auth, wrap(async (req, res) => {
  const book = await loadBook(req.user.id);
  const s = book.splits.get(Number(req.params.id));
  if (!s) throw fail(404, 'Split not found');
  res.json({
    id: s.id, title: s.title, total: s.total_paise, myShare: s.my_share_paise, method: s.method,
    date: s.spent_on, note: s.note, due: s.due_paise, pending: s.pending_paise, status: s.status,
    paidBy: s.paid_by, paidByName: s.paid_by_name, mySettled: s.my_settled_paise,
    shares: s.shares.map((x) => ({ personId: x.person_id, name: book.people.get(x.person_id)?.name, amount: x.amount_paise, settled: x.settled_paise }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

// Body: { title, total, date, note, method, myShare, paidBy, shares: [{ personId, amount }] }
// Amounts in rupees.
//   paidBy empty: you paid. The shares plus your own share must add up to the total.
//   paidBy = person id: they paid. You owe them myShare; no other shares are kept.
async function saveSplit(req, splitId) {
  const b = req.body;
  const title = String(b.title || '').trim();
  if (!title) throw fail(400, 'Give the split a name');
  const total = toPaise(b.total, 'Total');
  const myShare = b.myShare ? Math.round(Number(b.myShare) * 100) : 0;
  if (!Number.isFinite(myShare) || myShare < 0) throw fail(400, 'Your share is invalid');
  const paidBy = b.paidBy ? Number(b.paidBy) : null;

  if (paidBy) {
    if (myShare <= 0) throw fail(400, 'Enter your share of what they paid');
    if (myShare > total) throw fail(400, 'Your share can’t be more than the total');
    await ownPerson(req.user.id, paidBy);
    const vals = [title, total, myShare, b.method === 'exact' ? 'exact' : 'equal', cleanDate(b.date), b.note?.trim() || null, paidBy];
    if (splitId) {
      const r = await q(`update settle.splits set title=$1,total_paise=$2,my_share_paise=$3,method=$4,spent_on=$5,note=$6,paid_by=$7
                         where id=$8 and user_id=$9`, [...vals, splitId, req.user.id]);
      if (!r.rowCount) throw fail(404, 'Split not found');
      await q('delete from settle.shares where split_id=$1', [splitId]);
      return splitId;
    }
    const r = await q(`insert into settle.splits (title,total_paise,my_share_paise,method,spent_on,note,paid_by,user_id)
                       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [...vals, req.user.id]);
    return r.rows[0].id;
  }

  const shares = Array.isArray(b.shares) ? b.shares : [];
  if (!shares.length) throw fail(400, 'Pick at least one person');
  const rows = shares.map((s) => ({ personId: Number(s.personId), amount: toPaise(s.amount, 'Each share') }));
  if (new Set(rows.map((r) => r.personId)).size !== rows.length) throw fail(400, 'A person is listed twice');
  const sum = rows.reduce((a, r) => a + r.amount, 0) + myShare;
  if (sum !== total) throw fail(400, `Shares add up to ₹${(sum / 100).toFixed(2)}, but the total is ₹${(total / 100).toFixed(2)}`);
  const owned = await q('select count(*)::int n from settle.people where user_id=$1 and id = any($2::int[])', [req.user.id, rows.map((r) => r.personId)]);
  if (owned.rows[0].n !== rows.length) throw fail(400, 'Unknown person in split');

  const client = await pool.connect();
  try {
    await client.query('begin');
    let id = splitId;
    const vals = [title, total, myShare, b.method === 'exact' ? 'exact' : 'equal', cleanDate(b.date), b.note?.trim() || null];
    if (id) {
      const r = await client.query(
        `update settle.splits set title=$1,total_paise=$2,my_share_paise=$3,method=$4,spent_on=$5,note=$6,paid_by=null where id=$7 and user_id=$8`,
        [...vals, id, req.user.id]
      );
      if (!r.rowCount) throw fail(404, 'Split not found');
      await client.query('delete from settle.shares where split_id=$1', [id]);
    } else {
      const r = await client.query(
        `insert into settle.splits (title,total_paise,my_share_paise,method,spent_on,note,user_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [...vals, req.user.id]
      );
      id = r.rows[0].id;
    }
    for (const r of rows) {
      await client.query('insert into settle.shares (split_id, person_id, amount_paise) values ($1,$2,$3)', [id, r.personId, r.amount]);
    }
    await client.query('commit');
    return id;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

app.post('/api/splits', auth, wrap(async (req, res) => res.json({ id: await saveSplit(req) })));
app.put('/api/splits/:id', auth, wrap(async (req, res) => res.json({ id: await saveSplit(req, Number(req.params.id)) })));
app.delete('/api/splits/:id', auth, wrap(async (req, res) => {
  const r = await q('delete from settle.splits where id=$1 and user_id=$2', [req.params.id, req.user.id]);
  if (!r.rowCount) throw fail(404, 'Split not found');
  res.json({ ok: true });
}));

// ---------- payments ----------

app.post('/api/payments', auth, wrap(async (req, res) => {
  await ownPerson(req.user.id, req.body.personId);
  const r = await q(
    'insert into settle.payments (user_id, person_id, amount_paise, paid_on, note, direction) values ($1,$2,$3,$4,$5,$6) returning id',
    [req.user.id, req.body.personId, toPaise(req.body.amount), cleanDate(req.body.date), req.body.note?.trim() || null,
     req.body.direction === 'out' ? 'out' : 'in']
  );
  res.json({ id: r.rows[0].id });
}));

app.delete('/api/payments/:id', auth, wrap(async (req, res) => {
  const r = await q('delete from settle.payments where id=$1 and user_id=$2', [req.params.id, req.user.id]);
  if (!r.rowCount) throw fail(404, 'Payment not found');
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong' }); });

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => {
    // Show the Wi-Fi address too, so a phone on the same network can open it.
    const lan = Object.values(require('os').networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
    console.log(`\nSettle is running`);
    console.log(`  On this computer:  http://localhost:${PORT}`);
    lan.forEach((u) => console.log(`  On your phone:     ${u}   (same Wi-Fi)`));
    console.log(`\nSign in with admin / admin\n`);
  }))
  .catch((err) => {
    console.error('\nCould not connect to the database:', err.message);
    if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH/.test(err.code || err.message)) {
      console.error('Tip: Supabase\'s direct host only works over IPv6. In Supabase, click "Connect",');
      console.error('copy the "Session pooler" connection string, and put it in .env as DATABASE_URL.\n');
    }
    process.exit(1);
  });
