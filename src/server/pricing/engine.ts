/**
 * GENZ GAMING CAFE — pricing engine
 * ---------------------------------
 * A pure, dependency-free module. It never touches the database, which makes
 * it trivially unit-testable (see tests/pricing.test.ts) and reusable from
 * server actions, live estimates and checkout alike.
 *
 * HOW A SESSION IS PRICED
 *
 * 1. The wall-clock interval [startedAt, endedAt] is reduced to *billable
 *    intervals* by cutting out every pause segment. Paused time is never
 *    charged.
 *
 * 2. Each billable interval is split at every boundary that can change the
 *    applicable rate:
 *      - the night-gaming start / end times (in the cafe's timezone),
 *      - the moment a customer's membership expires.
 *    A session therefore priced across 22:30 -> 00:30 with a night band
 *    starting at 23:00 produces one NORMAL segment of 30 minutes and one
 *    NIGHT segment of 90 minutes.
 *
 * 3. Segments are grouped by (timeBand, customerType) and each group's total
 *    duration is priced according to the cafe's chosen billing mode.
 *
 * 4a. PER_MINUTE (the default): the hourly price is divided by sixty and the
 *    customer pays for the minutes they actually played, rounded to the
 *    nearest rupee. An hour and a quarter on a ₹100/hr station costs ₹125.
 *    Nobody is ever charged for a second hour they did not use.
 *
 * 4b. SLAB: the engine finds the cheapest combination of the admin's duration
 *    slabs that covers the played duration. For a 50 minute session with
 *    30min=₹60 and 1hr=₹100 slabs it charges ₹100 (the 1hr slab), not ₹120
 *    (two 30min slabs) — the cheapest configured way to cover the time, with
 *    durations beyond the biggest slab covered by combining slabs. Use this
 *    when the cafe sells fixed-duration deals rather than time.
 *
 * 5. If a day pass is configured, enabled, and the total billable time fits
 *    within its validity, the engine charges the day pass whenever it is
 *    cheaper than the slab total.
 *
 * Because the result is stored as a snapshot on the transaction, changing a
 * pricing rule tomorrow never alters yesterday's bill.
 */

export type PricingTimeBand = "NORMAL" | "NIGHT";
export type PricingCustomerType = "REGULAR" | "MEMBER";
export type PricingRuleKind = "SLAB" | "DAY_PASS";

export type EnginePricingRule = {
  id: string;
  customerType: PricingCustomerType;
  timeBand: PricingTimeBand;
  kind: PricingRuleKind;
  durationMinutes: number;
  /** Player count selected by a ROOM rule. Legacy rules default to one. */
  playerCount?: number;
  /** Minor units (paise). */
  price: number;
};

export type PauseInterval = {
  pausedAt: Date;
  /** `null` means the session is paused right now. */
  resumedAt: Date | null;
};

export type BillingMode = "PER_MINUTE" | "SLAB";

export type PricingConfig = {
  timezone: string;
  /** Minutes since local midnight, e.g. 23:00 -> 1380. */
  nightStartMinute: number;
  nightEndMinute: number;
  dayPassEnabled: boolean;
  dayPassMinutes: number;
  /** Sessions shorter than this are not charged at all. */
  minimumBillMinutes: number;
  /**
   * How played time becomes money. PER_MINUTE charges the hourly price pro
   * rata; SLAB charges the cheapest cover from the configured durations.
   * Absent means PER_MINUTE, so a caller that predates the setting bills the
   * way the cafe expects rather than rounding time up.
   */
  billingMode?: BillingMode;
};

export type PriceSessionInput = {
  startedAt: Date;
  endedAt: Date;
  pauses?: PauseInterval[];
  rules: EnginePricingRule[];
  config: PricingConfig;
  /** Customer type the session was started with. */
  customerType: PricingCustomerType;
  /**
   * When the customer is a member, the instant their membership stops being
   * valid. Time after it is priced at REGULAR rates.
   */
  membershipValidUntil?: Date | null;
  /** Force the day pass even when slab pricing would be cheaper. */
  forceDayPass?: boolean;
};

export type PricedSlab = {
  durationMinutes: number;
  price: number;
  count: number;
};

