# Settle

A personal ledger for shared money. You add the people, record who paid for
what, and record payments in either direction. Nobody else needs an account.

## Run it

You need Node.js 18 or newer (https://nodejs.org).

```bash
cd settle
npm install
npm start
```

Open http://localhost:3000. Tap **Create an account** to register, or sign in
with the built-in **admin / admin** account.

## Accounts

- Anyone can register with a username and password (at least 6 characters,
  with a letter and a number).
- Each account is a separate, private ledger. A new account starts empty, and
  nobody can see or change another account's people, splits or payments. The
  server checks the signed-in account on every read and write.

On first start the app creates its tables in a separate `settle` schema in your
database, plus the admin account. If you ran version 1, your data is kept and
upgraded automatically.

## Put it on your iPhone

Settle installs on the iPhone home screen and opens full-screen like any other
app. The phone just needs to reach the server.

**Option A: same Wi-Fi (quickest, for trying it out)**
1. Run `npm start` on your laptop. It prints a line like
   `On your phone: http://192.168.1.5:3000`.
2. On the iPhone, open that address in **Safari**.
3. Tap **Share**, then **Add to Home Screen**, then **Add**.

This only works while the laptop is on and on the same Wi-Fi.

**Option B: host it online (works anywhere, free)**
1. Put this folder in a GitHub repository (the `.gitignore` keeps `.env` out).
2. On https://render.com, choose **New > Blueprint** and pick the repository.
   It reads `render.yaml`.
3. When asked, set `DATABASE_URL` to your Supabase connection string. Use the
   **Session pooler** string from Supabase > Connect.
4. Open the `https://…onrender.com` address in Safari on the iPhone, then
   **Share > Add to Home Screen**.

Render's free plan sleeps after 15 minutes without use, so the first open after
a break takes about 30 seconds.

## Database

The connection string is in `.env`, already set to your Supabase project.

If you see "Could not connect to the database" with `ENOTFOUND` or `ENETUNREACH`:
Supabase's direct address works only on IPv6 networks. In Supabase, click
**Connect**, copy the **Session pooler** connection string, put your password in
it, and paste it into `.env` as `DATABASE_URL`.

## How it works

**When you paid** (New split > I paid): pick the people, include yourself if you
were part of it, and split equally or by exact amounts. Each person owes you
their share.

**When someone else paid** (New split > Someone else paid): pick who paid, then
set your share, either as an equal part of N people or an exact amount. You owe
them your share. For money you borrowed, make your share the full amount.

**Payments**: Record payment > *They paid me* or *I paid them*. Part payments
are fine: ₹500 due and ₹450 paid leaves ₹50.

**Balances are netted per person.** If Chirag owes you ₹4,600 and you owe him
₹800, his page shows he owes you ₹3,800. Home lists who owes you and who you
owe separately.

Settled amounts clear the oldest splits first, so every split shows as open,
partly paid or settled. **Send reminder** on a person's page opens WhatsApp with
the pending amount.

## Known limits

- "Forgot password" resets the password for any username that exists, as asked
  for version 1. Anyone who knows a username can use it to get into that
  account, so treat it as a trusted-friends app until it is replaced.
- Change the admin password straight away under Account, or don't use admin.
- Passwords are stored hashed, not as plain text.
