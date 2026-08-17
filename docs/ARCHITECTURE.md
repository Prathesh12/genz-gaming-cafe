# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ React (client islands)                                        │
│  station cards · dialogs · filters · charts                   │
│  live timer + live bill (same pricing engine as the server)   │
└───────────────▲──────────────────────────────┬───────────────┘
                │ props (serialisable DTOs)     │ Server Actions
┌───────────────┴──────────────────────────────▼───────────────┐
│ Next.js server                                                │
│  app/…/page.tsx      server components, read models            │
│  server/actions/…    validate (Zod) → authorise → call service │
│  server/services/…   business logic, one module per domain     │
│  server/pricing/…    pure pricing engine                       │
│  lib/…               auth, permissions, crypto, money, time    │
└───────────────────────────────┬──────────────────────────────┘
                                │ Drizzle
┌───────────────────────────────▼──────────────────────────────┐
│ PostgreSQL                                                    │
│  partial unique indexes · CHECK constraints · FKs · indexes    │
└──────────────────────────────────────────────────────────────┘
```

Every server action follows the same shape:

```ts
export async function doSomethingAction(prev, formData) {
  try {
    const user  = await requirePermission("some.permission"); // 1. authorise
    const input = parseOrThrow(someSchema, formDataToObject(formData)); // 2. validate
    await someService(input, user);                            // 3. business logic
    revalidatePath("/affected");                               // 4. refresh views
    return actionOk();
  } catch (error) {
    return actionError(error);                                 // 5. safe message
  }
}
```

`actionError` translates Postgres constraint violations into plain language ("This
station already has a live session — another device may have started it a moment ago"),
so the UI never shows a stack trace and never fails silently.

---

## Entity relationship diagram

```
users ──────────────┐
  │                 │ starts / ends / bills / audits
  ▼                 │
station_categories  │
  │ 1..n            │
  ▼                 │
stations ───────────┼──────────────┐
  │ 1..n            │              │ 1..n
  ▼                 │              ▼
game_sessions ──────┘        reservations
  │  │  │  │
  │  │  │  ├── session_extensions   (add-time log)
  │  │  │  └── session_players      (one row per seat; who paid what)
  │  │  └───── session_pauses       (pause windows)
  │  │
  │  └──────── food_orders ── food_order_items ──► food_items ──► food_categories
  │                                (price + name snapshots)
  │ 1..1
  ▼
transactions ── payments            (CASH / UPI rows; a split writes both)
  ▲
  │ snapshots: station name, category name, amounts, full pricing breakdown
  │
members ── memberships              (renewals append; history is never overwritten)
  │
  └── game_sessions.member_id / membership_id

station_categories ── pricing_rules (customer type × time band × kind × duration)

audit_logs        (append-only)
business_settings (single row: cafe, night window, timezone, day pass, membership, tax,
                   plus the uploaded logo, served by GET /api/logo)
```

### Key constraints

| Guarantee                                        | Where                                             |
| ------------------------------------------------ | ------------------------------------------------- |
| One live session per station                     | partial unique index on `game_sessions.station_id` |
| One open pause per session                       | partial unique index on `session_pauses`           |
| One seat per player, no member seated twice      | unique indexes on `session_players`                |
| Member pricing always names the member           | CHECK on `session_players`                         |
| A category seats between 1 and 12 players        | CHECK on `station_categories.max_players`          |
| One transaction per session                      | unique index on `transactions.session_id`          |
| `cash + upi = total`                             | CHECK on `transactions`                            |
| Positive payments, non-negative prices           | CHECK on `payments`, `pricing_rules`, `food_items` |
| Reservation ends after it starts                 | CHECK on `reservations`                            |
| Unique station code / member mobile / user email | unique indexes (case-insensitive where relevant)   |

---

## Main user flows

### Counter workflow

```
customer arrives
   └─► Stations → tap an available card → START SESSION
         ├─ optional: search member (member pricing applies automatically)
         └─ timer starts; station turns OCCUPIED
customer orders food
   └─► FOOD on the station card → pick items → ADD TO BILL
         └─ order attaches to the session; card total updates
customer finishes
   └─► END SESSION  (bill freezes)
         ├─ breakdown: gaming segments, food lines, tax, discount
         ├─ CASH / UPI / SPLIT (split must balance)
         └─ CONFIRM → transaction + payments written in one DB transaction
               ├─ session COMPLETED, station AVAILABLE
               └─ receipt opens, ready to print
```

### Membership

```
Members → New member (Aadhaar encrypted at rest)
       → Renew: appends a new membership row
                a renewal during an active term stacks on top of the existing end date
Dashboard warns about memberships expiring inside the configured window.
Session start resolves the membership once; if it expires mid-session the later
minutes are billed at regular rates.
```

### Pricing change

```
Pricing → pick a category → add/edit slabs per customer type and time band
        → deactivate a rule (never deleted) → past bills keep their stored breakdown
        → "Copy prices from…" clones a whole list to another category
```

---

## Real-time strategy

WebSockets are deliberately not used. The board polls with `router.refresh()` every 12
seconds (20 s on the dashboard), which re-runs the server components and streams only
the changed markup. On top of that:

- polling **pauses while a dialog is open**, so a checkout form is never re-rendered
  under a staff member's fingers;
- polling **pauses while the tab is hidden**, so a tablet left on overnight is idle;
- the **timer and the live bill tick locally** every second from the stored start
  timestamp, so the display is smooth between refreshes without extra requests.

This keeps the deployment to a single stateless Next.js app — no socket server, no
sticky sessions — which is what makes it cheap to host and easy to move.

---

## Folder conventions

| Path                    | Contains                                                   |
| ----------------------- | ---------------------------------------------------------- |
| `src/app/(app)/**`      | Authenticated console. Pages are server components.        |
| `src/app/(auth)/**`     | Sign-in.                                                   |
| `src/components/ui/**`  | Generic, reusable primitives. No business logic.            |
| `src/components/**`     | Feature components (station card, dialogs, charts, shell).  |
| `src/server/services`   | All business logic. Safe to call from actions and scripts.  |
| `src/server/actions`    | Thin server actions: validate → authorise → service.        |
| `src/server/pricing`    | The pure pricing engine.                                    |
| `src/lib`               | Cross-cutting helpers, all framework-agnostic where possible.|
| `src/db`                | Drizzle schema and pooled connection.                       |
