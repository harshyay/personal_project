// Database connection and schema setup.
// All tables live in their own schema "settle", so they never mix with other
// projects in the same database (and are not exposed by Supabase's public API).
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\nDATABASE_URL is missing. Copy .env.example to .env and fill it in.\n');
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const pool = new Pool({
  connectionString: url,
  ssl: isLocal || process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  max: 5,
});

const SCHEMA = `
create schema if not exists settle;

create table if not exists settle.users (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists settle.sessions (
  token text primary key,
  user_id int not null references settle.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists settle.people (
  id serial primary key,
  user_id int not null references settle.users(id) on delete cascade,
  name text not null,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

-- One row per expense you paid for ("Goa trip", "Dinner").
create table if not exists settle.splits (
  id serial primary key,
  user_id int not null references settle.users(id) on delete cascade,
  title text not null,
  total_paise bigint not null check (total_paise >= 0),
  my_share_paise bigint not null default 0 check (my_share_paise >= 0),
  method text not null default 'equal' check (method in ('equal', 'exact')),
  spent_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

-- What each person owes you for a split.
create table if not exists settle.shares (
  id serial primary key,
  split_id int not null references settle.splits(id) on delete cascade,
  person_id int not null references settle.people(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  unique (split_id, person_id)
);

-- Money a person paid back to you.
create table if not exists settle.payments (
  id serial primary key,
  user_id int not null references settle.users(id) on delete cascade,
  person_id int not null references settle.people(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  paid_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

-- Version 2: money flows both ways.
-- splits.paid_by: null = you paid; a person = they paid and you owe your share.
alter table settle.splits add column if not exists paid_by int references settle.people(id) on delete cascade;
-- payments.direction: 'in' = they paid you, 'out' = you paid them.
alter table settle.payments add column if not exists direction text not null default 'in';
do $$ begin
  alter table settle.payments add constraint payments_direction_chk check (direction in ('in','out'));
exception when duplicate_object then null; end $$;

create index if not exists people_user_idx on settle.people(user_id);
create index if not exists splits_user_idx on settle.splits(user_id);
create index if not exists shares_person_idx on settle.shares(person_id);
create index if not exists payments_person_idx on settle.payments(person_id);
`;

async function init() {
  await pool.query(SCHEMA);
  // Pre-made account: admin / admin
  const hash = await bcrypt.hash('admin', 10);
  await pool.query(
    `insert into settle.users (username, password_hash) values ('admin', $1)
     on conflict (username) do nothing`,
    [hash]
  );
}

module.exports = { pool, init };
