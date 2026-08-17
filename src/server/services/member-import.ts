import "server-only";

import { inArray, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import { members, memberships } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { memberCode } from "@/lib/codes";
import { blindIndex, encryptSensitive } from "@/lib/crypto";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { membershipTermFor, type ParsedMember, type RejectedRow } from "@/lib/member-import";
import { can } from "@/lib/permissions";
import { getSettingsFor } from "@/server/services/settings";

export type ImportOutcome = {
  imported: number;
  withMembership: number;
  /** Already on file, left exactly as they were. */
  duplicates: RejectedRow[];
  /** Could not be imported at all — no name, or no usable mobile number. */
  rejected: RejectedRow[];
  /** Imported, but something in the row was dropped. */
  warnings: { line: number; name: string; issues: string[] }[];
};

/** Rows are inserted in batches so one statement never carries 500 rows. */
const BATCH = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/**
 * The next member number.
 *
 * Taken from the highest code already issued rather than from a row count: a
 * count would hand out a number that already exists the moment any member is
 * ever removed, and an import of five hundred is exactly when that would bite.
 */
async function nextMemberSequence(tx: DbClient): Promise<number> {
  const [row] = await tx
    .select({
      // Only codes in our own GZM-00000 shape are read, and only up to nine
      // digits. A cafe may well carry legacy codes from an older system, and
      // stripping the digits out of one of those ("OLD-2019-4471") would
      // produce a number far outside the column's range.
      highest: sql<number>`coalesce(max(case when ${members.memberCode} ~ '^GZM-[0-9]{1,9}$'
        then substring(${members.memberCode} from 5)::int end), 0)`,
      total: sql<number>`count(*)::int`,
    })
    .from(members);

  // Never go backwards past the number of members already on file, so codes
  // stay unique even in a database whose codes came from somewhere else.
  return Math.max(row?.highest ?? 0, row?.total ?? 0) + 1;
}

/**
 * Bring a cafe's existing membership list into the system.
 *
 * Everything happens in one transaction: either the whole import lands or none
 * of it does, so a connection dropped halfway can never leave half a customer
 * list behind.
 *
 * Three rules, all chosen by the cafe owner:
 *   - a mobile number already on file is left completely alone and reported;
 *   - a row missing an optional detail is still imported, with that one field
 *     blank and a note saying so;
 *   - only a row with no name or no usable mobile number is turned away.
 */
export async function importMembers(
  parsed: ParsedMember[],
  rejected: RejectedRow[],
  user: SessionUser,
): Promise<ImportOutcome> {
  if (!can(user, "members.manage")) {
    throw new ForbiddenError("Your role cannot add members.");
  }
  if (parsed.length === 0) {
    throw new ValidationError("There is nothing to import — no usable rows were found in that file.");
  }
  if (parsed.length > 5_000) {
    throw new ValidationError("That file has more than 5,000 rows. Split it and import in parts.");
  }

  return db.transaction(async (tx) => {
    const settings = await getSettingsFor(tx);

    // ---- Who is already on file ------------------------------------------
    const mobiles = parsed.map((member) => member.mobile);
    const existing = await tx
      .select({ mobile: members.mobile })
      .from(members)
      .where(inArray(members.mobile, mobiles));
    const takenMobiles = new Set(existing.map((row) => row.mobile));

    const aadhaarHashes = parsed
      .filter((member) => member.aadhaar)
      .map((member) => blindIndex(member.aadhaar!));
    const existingAadhaar = aadhaarHashes.length
      ? await tx
          .select({ hash: members.aadhaarHash })
          .from(members)
          .where(inArray(members.aadhaarHash, aadhaarHashes))
      : [];
    const takenAadhaar = new Set(existingAadhaar.map((row) => row.hash));

    const duplicates: RejectedRow[] = [];
    const toImport: ParsedMember[] = [];
    for (const member of parsed) {
      if (takenMobiles.has(member.mobile)) {
        duplicates.push({
          line: member.line,
          reason: "Already a member — left unchanged.",
          name: member.fullName,
          mobile: member.mobile,
        });
        continue;
      }
      toImport.push(member);
    }

    if (toImport.length === 0) {
      await recordAudit(
        {
          action: "members.imported",
          userId: user.id,
          userLabel: user.name,
          entityType: "member",
          metadata: { imported: 0, duplicates: duplicates.length, rejected: rejected.length },
        },
        tx,
      );
      return { imported: 0, withMembership: 0, duplicates, rejected, warnings: [] };
    }

    // ---- Build the rows ----------------------------------------------------
    let sequence = await nextMemberSequence(tx);
    const warnings: ImportOutcome["warnings"] = [];
    const values: (typeof members.$inferInsert)[] = [];

    for (const member of toImport) {
      const issues = [...member.warnings];
      const row: typeof members.$inferInsert = {
        memberCode: memberCode(sequence),
        fullName: member.fullName,
        mobile: member.mobile,
        dateOfBirth: member.dateOfBirth,
        address: member.address,
        notes: member.notes,
      };
      sequence += 1;

      if (member.aadhaar) {
        const hash = blindIndex(member.aadhaar);
        if (takenAadhaar.has(hash)) {
          // Someone already on file holds this number. Import the member
          // without it rather than losing the row or creating a clash.
          issues.push("Aadhaar already belongs to another member — left blank");
        } else {
          takenAadhaar.add(hash);
          row.aadhaarEnc = encryptSensitive(member.aadhaar);
          row.aadhaarLast4 = member.aadhaar.slice(-4);
          row.aadhaarHash = hash;
        }
      }

      values.push(row);
      if (issues.length > 0) warnings.push({ line: member.line, name: member.fullName, issues });
    }

    const inserted: { id: string; mobile: string }[] = [];
    for (const batch of chunk(values, BATCH)) {
      const rows = await tx
        .insert(members)
        .values(batch)
        .returning({ id: members.id, mobile: members.mobile });
      inserted.push(...rows);
    }

    const idByMobile = new Map(inserted.map((row) => [row.mobile, row.id]));

    // ---- Their membership terms -------------------------------------------
    const membershipRows: (typeof memberships.$inferInsert)[] = [];
    for (const member of toImport) {
      const memberId = idByMobile.get(member.mobile);
      if (!memberId) continue;

      const term = membershipTermFor(member, settings.membershipDays);
      if (!term) continue;

      membershipRows.push({
        memberId,
        startDate: term.startDate,
        endDate: term.endDate,
        price: member.price,
        note: "Imported from the cafe's own list",
        createdById: user.id,
        /**
         * Dated to when the term began, not to today. Income counts membership
         * revenue by when the row was created, so importing years of history
         * would otherwise appear as a single enormous day's takings.
         */
        createdAt: term.startDate,
      });
    }

    for (const batch of chunk(membershipRows, BATCH)) {
      await tx.insert(memberships).values(batch);
    }

    await recordAudit(
      {
        action: "members.imported",
        userId: user.id,
        userLabel: user.name,
        entityType: "member",
        // Counts only. No names, no numbers, and certainly no Aadhaar.
        metadata: {
          imported: inserted.length,
          withMembership: membershipRows.length,
          duplicates: duplicates.length,
          rejected: rejected.length,
          warnings: warnings.length,
        },
      },
      tx,
    );

    return {
      imported: inserted.length,
      withMembership: membershipRows.length,
      duplicates,
      rejected,
      warnings,
    };
  });
}

/**
 * Which of these mobile numbers are already members, for the preview. Read
 * only — nothing is written and nothing is changed.
 */
export async function findExistingMobiles(mobiles: string[]): Promise<Set<string>> {
  if (mobiles.length === 0) return new Set();
  const rows = await db
    .select({ mobile: members.mobile })
    .from(members)
    .where(inArray(members.mobile, mobiles));
  return new Set(rows.map((row) => row.mobile));
}
