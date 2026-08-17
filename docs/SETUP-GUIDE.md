# Setup guide — start here

This guide assumes you have never run a web project before. Follow it top to bottom.
Every command is meant to be copied and pasted exactly.

Total time: about 30 minutes for step 1–6 (running on your own computer), and another
20 minutes for step 7 (putting it online).

---

## What you are installing

Three pieces have to exist for the app to work:

| Piece            | What it is                                        | Where it lives            |
| ---------------- | ------------------------------------------------- | ------------------------- |
| **Node.js**      | The engine that runs the app                       | Your computer / the server |
| **The database** | Where stations, sessions, bills and members are stored | PostgreSQL |
| **This project** | The app itself                                     | The folder you unzipped    |

The app cannot start without a database — that is the single most common thing people
get stuck on. Step 3 handles it.

---

## Step 1 — Install Node.js

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the left-hand button).
3. Run the installer, click Next until it finishes.
4. Open a terminal:
   - **Windows**: press the Windows key, type `powershell`, press Enter.
   - **Mac**: press Cmd+Space, type `terminal`, press Enter.
5. Type this and press Enter:

   ```bash
   node -v
   ```

   You should see something like `v22.11.0`. Any number **20.9 or higher** is fine.
   If you see "command not found", close the terminal, open it again, and retry.

---

## Step 2 — Open the project folder in the terminal

Unzip `genz-gaming-cafe.zip` somewhere you can find it, for example your Desktop.

In the terminal, move into that folder:

```bash
# Windows
cd $HOME\Desktop\genz-gaming-cafe

# Mac / Linux
cd ~/Desktop/genz-gaming-cafe
```

Check you are in the right place — this should list files including `package.json`:

```bash
ls
```

Now install the app's dependencies. This downloads the libraries the project needs and
takes 1–3 minutes:

```bash
npm install
```

---

## Step 3 — Get a database (free)

You do **not** need to install PostgreSQL on your computer. Use a free hosted one:

1. Go to **https://neon.tech** and sign up (GitHub or Google login is fastest).
2. Click **Create project**. Name it `genz-cafe`. Pick the region closest to you
   (for India: `AWS ap-south-1 — Mumbai`).

> Using **Supabase** instead? Sign up at https://supabase.com, create a project, save the
> database password it shows you, then click **Connect → Session pooler** and copy that
> URI. Replace `[YOUR-PASSWORD]` with your password and add `?sslmode=require` at the end.
> Use the *Session pooler* string — the direct connection needs IPv6, which most home
> connections do not have.
3. After it is created, Neon shows a **connection string**. Click the copy button.
   It looks like this:

   ```
   postgresql://neondb_owner:AbCd1234@ep-cool-name-12345-pooler.ap-south-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Keep that on your clipboard for the next step.

> Supabase (https://supabase.com) works exactly the same way — the connection string is
> under Project settings → Database → Connection string → URI.

---

## Step 4 — Create your settings file

The app reads its secrets from a file called `.env.local`. Create it by copying the
example:

```bash
# Windows
copy .env.example .env.local

# Mac / Linux
cp .env.example .env.local
```

Now you need two random secret keys. Generate them:

```bash
# Mac / Linux
openssl rand -hex 32
openssl rand -hex 32

# Windows (run each line separately)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Each command prints a long string of letters and numbers. You need two different ones.

Open `.env.local` in Notepad / TextEdit / VS Code and fill in three values:

```bash
DATABASE_URL="paste the Neon connection string here"
AUTH_SECRET="paste the first random string here"
ENCRYPTION_KEY="paste the second random string here"
```

Save the file. Make sure the file is named exactly `.env.local` — Notepad sometimes adds
a hidden `.txt` on the end. In File Explorer turn on **View → File name extensions** to
check; if it says `.env.local.txt`, rename it to `.env.local`.

> **Important:** `ENCRYPTION_KEY` is what protects members' Aadhaar numbers. Save a copy
> of it in a password manager. If you lose it, stored Aadhaar numbers can never be read
> again. Never send either key to anyone.

---

## Step 5 — Create the tables and starter data

Two commands. The first creates all the tables; the second fills in an admin account,
example stations, a price list and a food menu:

```bash
npm run db:migrate
npm run db:seed
```

The second command prints your login details at the end. Write them down:

```
admin@genzcafe.local  /  Admin@12345
```

---

## Step 6 — Run it

```bash
npm run dev
```

Leave that terminal window open — closing it stops the app.

Open your browser at **http://localhost:3000** and sign in with the admin details above.

You should see the dashboard. Click **Stations** and press **Start session** on PC-01 to
try it out.

To stop the app, click the terminal and press `Ctrl + C`.

### Using it from a phone or tablet on the same Wi-Fi

While `npm run dev` is running, find your computer's local address:

```bash
# Windows
ipconfig

# Mac
ipconfig getifaddr en0
```

Look for something like `192.168.1.7`, then on your phone open
`http://192.168.1.7:3000`. Both devices must be on the same Wi-Fi.

---

## Step 7 — Put it online (so it works from anywhere)

Running with `npm run dev` only works while your computer is on. To use it properly at
the counter, publish it:

1. **Create a GitHub account** at https://github.com and create a new *private*
   repository called `genz-gaming-cafe`.
2. In your project folder, run:

   ```bash
   git init
   git add .
   git commit -m "GENZ Gaming Cafe"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/genz-gaming-cafe.git
   git push -u origin main
   ```

