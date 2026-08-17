import { afterAll, describe, expect, it } from "vitest";

import { Pool } from "pg";

/**
 * Database-level guarantees.
 *
 * These are the rules that must hold even when the application code is wrong,
 * so they are asserted against real Postgres rather than mocked. The suite
 * skips itself when DATABASE_URL is not set (e.g. on a machine without a dev
 * database) so `npm test` never fails for the wrong reason.
 */
const connectionString = process.env.DATABASE_URL;
const describeIfDb = connectionString ? describe : describe.skip;

const pool = connectionString ? new Pool({ connectionString, max: 4 }) : null;

afterAll(async () => {
  await pool?.end();
});

async function scaffold() {
  const client = await pool!.connect();
  try {
    const { rows: userRows } = await client.query(`select id from users limit 1`);
    /**
     * A station with nothing running on it. Picking simply the first station
     * makes these tests fail whenever the development database happens to have
     * a live session — a failure that says nothing about the guarantees below.
     */
    const { rows: stationRows } = await client.query(
      `select s.id from stations s
        where s.is_active
          and not exists (
            select 1 from game_sessions g
             where g.station_id = s.id and g.status in ('ACTIVE', 'PAUSED')
          )
        limit 1`,
    );
    return { userId: userRows[0]?.id as string, stationId: stationRows[0]?.id as string };
  } finally {
    client.release();
  }
}

describeIfDb("database guarantees", () => {
  it("allows only one live session per station", async () => {
    const { userId, stationId } = await scaffold();
    expect(userId, "seed the database first: npm run db:seed").toBeTruthy();
    expect(stationId, "no free station — end any live sessions first").toBeTruthy();

    const insert = (code: string) =>
      pool!.query(
        `insert into game_sessions (code, station_id, status, started_at, started_by_id)
         values ($1, $2, 'ACTIVE', now(), $3) returning id`,
        [code, stationId, userId],
      );

    const first = await insert(`T-${Date.now()}-A`);
    await expect(insert(`T-${Date.now()}-B`)).rejects.toThrow(/game_sessions_one_live_per_station|duplicate key/i);

    // A completed session frees the station again.
    await pool!.query(`update game_sessions set status = 'COMPLETED', ended_at = now() where id = $1`, [
      first.rows[0].id,
    ]);
    const third = await insert(`T-${Date.now()}-C`);
    await pool!.query(`delete from game_sessions where id = any($1)`, [[first.rows[0].id, third.rows[0].id]]);
  });

  it("rejects two staff starting the same station at the same moment", async () => {
    const { userId, stationId } = await scaffold();
    const stamp = Date.now();

    const results = await Promise.allSettled([
      pool!.query(
        `insert into game_sessions (code, station_id, status, started_at, started_by_id)
         values ($1, $2, 'ACTIVE', now(), $3) returning id`,
        [`R-${stamp}-1`, stationId, userId],
      ),
      pool!.query(
        `insert into game_sessions (code, station_id, status, started_at, started_by_id)
         values ($1, $2, 'ACTIVE', now(), $3) returning id`,
        [`R-${stamp}-2`, stationId, userId],
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    await pool!.query(`delete from game_sessions where code like $1`, [`R-${stamp}-%`]);
  });

  it("refuses a transaction whose cash and UPI parts do not equal the total", async () => {
    const { userId, stationId } = await scaffold();
    const { rows } = await pool!.query(
      `insert into game_sessions (code, station_id, status, started_at, started_by_id)
       values ($1, $2, 'COMPLETED', now(), $3) returning id`,
      [`X-${Date.now()}`, stationId, userId],
    );
    const sessionId = rows[0].id;

    await expect(
      pool!.query(
        `insert into transactions (
           code, session_id, station_id, station_snapshot, category_snapshot,
           started_at, ended_at, duration_minutes, billed_minutes,
           gaming_amount, food_amount, subtotal, total_amount,
           payment_method, cash_amount, upi_amount, staff_id
         ) values ($1, $2, $3, 'X', 'X', now(), now(), 60, 60, 10000, 0, 10000, 10000, 'SPLIT', 4000, 4000, $4)`,
        [`BAD-${Date.now()}`, sessionId, stationId, userId],
      ),
    ).rejects.toThrow(/transactions_split_matches_total/i);

    await pool!.query(`delete from game_sessions where id = $1`, [sessionId]);
  });

  it("refuses to seat the same member twice on one session", async () => {
    const { userId, stationId } = await scaffold();
    const { rows: memberRows } = await pool!.query(`select id from members limit 1`);
    const memberId = memberRows[0]?.id as string;
    expect(memberId, "seed the database first: npm run db:seed").toBeTruthy();

    const { rows } = await pool!.query(
      `insert into game_sessions (code, station_id, status, started_at, started_by_id, player_count)
       values ($1, $2, 'COMPLETED', now(), $3, 2) returning id`,
      [`P-${Date.now()}`, stationId, userId],
    );
    const sessionId = rows[0].id;

    const seat = (slot: number) =>
      pool!.query(
        `insert into session_players (session_id, slot, member_id, customer_type)
         values ($1, $2, $3, 'MEMBER')`,
        [sessionId, slot, memberId],
      );

    await seat(1);
    await expect(seat(2)).rejects.toThrow(/session_players_member_key|duplicate key/i);

    // Two guests, on the other hand, are perfectly normal.
    await pool!.query(
      `insert into session_players (session_id, slot, customer_type) values ($1, 2, 'REGULAR'), ($1, 3, 'REGULAR')`,
      [sessionId],
    );

    await pool!.query(`delete from game_sessions where id = $1`, [sessionId]);
  });

  it("refuses a player charged member rates with no member attached", async () => {
    const { userId, stationId } = await scaffold();
    const { rows } = await pool!.query(
      `insert into game_sessions (code, station_id, status, started_at, started_by_id)
       values ($1, $2, 'COMPLETED', now(), $3) returning id`,
      [`M-${Date.now()}`, stationId, userId],
    );
    const sessionId = rows[0].id;

    await expect(
      pool!.query(
        `insert into session_players (session_id, slot, customer_type) values ($1, 1, 'MEMBER')`,
        [sessionId],
      ),
    ).rejects.toThrow(/session_players_member_required/i);

    await pool!.query(`delete from game_sessions where id = $1`, [sessionId]);
  });

  it("refuses a station category seating fewer than one player", async () => {
    await expect(
      pool!.query(`update station_categories set max_players = 0 where true`),
    ).rejects.toThrow(/station_categories_max_players_range/i);
  });

  it("refuses a negative payment", async () => {
    await expect(
      pool!.query(
        `insert into payments (transaction_id, channel, amount)
         values ('00000000-0000-0000-0000-000000000000', 'CASH', -100)`,
      ),
    ).rejects.toThrow();
  });
});
