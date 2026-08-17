# The pricing engine

Everything about how a session becomes an amount. The implementation lives in
`src/server/pricing/engine.ts` and is a pure module — no database, no clock, no
framework — so every rule below is covered by `tests/pricing.test.ts`.

---

## How time is charged

Settings → Billing & time → **How time is charged** picks between two rules. It
applies to every station category at once.

**By the minute (default).** The hourly price is divided by sixty and the
customer pays for the minutes they actually played, rounded to the nearest
rupee. An hour and a quarter on a ₹100/hr station is ₹125; an hour and one
minute is ₹102. Nobody is ever charged for a second hour they did not use. The
hourly price is whatever one hour costs under the durations configured in
Pricing — the same number shown on the station card — so the board and the bill
always agree.

**Duration deals (slab).** The cheapest combination of the configured durations
that covers the time played. Use this when the cafe sells packages (a 1-hour
deal, a 2-hour deal) rather than selling time. It necessarily rounds up: 61
minutes with only 1-hour and 2-hour slabs costs two hours.

Everything else below — pauses, night bands, membership expiry, day passes,
per-player charging — works the same way in both modes.

## Inputs

| Input                   | Where it comes from                                        |
| ----------------------- | ---------------------------------------------------------- |
| `startedAt`, `endedAt`  | `game_sessions` timestamps (never a counter)                 |
| `pauses`                | `session_pauses` rows                                        |
| `rules`                 | Active `pricing_rules` for the station's category            |
| `customerType`          | Fixed when the session starts (member only if valid then)    |
| `membershipValidUntil`  | End date of the membership used for the session              |
| `config`                | Night window, timezone, day pass, minimum billable minutes   |

## The five steps

### 1. Remove paused time

```
|————————— session ——————————|
      |—— paused ——|
[ billable ]        [ billable ]
```

Paused windows are subtracted and overlapping pauses are merged. A pause that is still
open counts up to "now", so a paused station stops accruing charges immediately.

### 2. Cut at every rate boundary

Two things can change the rate mid-session:

- crossing into or out of **night gaming** (evaluated in the cafe's timezone, so a
  band like `23:00 → 06:00` wraps midnight correctly), and
- a **membership expiring** during play.

Each billable interval is split at those instants.

### 3. Group

Segments are grouped by `(time band, customer type)` and their durations summed. Seconds
round **up** to the next whole minute, once per group.

### 4. Price each group with a minimum-cost cover

Given the admin's slabs for that group, the engine finds the **cheapest combination that
covers the time played**. It is the classic unbounded coin-change problem solved over
one-minute granularity, and it has three useful properties:

- A short session rounds up to the smallest slab (5 minutes → the 30-minute price).
- The customer is never charged more than the next slab up: with `30min = ₹60` and
  `1hr = ₹100`, fifty minutes costs **₹100**, not ₹120.
- Durations beyond the largest slab are covered by combining slabs, so you never have to
  configure a price for every possible length. With `2hr = ₹180` and `30min = ₹60`,
  2 h 10 m costs **₹240**.

If a group has no slabs configured, the engine falls back — member → regular, night →
normal — and records a note on the bill rather than blocking checkout.

### 5. Consider the day pass

If a day pass exists for the category, day passes are enabled, and the billable time
fits inside the pass validity, the engine charges the pass **whenever it is cheaper**
than the slab total. Staff can also force a day pass explicitly.

Finally, sessions shorter than `minimumBillMinutes` are not charged at all — the
setting exists so a mistaken start costs nothing.

---

## Worked examples

Using the seeded Gaming PC price list
(`30m ₹60 · 1h ₹100 · 2h ₹180 · 3h ₹250 · … · day pass ₹700`, night `1h ₹150 · 2h ₹260`,
night window `23:00 → 06:00`).

All the worked examples below are in **duration deals** mode. By the minute,
the same sessions cost `hourly price ÷ 60 × minutes played`, rounded to the
rupee — for example B's two hours would be 30 min at ₹100/hr plus 90 min at
₹150/hr = ₹275.

**A. Ordinary evening session — 19:00 → 21:00**

```
NORMAL 120 min → 2h slab            ₹180
TOTAL                               ₹180
```

**B. Crossing into night — 22:30 → 00:30**

```
NORMAL  30 min → 30m slab            ₹60
NIGHT   90 min → 2h night slab      ₹260   (cheaper than 1h + 1h = ₹300)
TOTAL                               ₹320
```

**C. Crossing out of night — 05:00 → 07:00**

