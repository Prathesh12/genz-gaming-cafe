import "server-only";

import { asc, eq } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import { pricingRules, stationCategories } from "@/db/schema";
import type { BusinessSettings } from "@/db/schema";
import {
  hourlyDisplayRate,
  priceSession,
  priceSessionForPlayers,
  type EnginePlayer,
  type EnginePricingRule,
  type PauseInterval,
  type PriceSessionPlayersResult,
  type PriceSessionResult,
} from "@/server/pricing/engine";
import { toPricingConfig } from "@/server/services/settings";

export type PricingRuleRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  customerType: "REGULAR" | "MEMBER";
  timeBand: "NORMAL" | "NIGHT";
  kind: "SLAB" | "DAY_PASS";
  durationMinutes: number;
  price: number;
  isActive: boolean;
};

export async function listPricingRules(client: DbClient = db): Promise<PricingRuleRow[]> {
  const rows = await client
    .select({
      id: pricingRules.id,
      categoryId: pricingRules.categoryId,
      categoryName: stationCategories.name,
      customerType: pricingRules.customerType,
      timeBand: pricingRules.timeBand,
      kind: pricingRules.kind,
      durationMinutes: pricingRules.durationMinutes,
      price: pricingRules.price,
      isActive: pricingRules.isActive,
    })
    .from(pricingRules)
    .innerJoin(stationCategories, eq(pricingRules.categoryId, stationCategories.id))
    .orderBy(
      asc(stationCategories.sortOrder),
      asc(stationCategories.name),
      asc(pricingRules.customerType),
      asc(pricingRules.timeBand),
      asc(pricingRules.durationMinutes),
    );
  return rows;
}

/** Active rules grouped by station category, ready for the pricing engine. */
export async function getRulesByCategory(client: DbClient = db): Promise<Map<string, EnginePricingRule[]>> {
  const rows = await client
    .select({
      id: pricingRules.id,
      categoryId: pricingRules.categoryId,
      customerType: pricingRules.customerType,
      timeBand: pricingRules.timeBand,
      kind: pricingRules.kind,
      durationMinutes: pricingRules.durationMinutes,
      price: pricingRules.price,
    })
    .from(pricingRules)
    .where(eq(pricingRules.isActive, true));

  const map = new Map<string, EnginePricingRule[]>();
  for (const row of rows) {
    const list = map.get(row.categoryId) ?? [];
    list.push({
      id: row.id,
      customerType: row.customerType,
      timeBand: row.timeBand,
      kind: row.kind,
      durationMinutes: row.durationMinutes,
      price: row.price,
    });
    map.set(row.categoryId, list);
  }
  return map;
}

export type ChargeInput = {
  startedAt: Date;
  endedAt: Date;
  pauses: PauseInterval[];
  customerType: "REGULAR" | "MEMBER";
  membershipValidUntil: Date | null;
  rules: EnginePricingRule[];
  settings: BusinessSettings;
  forceDayPass?: boolean;
};

/** Thin wrapper that feeds stored settings into the pure engine. */
export function computeGamingCharge(input: ChargeInput): PriceSessionResult {
  return priceSession({
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    pauses: input.pauses,
    rules: input.rules,
    config: toPricingConfig(input.settings),
    customerType: input.customerType,
    membershipValidUntil: input.membershipValidUntil,
    forceDayPass: input.forceDayPass,
  });
}

export type GroupChargeInput = Omit<ChargeInput, "customerType" | "membershipValidUntil"> & {
  players: EnginePlayer[];
};

/**
 * The same wrapper for a station shared by several people. Each player is
 * charged their own rate for the time everyone played; the total is the sum.
 */
export function computeGroupGamingCharge(input: GroupChargeInput): PriceSessionPlayersResult {
  return priceSessionForPlayers({
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    pauses: input.pauses,
    rules: input.rules,
    config: toPricingConfig(input.settings),
    forceDayPass: input.forceDayPass,
    players: input.players,
  });
}

export function displayHourlyRate(
  rules: EnginePricingRule[],
  settings: BusinessSettings,
  customerType: "REGULAR" | "MEMBER" = "REGULAR",
  at: Date = new Date(),
): number | null {
  return hourlyDisplayRate(rules, toPricingConfig(settings), customerType, at);
}