export type PricedSegment = {
  timeBand: PricingTimeBand;
  customerType: PricingCustomerType;
  minutes: number;
  amount: number;
  slabs: PricedSlab[];
  /**
   * The per-hour price this line was worked out from, in minor units. Set only
   * when charging by the minute, so a receipt can say "1h 15m at ₹100/hr".
   */
  hourlyRate?: number;
  /**
   * How many players this line covers. Absent (or 1) for an ordinary
   * single-player session; 3 on a merged line reading "Member x 3".
   */
  players?: number;
};

export type PriceSessionResult = {
  /** Total gaming charge in minor units. */
  amount: number;
  /** Wall-clock minutes from start to end (rounded up). */
  wallMinutes: number;
  /** Minutes actually charged (wall clock minus paused time, rounded up). */
  billedMinutes: number;
  pausedMinutes: number;
  segments: PricedSegment[];
  dayPassApplied: boolean;
  dayPassPrice: number | null;
  /** Human-readable explanations shown on the checkout screen and stored. */
  notes: string[];
};

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export type RoomPricingSnapshot = {
  pricingModel: "ROOM";
  playerCount: number;
  rules: EnginePricingRule[];
};

export type PriceRoomSessionInput = Omit<PriceSessionInput, "customerType" | "membershipValidUntil"> & {
  /** Total people using the room. Room prices are never multiplied by this. */
  playerCount: number;
};

/**
 * Price a PlayStation room once at the rule configured for its player count.
 * The legacy multi-player function intentionally remains separate because it
 * prices each person; routing ROOM sessions through it would multiply revenue.
 */
export function priceRoomSession(input: PriceRoomSessionInput): PriceSessionResult {
  if (!Number.isInteger(input.playerCount) || input.playerCount < 1 || input.playerCount > 4) {
    throw new PricingError("A PlayStation room session requires between 1 and 4 players.");
  }

  const rules = input.rules.filter((rule) => (rule.playerCount ?? 1) === input.playerCount);
  if (!rules.some((rule) => rule.kind === "SLAB")) {
    throw new PricingError(`No room pricing is configured for ${input.playerCount} players.`);
  }

  const result = priceSession({
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    pauses: input.pauses,
    rules,
    config: input.config,
    customerType: "REGULAR",
    forceDayPass: input.forceDayPass,
  });

  return {
    ...result,
    notes: [`Total room price for ${input.playerCount} player${input.playerCount === 1 ? "" : "s"}.`, ...result.notes],
  };
}

/* -------------------------------------------------------------------------- */
/* Time band helpers                                                          */
/* -------------------------------------------------------------------------- */

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string): ZonedParts {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

function toUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0);
  let result = new Date(naive - offsetMs(new Date(naive), timeZone));
  result = new Date(naive - offsetMs(result, timeZone));
  return result;
}

/** True when `minuteOfDay` falls inside the night band (which may wrap midnight). */
export function isNightMinute(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) return false; // night band disabled
  if (start < end) return minuteOfDay >= start && minuteOfDay < end;
  return minuteOfDay >= start || minuteOfDay < end;
}

export function bandAt(date: Date, config: PricingConfig): PricingTimeBand {
  const p = zonedParts(date, config.timezone);
  const minuteOfDay = p.hour * 60 + p.minute;
  return isNightMinute(minuteOfDay, config.nightStartMinute, config.nightEndMinute) ? "NIGHT" : "NORMAL";
}