```
NIGHT   60 min → 1h night slab      ₹150
NORMAL  60 min → 1h slab            ₹100
TOTAL                               ₹250
```

**D. Membership expires mid-session — member, 12:00 → 14:00, membership ends 13:00**

```
MEMBER  60 min → member 1h           ₹80
REGULAR 60 min → regular 1h         ₹100
TOTAL                               ₹180      note: "Membership expired during the session"
```

**E. With a pause — 10:00 → 13:00, paused 11:00 → 12:00**

```
Wall clock            3h
Paused                1h   (not charged)
Billable            120m → 2h slab   ₹180
```

**F. All-day session — 10:00 → 20:00**

```
Slab combination would exceed the pass; day pass applied   ₹700
```

**G. 1 h 1 m 1 s**

```
Rounded up to 62 min → 1h (₹100) + 30m (₹60)   ₹160   (cheaper than the 2h slab at ₹180)
```

**H. Four people on one PS5 — 15:00 → 16:00, three of them members**

Using the seeded PS5 Multiplayer price list (`regular 1h ₹180 · member 1h ₹150`).

```
MEMBER  60 min x 3 players → member 1h x 3   ₹450
REGULAR 60 min x 1 player  → regular 1h      ₹180
TOTAL                                        ₹630
```

---

## Several players on one station

A station category has a **players per station** setting (Stations → Manage →
edit a category). Leave it at 1 for a single-seat PC. Set it to 4 for PS5
multiplayer and the counter can record who is playing.

The rule is simply *each player pays their own rate*:

- Everyone played the same minutes — one clock, one start, one stop.
- Each player is priced over those minutes on their own terms: an active member
  gets member rates, everyone else gets regular rates. A membership that lapsed
  is not an error; that person just pays regular rates.
- The bill is the sum.

Everything else behaves exactly as it does for one person, *per player*: night
bands are split the same way, pauses are excluded once from the shared clock, a
membership expiring mid-session only affects that player, and the day pass is
compared against each player's own slab total.

Each player's own share is stored on the session, so a member who plays as the
third controller still gets the visit and the spend recorded against their
account — their share, not the whole table's bill. Shared costs (food, tax and
any discount) are divided equally between the players, and rounding leftovers
are handed out a paisa at a time so the shares always add up to the bill exactly.

With one player none of this changes anything: the roster has a single entry and
the arithmetic is identical to what it always was.

---

## Food

Every menu item has an ordinary price and, optionally, a **member price**. Blank means
members pay the ordinary price for that item.

A food order is charged at member prices when **anyone on that station holds a valid
membership** — the cafe's rule, so a mixed table of members and guests is never an
argument at the counter. An item with no member price is unaffected either way.

The decision is made on the server, inside the order transaction, by reading the
session's own player list. The price landed on is then snapshotted onto the order line,
so editing the menu tomorrow never rewrites an order taken today.

## Food, tax, discounts and the total

```
gaming            (from the engine, above)
+ food            Σ quantity × unit price   (prices snapshotted when ordered)
+ tax             Σ per-item tax            (only when tax is enabled in Settings)
= subtotal
− discount        percentage or flat, capped at the subtotal and at the user's limit
= TOTAL
```

Payment must balance exactly:

- **Cash** → the whole total.
- **UPI** → the whole total.
- **Split** → both parts greater than zero and `cash + upi = total`. Enforced in the
  service *and* by a database CHECK constraint.

---

## Why bills stay correct forever

- The transaction stores `gaming_amount`, `food_amount`, `tax_amount`, `discount_amount`,
  `total_amount`, the billed and wall-clock minutes, **and** the engine's full breakdown
  as JSON.
- Item names and unit prices are snapshotted onto the order lines.
- Station and category names are snapshotted onto the transaction.
- Pricing rules are deactivated, never deleted.

Change tomorrow's prices as often as you like: yesterday's receipt still reprints
exactly as it was issued.

---

## Concurrency

- Starting a session locks the station row (`SELECT … FOR UPDATE`), so two staff devices
  tapping START at the same instant are serialised; the second gets a clear message.
- A partial unique index (`WHERE status IN ('ACTIVE','PAUSED')`) is the database-level
  backstop, and is covered by a test.
- Checkout runs as a single transaction: recalculate → write transaction → write
  payments → close session → free the station. A failure anywhere rolls all of it back,
  so a station can never be freed without a recorded sale.
- `transactions.session_id` is unique, so a double-clicked checkout cannot bill twice.
- Opening the checkout screen freezes the bill (`endedAt` is pinned) so the totals cannot
  drift while cash is counted; backing out puts the session back on the clock.
