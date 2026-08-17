# GENZ GAMING CAFE — management & point of sale

A complete, production-ready system for running a gaming cafe: stations, live sessions,
configurable pricing, food orders, cash/UPI/split payments, receipts, memberships,
income and reports — designed to be operated from a counter PC, a tablet or a phone.

Nothing operational is hard-coded. Station categories, stations, price slabs, night
pricing, day passes, the food menu, membership rules, tax and receipt details are all
configured from inside the app.

---

> **New to running a web project?** Read [`docs/SETUP-GUIDE.md`](docs/SETUP-GUIDE.md)
> instead of this file — it walks through installing Node, getting a free database and
> publishing the app, one copy-paste command at a time.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Testing](#testing)
- [How the billing works](#how-the-billing-works)
- [Roles and permissions](#roles-and-permissions)
- [Security notes](#security-notes)
- [Deployment](#deployment)
- [Backups and data safety](#backups-and-data-safety)
- [Project structure](#project-structure)

---

## Features

**Counter operations**

- Station board with search, status filters (all / available / occupied / reserved /
  maintenance) and dynamic category filters.
- Start a session in two taps; optional customer name, mobile, member lookup and
  planned duration.
- Several players on one station: pick how many are playing and search a member for each
  seat. Each player is charged their own rate — members pay member prices, guests and
  lapsed memberships pay regular prices — and every player's own share is recorded
  against their account. The roster can be corrected while the session is running.
- Live timer derived from the stored start timestamp — it survives refreshes, other
  devices and browser restarts.
- Live running bill (gaming + food) computed in the browser by the *same* pricing
  engine the server uses at checkout.
- Pause / resume (paused time is never charged), add time, cancel a mistaken session.
- Food ordering from inside a station card; orders attach to the session and appear on
  the bill immediately. Order status: ordered → preparing → ready → served, plus cancel.
- Kitchen queue screen: every unserved order, oldest first, with the wait time and a
  one-tap advance button. Meant to be left open on a screen in the kitchen.
- Checkout freezes the bill, shows a full breakdown, supports discounts (with per-user
  limits), and takes Cash, UPI or a validated Cash+UPI split.
- Printable, thermal-friendly (80 mm) receipt.

**Management**

- Member prices on food as well as gaming: each menu item can carry a member price, and
  a station with a member on it is charged those prices automatically. The price is
  resolved on the server from the session's own roster and snapshotted onto the order
  line, so it cannot be moved by the browser or by a later menu edit.
- Import an existing membership list from a spreadsheet. Upload the CSV a cafe already
  keeps in Google Sheets or Excel; columns are matched by the names people actually use
  ("WhatsApp No.", "Valid Till", "Aadhar Number"), the day/month order is worked out from
  the whole column rather than guessed per row, and a preview shows exactly what will
  happen before anything is written. Existing members are never touched, a row missing an
  optional detail still imports, and each membership is dated from the sheet's own dates.
- Cafe logo uploaded from Settings and stored in the database — the deployment target
  has a read-only filesystem, so a file written at runtime would not survive. Whatever is
  picked is redrawn to a 512px PNG in the browser before it is sent, which normalises the
  size and strips anything the original file was carrying.
- Station categories and stations with custom colours, codes, sort order and soft delete.
  Each category sets how many people can share one station, which is what turns the
  player picker on for PS5 multiplayer and leaves single-seat PCs untouched.
- Pricing per category × customer type (regular/member) × time band (normal/night),
  any durations you like, plus optional day passes. Copy a price list between categories.
- Members with membership terms, renewal history, expiry tracking and encrypted Aadhaar.
- Food categories and items, availability toggles, per-item tax and prep time.
- Reservations with conflict detection.
- Staff accounts with roles, discount limits and sensitive-data permission.
- Business settings: cafe details, night window, timezone, day pass, membership rules,
  tax, invoice prefix, receipt footer.
- Append-only audit log of every significant action.

**Money**

- Dashboard: today's revenue, gaming vs food, cash vs UPI, split count, active sessions,
  station status board, revenue-by-hour chart, membership expiry warnings.
- Income: totals, station-wise, category-wise, payment-wise (split halves counted once,
  never double), member vs regular, membership fees kept separate from gaming revenue.
- Transactions: search, filters, pagination, detail/receipt view, and voiding a bill
  (with a required reason) for corrections — the row is kept, income excludes it.
- Reports: daily revenue, peak hours, station performance, food sales, membership sales,
  CSV export for every one of them.

---

## Tech stack

| Layer      | Choice                                                             |
| ---------- | ------------------------------------------------------------------ |
| Framework  | Next.js 16 (App Router, Server Components, Server Actions)          |
| Language   | TypeScript, strict mode                                            |
| UI         | Tailwind CSS v4, Radix UI primitives, lucide-react, Recharts, Sonner |
| Database   | PostgreSQL                                                          |
| ORM        | Drizzle ORM + drizzle-kit migrations                                 |
| Auth       | Signed HTTP-only session cookies (jose) + bcrypt password hashing    |
| Validation | Zod (server-side on every mutation)                                  |
| Testing    | Vitest (unit + database guarantees), Playwright (end-to-end)          |

> **Why Drizzle rather than Prisma?** Drizzle is pure TypeScript with no native engine
> binary to download or ship. That means faster cold starts on Vercel, no
> platform-specific build steps, and migrations that are plain, readable SQL you can
> review before they touch your data. The schema lives in `src/db/schema.ts` and reads
> much like a Prisma schema.

---

## Architecture

```
Browser (staff)
   │  Server Actions (typed, validated, permission-checked)
   ▼
Next.js server  ──►  services/         business logic, one module per domain
                     pricing/engine.ts pure pricing engine (no I/O, fully tested)
                     lib/              auth, permissions, crypto, money, time, errors
   │  Drizzle
   ▼
PostgreSQL      partial unique indexes + CHECK constraints as the last line of defence
```

Rules the codebase follows:

1. **No business logic in React components.** Components render; services decide.
2. **The pricing engine is pure.** It takes timestamps, pauses, rules and settings and
   returns an amount plus an explanation. That makes every billing edge case testable
   without a database (`tests/pricing.test.ts`).
3. **Server actions never trust the client.** Every amount is recalculated server-side
   at checkout; the browser's total is only used to detect that the bill moved.
4. **History is immutable.** Transactions store snapshots of station names, category
   names, item names, unit prices and the full pricing breakdown, so changing a price
   tomorrow never rewrites yesterday's receipt.
5. **Soft delete everywhere.** Stations, categories and menu items are deactivated, not
   deleted, so historical rows always resolve.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the entity relationship diagram
and the main user flows.

---

## Getting started

Requirements: **Node.js 20.9+** and a **PostgreSQL 14+** database (local, Neon or Supabase).

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env.local
#    then fill in DATABASE_URL, AUTH_SECRET and ENCRYPTION_KEY
#    generate the two secrets with:  openssl rand -hex 32

# 3. Create the tables
npm run db:migrate

# 4. Seed accounts, stations, prices, menu and demo members
npm run db:seed
#    add demo sales history for the dashboards:
#    npm run db:seed -- --history

# 5. Run
npm run dev        # http://localhost:3000
```

The seed prints the sign-in details. By default:

| Role    | Email                    | Password        |
| ------- | ------------------------ | --------------- |
| Admin   | admin@genzcafe.local     | `Admin@12345`   |
| Manager | manager@genzcafe.local   | `Manager@12345` |
| Staff   | staff@genzcafe.local     | `Staff@12345`   |

**Change these before the cafe opens.** Settings → Staff / Users.

Everything the seed creates is labelled `DEMO`, so it is easy to find and remove.

---

## Environment variables

| Variable              | Required | Purpose                                                               |
| --------------------- | -------- | --------------------------------------------------------------------- |
| `DATABASE_URL`        | yes      | PostgreSQL connection string.                                          |
| `DIRECT_URL`          | no       | Non-pooled URL used by migrations on Neon.                             |
| `AUTH_SECRET`         | yes      | Signs session cookies. 32+ bytes (`openssl rand -hex 32`).             |
| `ENCRYPTION_KEY`      | yes      | 64 hex chars. AES-256-GCM key for Aadhaar + the HMAC blind index.      |
| `SEED_ADMIN_EMAIL`    | no       | First admin account created by the seed.                               |
| `SEED_ADMIN_PASSWORD` | no       | Its password.                                                          |
| `DB_POOL_MAX`         | no       | Connection pool size per instance (default 5).                         |

> Changing `ENCRYPTION_KEY` makes existing encrypted Aadhaar values unreadable. Treat it
> like a database password: set it once, back it up, never commit it.

---

## Database

```bash
npm run db:generate    # create a migration after editing src/db/schema.ts
npm run db:migrate     # apply pending migrations
npm run db:seed        # configuration + demo catalogue
npm run db:studio      # browse data in Drizzle Studio
npm run db:reset -- --force   # DEV ONLY: drop everything and re-migrate
```

Migrations are plain SQL in `drizzle/`. Beyond the tables, `0001_*` adds the guarantees
that must hold even if application code is wrong:

- one live session per station (partial unique index),
- one open pause per session,
- `cash_amount + upi_amount = total_amount` on every transaction,
- non-negative payments, prices and quantities,
- reservations must end after they start.

---

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint (Next 16 + React Compiler rules)
npm test            # Vitest: pricing engine, billing maths, timezones, DB guarantees
npm run build       # production build
npm run test:e2e    # Playwright: sign in → start → food → checkout → receipt
```

`npm test` covers, among others:

- slab pricing and minimum-cost cover,
- member vs regular pricing,
- night pricing and sessions that cross the boundary in either direction,
- sessions that cross midnight,
- membership expiring mid-session,
- paused time excluded from billing,
- day pass selection,
- rounding of partial minutes,
- discount ceilings, split payment validation, food totals,
- timezone maths including a DST-observing zone,
- and, against a real database, that two staff members cannot start the same station.

End-to-end tests run against a production build on both a desktop and a phone viewport.

---

## How the billing works

Full detail — with worked examples — is in [`docs/PRICING.md`](docs/PRICING.md). In short:

0. **How time is charged** is a setting. By the minute (the default) divides the
   hourly price by sixty and charges for the minutes actually played — 1h15m on a
   ₹100/hr station is ₹125, and a session never jumps to a second hour it did not
   use. Duration deals charges the cheapest cover from the configured slabs, which
   rounds up to whole packages. Steps 2–5 below apply in both modes.
1. Paused windows are cut out of the session, so paused time is never charged.
2. What remains is split at every boundary that can change the rate: the night-gaming
   start/end times (in the cafe's timezone) and the moment a membership expires.
3. Each resulting group is priced with the admin's duration slabs using a
   **minimum-cost cover** — the cheapest combination of slabs that covers the time
   played. 50 minutes with `30min = ₹60` and `1hr = ₹100` costs ₹100, not ₹120.
   Durations longer than the biggest slab are covered by combining slabs.
4. If a day pass is configured and the session fits inside its validity, it is applied
   whenever it is cheaper.
5. When several people share a station, steps 1–4 run once per player — at that
   player's own member or regular rate — and the results are added. Four players with
   three memberships on a ₹180/hr station (member ₹150/hr) come to ₹630 for the hour.
6. Food is added at snapshotted prices, tax is applied if enabled, the discount comes
   off the subtotal, and the payment must balance exactly.

The result — every segment, every slab, every note — is stored as JSON on the
transaction, so any bill can be explained months later.

---

## Roles and permissions

| Capability                     | Admin | Manager | Staff |
| ------------------------------ | :---: | :-----: | :---: |
| Dashboard, stations, sessions  |  ✅   |   ✅    |  ✅   |
| Food orders, take payment      |  ✅   |   ✅    |  ✅   |
| Transactions list              |  ✅   |   ✅    |  ✅   |
| Reservations                   |  ✅   |   ✅    |  ✅   |
| Manage stations & pricing      |  ✅   |   ✅    |  ❌   |
| Manage members & menu          |  ✅   |   ✅    |  ❌   |
| Income, reports, audit log     |  ✅   |   ✅    |  ❌   |
| Discounts                      |  ✅   |  up to their limit  | only if granted |
| Staff accounts, settings       |  ✅   |   ❌    |  ❌   |
| Reveal full Aadhaar            | ✅ (if granted) | ❌ | ❌ |

Roles set the baseline; per-user switches add discount rights (with a maximum
percentage) and sensitive-data access. Every server action re-checks permissions — the
navigation only hides what a user cannot reach.

---

## Security notes

- Passwords are hashed with bcrypt (cost 12). Sign-in is rate limited and both
  successes and failures are audited.
- Sessions are signed JWTs in `httpOnly`, `sameSite=lax`, `secure` (in production)
  cookies, valid for 12 hours. The user row is re-read on every request, so
  deactivating an account takes effect immediately.
- **Aadhaar**: encrypted with AES-256-GCM; only the last four digits are stored in
  clear for display (`XXXX XXXX 1234`); a keyed HMAC blind index detects duplicates
  without storing the plaintext. It never appears in a URL, a log, an export, browser
  storage, or a default API response. Revealing it requires an admin with explicit
  sensitive-data permission and writes an audit entry every time.
- All input is validated with Zod on the server, regardless of client-side checks.
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`) are set in `src/proxy.ts`.
- The database is only reachable from server code; no credentials reach the browser.

---

## Deployment

Full step-by-step instructions: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The short version — GitHub → Vercel → Neon, comfortably inside the free tiers to start:

1. Create a PostgreSQL database (Neon or Supabase) and copy its connection string.
2. Push this repository to GitHub and import it in Vercel.
3. Set `DATABASE_URL`, `AUTH_SECRET` and `ENCRYPTION_KEY` in Vercel's environment
   variables (Production **and** Preview).
4. Run `npm run db:migrate` once against the production database.
5. Run `npm run db:seed` once to create the first admin, then sign in and change the
   password.
6. Enable automated backups (point-in-time restore on Neon, daily backups on Supabase).

The app is a single Next.js deployment — no microservices, no queue, no object storage.
Moving to a VPS later is a `docker`/`pm2` change, not a rewrite.

---

## Backups and data safety

- Use **separate databases** for development and production. `npm run db:reset` refuses
  to run when `NODE_ENV=production`.
- Turn on your provider's automated backups; both Neon and Supabase offer
  point-in-time restore.
- Export the day's transactions to CSV from Reports for an off-site copy.
- The audit log is append-only; nothing in the UI deletes financial history. Corrections
  are made by voiding a transaction, which keeps the original row.

---

## Project structure

```
drizzle/                 SQL migrations (reviewable, versioned)
e2e/                     Playwright end-to-end tests
scripts/                 migrate / seed / reset
src/
  app/
    (auth)/login/        sign-in
    (app)/               the console: dashboard, stations, pricing, members, food,
                         income, transactions, reports, reservations, staff, settings
    api/export/          CSV exports
  components/
    ui/                  button, card, dialog, field, table, badge, states, …
    stations/            station card, start-session, food, checkout dialogs
    charts/              revenue charts
    nav/                 app shell, sidebar, mobile nav
  db/                    Drizzle schema + connection
  hooks/                 live clock, polling, debounce
  lib/                   auth, permissions, crypto, money, time, schemas, errors, audit
  server/
    pricing/engine.ts    the pricing engine (pure)
    services/            business logic per domain
    actions/             server actions (validate → permission → service → revalidate)
tests/                   Vitest suites
```

---

## Licence

Private project for GENZ Gaming Cafe.
