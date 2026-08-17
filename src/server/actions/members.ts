"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { toSheet } from "@/lib/csv";
import { actionError, actionOk, ValidationError, type ActionResult } from "@/lib/errors";
import {
  detectColumns,
  parseMembers,
  type ColumnMapping,
  type DateOrder,
  type RejectedRow,
} from "@/lib/member-import";
import { formDataToObject, memberSchema, membershipSchema, parseOrThrow, uuidSchema } from "@/lib/schemas";
import {
  findExistingMobiles,
  importMembers,
  type ImportOutcome,
} from "@/server/services/member-import";
import { addMembership, createMember, revealAadhaar, setMemberActive, updateMember } from "@/server/services/members";

function refresh() {
  revalidatePath("/members");
  revalidatePath("/dashboard");
}

export async function saveMemberAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("members.manage");
    const input = parseOrThrow(memberSchema, formDataToObject(formData));
    if (input.id) {
      await updateMember({ ...input, id: input.id }, user);
    } else {
      await createMember(input, user);
    }
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleMemberActiveAction(id: string, isActive: boolean): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("members.manage");
    await setMemberActive(parseOrThrow(uuidSchema, id), isActive, user);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function renewMembershipAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("members.manage");
    const input = parseOrThrow(membershipSchema, formDataToObject(formData));
    await addMembership(input, user);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Reveal a member's full Aadhaar number. Admin only, audited on every call,
 * and returned directly to the caller so it never lands in a cached payload.
 */
export async function revealAadhaarAction(memberId: string): Promise<ActionResult<{ aadhaar: string }>> {
  try {
    const user = await requirePermission("members.viewSensitive");
    const aadhaar = await revealAadhaar(parseOrThrow(uuidSchema, memberId), user);
    return actionOk({ aadhaar });
  } catch (error) {
    return actionError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Importing an existing membership list                                      */
/* -------------------------------------------------------------------------- */

export type ImportPreview = {
  headers: string[];
  mapping: ColumnMapping;
  dateOrder: DateOrder;
  dateOrderCertain: boolean;
  /** First few rows, so the owner can see the file was read correctly. */
  sample: { line: number; fullName: string; mobile: string; start: string | null; end: string | null }[];
  ready: number;
  duplicates: RejectedRow[];
  rejected: RejectedRow[];
  warnings: { line: number; name: string; issues: string[] }[];
};

/**
 * Read an uploaded sheet and report exactly what would happen, without
 * changing anything. Five hundred customer records is not something anyone
 * should commit to sight unseen.
 */
export async function previewMemberImportAction(
  text: string,
  overrides?: { mapping?: ColumnMapping; dateOrder?: DateOrder },
): Promise<ActionResult<ImportPreview>> {
  try {
    await requirePermission("members.manage");

    const sheet = toSheet(text);
    if (sheet.headers.length === 0) {
      throw new ValidationError("That file appears to be empty.");
    }
    if (sheet.rows.length === 0) {
      throw new ValidationError("That file has column headings but no rows beneath them.");
    }

    const mapping = overrides?.mapping ?? detectColumns(sheet.headers);
    if (mapping.fullName === undefined || mapping.mobile === undefined) {
      throw new ValidationError(
        "Could not find a name column and a mobile number column. Choose them below and try again.",
      );
    }

    const parsed = parseMembers(sheet.rows, mapping, { dateOrder: overrides?.dateOrder });
    const onFile = await findExistingMobiles(parsed.members.map((member) => member.mobile));

    const duplicates: RejectedRow[] = [];
    const fresh = parsed.members.filter((member) => {
      if (!onFile.has(member.mobile)) return true;
      duplicates.push({
        line: member.line,
        reason: "Already a member — will be left unchanged.",
        name: member.fullName,
        mobile: member.mobile,
      });
      return false;
    });

    return actionOk({
      headers: sheet.headers,
      mapping,
      dateOrder: parsed.dateOrder,
      dateOrderCertain: parsed.dateOrderCertain,
      sample: fresh.slice(0, 8).map((member) => ({
        line: member.line,
        fullName: member.fullName,
        mobile: member.mobile,
        start: member.membershipStart ? member.membershipStart.toISOString().slice(0, 10) : null,
        end: member.membershipEnd ? member.membershipEnd.toISOString().slice(0, 10) : null,
      })),
      ready: fresh.length,
      duplicates,
      rejected: parsed.rejected,
      warnings: fresh
        .filter((member) => member.warnings.length > 0)
        .map((member) => ({ line: member.line, name: member.fullName, issues: member.warnings })),
    });
  } catch (error) {
    return actionError(error);
  }
}

/** Commit the import. Re-parses the file server-side rather than trusting the preview. */
export async function importMembersAction(
  text: string,
  overrides?: { mapping?: ColumnMapping; dateOrder?: DateOrder },
): Promise<ActionResult<ImportOutcome>> {
  try {
    const user = await requirePermission("members.manage");

    const sheet = toSheet(text);
    const mapping = overrides?.mapping ?? detectColumns(sheet.headers);
    if (mapping.fullName === undefined || mapping.mobile === undefined) {
      throw new ValidationError("Choose which column holds the name and which holds the mobile number.");
    }

    const parsed = parseMembers(sheet.rows, mapping, { dateOrder: overrides?.dateOrder });
    const outcome = await importMembers(parsed.members, parsed.rejected, user);

    refresh();
    return actionOk(outcome);
  } catch (error) {
    return actionError(error);
  }
}