/** Every night-band transition strictly inside (from, to). */
function bandBoundaries(from: Date, to: Date, config: PricingConfig): Date[] {
  const { timezone, nightStartMinute, nightEndMinute } = config;
  if (nightStartMinute === nightEndMinute) return [];

  const out: Date[] = [];
  const startParts = zonedParts(from, timezone);
  // Walk one local day before through one day after to catch wrapped bands.
  const totalDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 2;
  for (let dayOffset = -1; dayOffset <= totalDays; dayOffset += 1) {
    for (const minuteOfDay of [nightStartMinute, nightEndMinute]) {
      const candidate = toUtc(
        startParts.year,
        startParts.month,
        startParts.day + dayOffset,
        minuteOfDay,
        timezone,
      );
      if (candidate.getTime() > from.getTime() && candidate.getTime() < to.getTime()) {
        out.push(candidate);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/* -------------------------------------------------------------------------- */
/* Interval maths                                                             */
/* -------------------------------------------------------------------------- */

type Interval = { start: Date; end: Date };

/** Remove pause windows from [start, end]. */
export function subtractPauses(start: Date, end: Date, pauses: PauseInterval[]): Interval[] {
  const windows = pauses
    .map((p) => ({
      start: p.pausedAt,
      end: p.resumedAt ?? end,
    }))
    .filter((p) => p.end.getTime() > start.getTime() && p.start.getTime() < end.getTime())
    .map((p) => ({
      start: new Date(Math.max(p.start.getTime(), start.getTime())),
      end: new Date(Math.min(p.end.getTime(), end.getTime())),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlapping pauses defensively.
  const merged: Interval[] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start.getTime() <= last.end.getTime()) {
      if (w.end.getTime() > last.end.getTime()) last.end = w.end;
    } else {
      merged.push({ ...w });
    }
  }

  const result: Interval[] = [];
  let cursor = start;
  for (const w of merged) {
    if (w.start.getTime() > cursor.getTime()) result.push({ start: cursor, end: w.start });
    if (w.end.getTime() > cursor.getTime()) cursor = w.end;
  }
  if (cursor.getTime() < end.getTime()) result.push({ start: cursor, end });
  return result;
}

/* -------------------------------------------------------------------------- */
/* Slab cost (minimum-cost cover)                                             */
/* -------------------------------------------------------------------------- */

export type SlabCostResult = { amount: number; slabs: PricedSlab[] };

/**
 * Cheapest combination of slabs that covers `minutes`.
 * Classic unbounded "coin change" over 1-minute granularity.
 */
export function minimumSlabCost(
  slabs: { durationMinutes: number; price: number }[],
  minutes: number,
): SlabCostResult {
  if (minutes <= 0) return { amount: 0, slabs: [] };
  const usable = slabs.filter((s) => s.durationMinutes > 0).sort((a, b) => a.durationMinutes - b.durationMinutes);
  if (usable.length === 0) {
    throw new PricingError(
      "No pricing slabs are configured for this station category / customer type / time band.",
    );
  }

  const target = Math.ceil(minutes);
  const cost = new Array<number>(target + 1).fill(Number.POSITIVE_INFINITY);
  const choice = new Array<number>(target + 1).fill(-1);
  cost[0] = 0;

  for (let m = 1; m <= target; m += 1) {
    for (let i = 0; i < usable.length; i += 1) {
      const slab = usable[i];
      const remaining = Math.max(0, m - slab.durationMinutes);
      const candidate = slab.price + cost[remaining];
      if (candidate < cost[m]) {
        cost[m] = candidate;
        choice[m] = i;
      }
    }
  }

  // Reconstruct which slabs were used.
  const counts = new Map<number, PricedSlab>();
  let remaining = target;
  let guard = 0;
  while (remaining > 0 && guard < target + 5) {
    const index = choice[remaining];
    if (index < 0) break;
    const slab = usable[index];
    const existing = counts.get(index);
    if (existing) existing.count += 1;
    else counts.set(index, { durationMinutes: slab.durationMinutes, price: slab.price, count: 1 });
    remaining = Math.max(0, remaining - slab.durationMinutes);
    guard += 1;
  }

  return {
    amount: cost[target],
    slabs: [...counts.values()].sort((a, b) => a.durationMinutes - b.durationMinutes),
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

function ceilMinutes(ms: number): number {
  return Math.ceil(ms / 60_000);
}

/**
 * Money is held in paise, but a cafe counts in rupees. Charging by the minute
 * produces fractions — 61 minutes at ₹100/hr is ₹101.67 — so every line lands
 * on a whole rupee. At most fifty paise either way, and the total a customer
 * is asked for is always a number that can be handed over in cash.
 */
const MINOR_UNITS_PER_UNIT = 100;

function roundToUnit(minorUnits: number): number {
  return Math.round(minorUnits / MINOR_UNITS_PER_UNIT) * MINOR_UNITS_PER_UNIT;
}

/**
 * Price a (possibly still running) session. Pass `endedAt = new Date()` to get
 * the live running total shown on a station card.
 */
export function priceSession(input: PriceSessionInput): PriceSessionResult {
  const { startedAt, endedAt, rules, config, customerType } = input;
  const pauses = input.pauses ?? [];
  const notes: string[] = [];

  if (endedAt.getTime() < startedAt.getTime()) {
    throw new PricingError("Session end time cannot be before its start time.");
  }

  const wallMs = endedAt.getTime() - startedAt.getTime();
  const billableIntervals = subtractPauses(startedAt, endedAt, pauses);
  const billableMs = billableIntervals.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
  const pausedMs = Math.max(0, wallMs - billableMs);

  const wallMinutes = ceilMinutes(wallMs);
  const billedMinutes = ceilMinutes(billableMs);
  const pausedMinutes = Math.floor(pausedMs / 60_000);

  if (pausedMinutes > 0) {
    notes.push(`${pausedMinutes} paused minute(s) excluded from billing.`);
  }

  if (billedMinutes < config.minimumBillMinutes) {
    return {
      amount: 0,
      wallMinutes,
      billedMinutes,
      pausedMinutes,
      segments: [],
      dayPassApplied: false,
      dayPassPrice: null,
      notes: [
        ...notes,
        `Session shorter than the ${config.minimumBillMinutes} minute minimum — not charged.`,
      ],
    };
  }

  // ---- Split into (band, customerType) segments ---------------------------
  const membershipEnd =
    customerType === "MEMBER" && input.membershipValidUntil ? input.membershipValidUntil : null;

  type RawSegment = { start: Date; end: Date; timeBand: PricingTimeBand; customerType: PricingCustomerType };
  const rawSegments: RawSegment[] = [];

  for (const interval of billableIntervals) {
    const cuts = bandBoundaries(interval.start, interval.end, config);
    if (
      membershipEnd &&
      membershipEnd.getTime() > interval.start.getTime() &&
      membershipEnd.getTime() < interval.end.getTime()
    ) {
      cuts.push(membershipEnd);
    }
    cuts.sort((a, b) => a.getTime() - b.getTime());

    let cursor = interval.start;
    for (const cut of [...cuts, interval.end]) {
      if (cut.getTime() <= cursor.getTime()) continue;
      const effectiveType: PricingCustomerType =
        customerType === "MEMBER" && membershipEnd && cursor.getTime() >= membershipEnd.getTime()
          ? "REGULAR"
          : customerType;
      rawSegments.push({
        start: cursor,
        end: cut,
        timeBand: bandAt(cursor, config),
        customerType: effectiveType,
      });
      cursor = cut;
    }
  }

  if (membershipEnd && rawSegments.some((s) => s.customerType === "REGULAR") && customerType === "MEMBER") {
    notes.push("Membership expired during the session — later time billed at regular rates.");
  }

  // ---- Group and price ----------------------------------------------------
  const groups = new Map<string, { timeBand: PricingTimeBand; customerType: PricingCustomerType; ms: number }>();
  for (const segment of rawSegments) {
    const key = `${segment.timeBand}|${segment.customerType}`;
    const existing = groups.get(key);
    const ms = segment.end.getTime() - segment.start.getTime();
    if (existing) existing.ms += ms;
    else groups.set(key, { timeBand: segment.timeBand, customerType: segment.customerType, ms });
  }

  const perMinute = (config.billingMode ?? "PER_MINUTE") === "PER_MINUTE";

  const segments: PricedSegment[] = [];
  let slabTotal = 0;

  for (const group of groups.values()) {
    const minutes = ceilMinutes(group.ms);
    if (minutes <= 0) continue;

    /**
     * The slabs that apply to this group, falling back rather than failing: a
     * member must never block checkout because member rates were not set up,
     * and a night session must not block it because night rates were not.
     */
    const pick = (): { slabs: EnginePricingRule[]; note?: string } => {
      const exact = rules.filter(
        (r) => r.kind === "SLAB" && r.timeBand === group.timeBand && r.customerType === group.customerType,
      );
      if (exact.length > 0) return { slabs: exact };

      const regularSameBand = rules.filter(
        (r) => r.kind === "SLAB" && r.timeBand === group.timeBand && r.customerType === "REGULAR",
      );
      if (group.customerType === "MEMBER" && regularSameBand.length > 0) {
        return {
          slabs: regularSameBand,
          note: `No member rates configured for the ${group.timeBand.toLowerCase()} band — regular rates used.`,
        };
      }

      const normalSameType = rules.filter(
        (r) => r.kind === "SLAB" && r.customerType === group.customerType && r.timeBand === "NORMAL",
      );
      if (group.timeBand === "NIGHT" && normalSameType.length > 0) {
        return { slabs: normalSameType, note: "No night rates configured — normal rates used." };
      }

      throw new PricingError(
        `No ${group.customerType.toLowerCase()} pricing configured for this station category.`,
      );
    };

    const { slabs, note } = pick();
    if (note && !notes.includes(note)) notes.push(note);

    if (perMinute) {
      // The hourly price is whatever one hour costs under the configured
      // slabs — the same number the station card shows as "₹X/hr" — so the
      // board and the bill can never tell the customer different things.
      const hourly = minimumSlabCost(slabs, 60).amount;
      const amount = roundToUnit((hourly * minutes) / 60);
      slabTotal += amount;
      segments.push({
        timeBand: group.timeBand,
        customerType: group.customerType,
        minutes,
        amount,
        slabs: [],
        hourlyRate: hourly,
      });
      continue;
    }

    const priced = minimumSlabCost(slabs, minutes);
    slabTotal += priced.amount;
    segments.push({
      timeBand: group.timeBand,
      customerType: group.customerType,
      minutes,
      amount: priced.amount,
      slabs: priced.slabs,
    });
  }

  if (perMinute) {
    notes.push("Charged for the time actually played, at the hourly rate.");
  }

  segments.sort((a, b) => a.timeBand.localeCompare(b.timeBand));

  // ---- Day pass -----------------------------------------------------------
  const dayPassRules = rules.filter((r) => r.kind === "DAY_PASS");
  const dayPassRule =
    dayPassRules.find((r) => r.customerType === customerType) ?? dayPassRules.find((r) => r.customerType === "REGULAR");
  const dayPassPrice = dayPassRule ? dayPassRule.price : null;
  const dayPassFits = config.dayPassEnabled && billedMinutes <= config.dayPassMinutes;

  let amount = slabTotal;
  let dayPassApplied = false;

  if (dayPassRule && config.dayPassEnabled && (input.forceDayPass || (dayPassFits && dayPassRule.price < slabTotal))) {
    if (input.forceDayPass && !dayPassFits) {
      notes.push("Day pass validity exceeded — slab pricing applied instead.");
    } else {
      amount = dayPassRule.price;
      dayPassApplied = true;
      notes.push(
        input.forceDayPass
          ? "Day pass selected by staff."
          : "Day pass applied automatically because it is cheaper than slab pricing.",
      );
    }
  }

  return {
    amount,
    wallMinutes,
    billedMinutes,
    pausedMinutes,
    segments,
    dayPassApplied,
    dayPassPrice,
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Multiple players on one station                                            */
/* -------------------------------------------------------------------------- */

export type EnginePlayer = {
  /** 1-based position on the station. */
  slot: number;
  /** Shown on the bill — the member's name, or "Player 2". */
  label: string;
  customerType: PricingCustomerType;
  membershipValidUntil?: Date | null;
};

export type PricedPlayer = {
  slot: number;
  label: string;
  customerType: PricingCustomerType;
  /** This player's own gaming charge, in minor units. */
  amount: number;
  segments: PricedSegment[];
  dayPassApplied: boolean;
};

export type PriceSessionPlayersResult = PriceSessionResult & {
  playerCount: number;
  players: PricedPlayer[];
};

export type PriceSessionPlayersInput = Omit<PriceSessionInput, "customerType" | "membershipValidUntil"> & {
  players: EnginePlayer[];
};

/**
 * Price a session shared by several people.
 *
 * Everyone played the same minutes, so each player is priced over the *same*
 * interval — night bands, pauses, slab cover and day pass all behave exactly as
 * they do for one person — but at their own rate: whoever holds a valid
 * membership is charged member rates, everyone else regular rates. The bill is
 * the sum. Four players on a ₹180/hr station with three memberships at ₹150/hr
 * therefore comes to 3 x ₹150 + ₹180 = ₹630 for the hour.
 *
 * With a single player this returns exactly what `priceSession` returns, so
 * nothing about an ordinary one-seat session changes.
 */
export function priceSessionForPlayers(input: PriceSessionPlayersInput): PriceSessionPlayersResult {
  const roster: EnginePlayer[] = input.players.length
    ? input.players
    : [{ slot: 1, label: "Player 1", customerType: "REGULAR", membershipValidUntil: null }];

  const priced = roster.map((player) => ({
    player,
    result: priceSession({
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      pauses: input.pauses,
      rules: input.rules,
      config: input.config,
      forceDayPass: input.forceDayPass,
      customerType: player.customerType,
      membershipValidUntil: player.membershipValidUntil ?? null,
    }),
  }));

  const players: PricedPlayer[] = priced.map(({ player, result }) => ({
    slot: player.slot,
    label: player.label,
    customerType: player.customerType,
    amount: result.amount,
    segments: result.segments,
    dayPassApplied: result.dayPassApplied,
  }));

  const first = priced[0].result;

  if (priced.length === 1) {
    return { ...first, playerCount: 1, players };
  }

  // ---- Merge the per-player lines into what the receipt shows -------------
  const merged = new Map<string, PricedSegment>();
  for (const { result } of priced) {
    for (const segment of result.segments) {
      const key = `${segment.timeBand}|${segment.customerType}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          ...segment,
          slabs: segment.slabs.map((slab) => ({ ...slab })),
          players: 1,
        });
        continue;
      }
      existing.amount += segment.amount;
      existing.players = (existing.players ?? 1) + 1;
      // Everyone played the same minutes, so this is the same number each time.
      existing.minutes = Math.max(existing.minutes, segment.minutes);
      for (const slab of segment.slabs) {
        const match = existing.slabs.find(
          (s) => s.durationMinutes === slab.durationMinutes && s.price === slab.price,
        );
        if (match) match.count += slab.count;
        else existing.slabs.push({ ...slab });
      }
    }
  }

  /**
   * A note that applies to everyone is stated once; one that applies to only
   * some players names them, so "membership expired mid-session" can never be
   * read as applying to the whole table.
   */
  const noteOwners = new Map<string, string[]>();
  for (const { player, result } of priced) {
    for (const note of result.notes) {
      const owners = noteOwners.get(note) ?? [];
      owners.push(player.label);
      noteOwners.set(note, owners);
    }
  }
  const notes = [...noteOwners.entries()].map(([note, owners]) =>
    owners.length === priced.length ? note : `${owners.join(", ")}: ${note}`,
  );

  const memberCount = roster.filter((player) => player.customerType === "MEMBER").length;
  notes.unshift(
    memberCount === 0
      ? `${roster.length} players, each charged at the regular rate.`
      : memberCount === roster.length
        ? `${roster.length} players, each charged at the member rate.`
        : `${roster.length} players — ${memberCount} at member rates, ${roster.length - memberCount} at regular rates.`,
  );

  const segments = [...merged.values()].sort(
    (a, b) => a.timeBand.localeCompare(b.timeBand) || a.customerType.localeCompare(b.customerType),
  );

  return {
    amount: priced.reduce((sum, entry) => sum + entry.result.amount, 0),
    // The clock is one clock: everybody started and stopped together.
    wallMinutes: first.wallMinutes,
    billedMinutes: first.billedMinutes,
    pausedMinutes: first.pausedMinutes,
    segments,
    dayPassApplied: priced.every((entry) => entry.result.dayPassApplied),
    dayPassPrice: first.dayPassPrice,
    notes,
    playerCount: roster.length,
    players,
  };
}

/**
 * The headline hourly amount shown on a room card: the cost of exactly one hour
 * for the given customer type in the band that applies right now.
 */
export function hourlyDisplayRate(
  rules: EnginePricingRule[],
  config: PricingConfig,
  customerType: PricingCustomerType,
  at: Date = new Date(),
): number | null {
  const band = bandAt(at, config);
  const slabs = rules.filter((r) => r.kind === "SLAB" && r.timeBand === band && r.customerType === customerType);
  const pool = slabs.length
    ? slabs
    : rules.filter((r) => r.kind === "SLAB" && r.timeBand === "NORMAL" && r.customerType === customerType);
  if (pool.length === 0) return null;
  try {
    return minimumSlabCost(pool, 60).amount;
  } catch {
    return null;
  }
}

/** Total room price for exactly one hour at the selected player count. */
export function roomHourlyDisplayRate(
  rules: EnginePricingRule[],
  config: PricingConfig,
  playerCount: number,
  at: Date = new Date(),
): number | null {
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 4) return null;
  const matching = rules.filter((rule) => (rule.playerCount ?? 1) === playerCount);
  return hourlyDisplayRate(matching, config, "REGULAR", at);
}
