# Deployment

Target: **GitHub → Vercel → Neon PostgreSQL**. Both providers have free tiers that
comfortably run a single cafe; the paid tiers start around $20/month each if you outgrow
them. No object storage, queue or extra service is required.

---

## 1. Create the database

**Neon** (recommended — generous free tier, instant branching, point-in-time restore)

1. Sign up at neon.tech and create a project, region closest to the cafe
   (e.g. `ap-south-1` Mumbai for India).
2. Copy the **pooled** connection string — it looks like
   `postgresql://user:pass@ep-xxx-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require`.
3. Also copy the **direct** (non-pooled) string; migrations prefer it.

**Supabase** works identically: Project settings → Database → Connection string (URI).

---

## 2. Push the code

```bash
git init
git add .
git commit -m "GENZ Gaming Cafe"
git branch -M main
git remote add origin https://github.com/<you>/genz-gaming-cafe.git
git push -u origin main
```

`.env*` files are git-ignored — check with `git status` before you push that no secret
is staged.

---

## 3. Configure environment variables

Generate the secrets:

```bash
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

In Vercel → Project → Settings → Environment Variables, add for **Production** and
**Preview**:

| Name              | Value                                        |
| ----------------- | -------------------------------------------- |
| `DATABASE_URL`    | the pooled Neon/Supabase string               |
| `DIRECT_URL`      | the direct string (optional, for migrations)  |
| `AUTH_SECRET`     | first generated secret                        |
| `ENCRYPTION_KEY`  | second generated secret                       |

Store both secrets in a password manager. Losing `ENCRYPTION_KEY` makes stored Aadhaar
numbers permanently unreadable.

---

## 4. Deploy

Import the repository in Vercel. Framework preset **Next.js**; build command and output
directory are detected automatically. Deploy.

The first deploy will build successfully but the app will error on the database until
step 5 runs.

---

## 5. Run migrations against production

From your machine, pointing at the production database:

```bash
DATABASE_URL="postgresql://…prod…" npm run db:migrate
```

`db:migrate` is idempotent: it applies only the migrations that have not run yet, and
records them in `__drizzle_migrations`.

---

## 6. Create the first admin

```bash
DATABASE_URL="postgresql://…prod…" \
SEED_ADMIN_EMAIL="owner@yourcafe.com" \
SEED_ADMIN_PASSWORD="<a strong password>" \
npm run db:seed
```

This also creates the demo categories, stations, price list and menu so the cafe has a
working starting point. Everything it creates is labelled `DEMO`.

**Do not pass `--history` in production** — that flag generates fake sales.

If you would rather start completely empty, create only the admin and delete the demo
rows afterwards from Stations → Manage and Food Menu (deactivate), or run the seed
against a fresh database and remove what you do not need.

---

## 7. First-run checklist

Sign in as the admin and work through:

1. **Settings** — cafe name, address, phone, GST, timezone (`Asia/Kolkata`), night
   gaming window, day pass validity, membership length and price, invoice prefix,
   receipt footer. Enable tax only if you charge it.
2. **Stations → Manage** — delete/deactivate the demo stations, create your real
   categories and stations with their codes and colours.
3. **Pricing** — set your real slabs for each category (regular and member, normal and
   night) and your day pass. Use "Copy prices from…" for identical categories.
4. **Food Menu** — your real categories and items.
5. **Staff / Users** — create accounts for each staff member, set roles and discount
   limits, then change the demo passwords or deactivate the demo accounts.
6. **Members** — add existing members, or add them as they arrive.

---

## 8. Verify production

- Sign in on a phone, add the app to the home screen (it is a PWA).
- Start a session on a real station, add a food item, end the session, take a cash
  payment, print the receipt.
- Check that the sale appears on Dashboard and Income immediately.
- Sign in as a staff-role account and confirm Settings and Staff are not reachable.
- Try to start the same station from two devices at once and confirm the second is
  rejected.

---

## 9. Backups

- **Neon**: point-in-time restore is on by default; check the retention window in the
  project settings and raise it if your plan allows.
- **Supabase**: enable daily backups (Project settings → Database → Backups).
- Weekly, export Transactions to CSV from Reports and keep a copy off-site.
- Never point a development machine at the production `DATABASE_URL`. Keep separate
  `.env.local` (development) and Vercel environment variables (production);
  `npm run db:reset` refuses to run with `NODE_ENV=production`.

---

## 10. Costs

| Item                | Free tier                     | Paid from            |
| ------------------- | ----------------------------- | -------------------- |
| Vercel (hosting)    | Hobby: fine for a single cafe | ~$20/month (Pro)     |
| Neon (PostgreSQL)   | 0.5 GB storage                | ~$19/month           |
| Domain (optional)   | —                             | ~₹800/year           |

A cafe with 25 stations generates on the order of a few thousand rows a month; storage
is not the constraint for years.

---

## Moving to a VPS later

The app is a standard Next.js server plus PostgreSQL, so:

```bash
npm ci
npm run build
DATABASE_URL=... AUTH_SECRET=... ENCRYPTION_KEY=... npm run start -- --port 3000
```

behind nginx or Caddy, with `pm2`/systemd for restarts and `pg_dump` on a cron for
backups. Nothing in the code is Vercel-specific.

---

## Troubleshooting

| Symptom                                        | Cause / fix                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| "DATABASE_URL is not set"                      | Environment variable missing on the deployment; redeploy after adding it.    |
| "AUTH_SECRET is missing or too short"          | Must be at least 32 characters (`openssl rand -hex 32`).                     |
| "ENCRYPTION_KEY must be exactly 64 hex chars"  | Regenerate with `openssl rand -hex 32`.                                      |
| Sign-in loops back to the login page           | Cookies blocked, or the site is served over plain HTTP in production.        |
| "relation does not exist"                      | Migrations have not been run against that database.                          |
| Times or "today" look wrong in reports          | Settings → timezone must be a valid IANA name, e.g. `Asia/Kolkata`.          |
| "No pricing configured" on a station card       | Add slabs for that station's category in Pricing.                            |