3. **Create a Vercel account** at https://vercel.com (sign in with GitHub).
4. Click **Add New → Project**, pick your `genz-gaming-cafe` repository, click **Import**.
5. Before clicking Deploy, open **Environment Variables** and add the same three values
   from your `.env.local`: `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`.
6. Click **Deploy** and wait about two minutes.
7. Vercel gives you a web address like `https://genz-gaming-cafe.vercel.app` — that is
   your cafe's system. Open it on the counter PC, the tablet and every staff phone.

Because you already ran `db:migrate` and `db:seed` against the same Neon database in
step 5, there is nothing more to run. Sign in with the same admin account.

On a phone, open the site and use the browser menu → **Add to Home screen**. It then
opens like a normal app.

---

## Step 8 — Make it your cafe (do this before you start using it)

In this order:

1. **Settings** — cafe name, address, phone, GST number, timezone (`Asia/Kolkata`),
   night gaming hours, day pass length, membership price, receipt footer. Upload your
   **cafe logo** here too: click *Choose an image*, pick a PNG or JPG, and it saves
   immediately — it then appears in the sidebar, on the sign-in screen and at the top of
   every printed receipt. Nothing needs to be copied into any folder.
2. **Staff / Users** — create a real account for yourself, then change or disable the
   demo accounts (`admin@genzcafe.local`, `manager@…`, `staff@…`). **Do not leave the
   demo passwords in place.**
3. **Stations → Manage** — deactivate the demo stations, then add your real categories
   (Gaming PC, PS5, F1 Simulator…) and your real stations (PC-01, PC-02…), each with its
   own colour. On each category set **players per station**: leave it at 1 for a
   single-seat PC, or set 4 for PS5 multiplayer so the counter can add every player.
4. **Settings → How time is charged** — leave it on *By the minute* to charge for the
   time actually played (1h 15m on a ₹100/hr station = ₹125), or switch to *Duration
   deals* if you sell fixed packages instead.
5. **Pricing** — for each category, enter your real prices for every duration you sell,
   for regular and member customers, for normal and night hours. Use **Copy prices
   from…** when two categories charge the same.
6. **Food Menu** — your real categories and items with real prices. Each item also has an
   optional **member price**; fill it in only where members pay less, and leave it blank
   otherwise. When a station has a member on it, the whole food order is charged at member
   prices automatically.
7. **Members** — add your regulars. Already keep a list in Google Sheets? Use
   **Import from a sheet**: in Sheets choose *File → Download → Comma-separated values
   (.csv)*, then upload that file. It shows you what it found before importing anything,
   and never changes a member you already have.

Everything on the Stations screen comes from these settings. There is no code to edit.

---

## Daily use, in one picture

```
Customer walks in
   → Stations → START SESSION on a free machine  (search their name if they are a member)
   → on a multiplayer station, tap how many are playing and pick a member for each seat
     (leave a seat blank for a guest — they pay the regular rate)
Customer orders food
   → FOOD on that station → tap items → ADD TO BILL
Kitchen
   → Kitchen screen shows the order → Mark preparing → Mark ready → Mark served
Customer leaves
   → END SESSION → check the total → CASH / UPI / SPLIT → confirm
   → receipt appears → Print
   → the station turns green again automatically
End of day
   → Income shows exactly what you earned, split by cash, UPI, gaming and food
```

---

## If something goes wrong

| What you see                                     | What to do                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `DATABASE_URL is not set`                        | `.env.local` is missing, misnamed (`.env.local.txt`), or the line is empty. Redo step 4. |
| `relation "users" does not exist`, or login fails with "Something went wrong" | The tables were never created. Run `npm run db:migrate` then `npm run db:seed`. |
| Yellow `SECURITY WARNING: The SSL modes …` block  | Harmless notice from the Postgres driver. Ignore it.                        |
| `self-signed certificate in certificate chain`   | You are on an older copy of the project. Update `src/db/pool-config.ts`, or add `uselibpqcompat=true&` in front of `sslmode=require` in your URL. |
| `AUTH_SECRET is missing or too short`            | Paste a full 64-character random string into `.env.local`.                  |
| `ENCRYPTION_KEY must be exactly 64 hex characters` | Generate it again with the command in step 4.                              |
| Login says "Incorrect email or password"         | Run `npm run db:seed` — it prints the correct details.                     |
| `No pricing configured` on a station card        | Go to Pricing and add price slabs for that station's category.              |
| Times or "today" are wrong on reports            | Settings → Timezone must be `Asia/Kolkata` (or your zone).                  |
| `npm: command not found`                         | Node.js is not installed, or reopen the terminal after installing.          |
| Port 3000 is already in use                      | Run `npm run dev -- --port 3001` and use `http://localhost:3001`.           |

---

## Commands you will actually use

```bash
npm run dev        # run it on your computer while testing
npm run db:seed    # re-create the demo data (safe to re-run)
npm test           # check the billing rules still pass
npm run build      # check it is ready to publish
```

Once it is on Vercel you rarely touch the terminal. To change the app itself, edit the
code, then `git add . && git commit -m "change" && git push` — Vercel rebuilds and
publishes automatically within a couple of minutes.

---

## Where to read more

- `README.md` — what every feature does and how the project is organised.
- `docs/PRICING.md` — exactly how a bill is calculated, with worked examples.
- `docs/DEPLOYMENT.md` — the detailed production checklist and backups.
- `docs/ARCHITECTURE.md` — the database diagram and the code layout.
