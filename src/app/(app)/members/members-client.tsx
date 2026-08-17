"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Eye, Pencil, Plus, RefreshCw, Search, ShieldAlert, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ImportMembersDialog } from "@/app/(app)/members/import-dialog";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toMajor } from "@/lib/money";
import { renewMembershipAction, revealAadhaarAction, saveMemberAction } from "@/server/actions/members";
import type { MemberListRow } from "@/server/services/members";

const STATUS_TONE: Record<string, BadgeProps["tone"]> = {
  ACTIVE: "ok",
  EXPIRING: "warn",
  EXPIRED: "danger",
  NONE: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  EXPIRING: "Expiring",
  EXPIRED: "Expired",
  NONE: "No membership",
};

export function MembersClient({
  members,
  canManage,
  canViewSensitive,
  currencySymbol,
  defaultMembershipPrice,
  membershipDays,
}: {
  members: MemberListRow[];
  canManage: boolean;
  canViewSensitive: boolean;
  currencySymbol: string;
  defaultMembershipPrice: number;
  membershipDays: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [editing, setEditing] = useState<MemberListRow | "new" | null>(null);
  const [renewing, setRenewing] = useState<MemberListRow | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return members.filter(
      (member) =>
        (status === "ALL" || member.membershipStatus === status) &&
        (term === "" ||
          `${member.fullName} ${member.mobile} ${member.memberCode}`.toLowerCase().includes(term)),
    );
  }, [members, query, status]);

  const counts = useMemo(
    () => ({
      ALL: members.length,
      ACTIVE: members.filter((member) => member.membershipStatus === "ACTIVE").length,
      EXPIRING: members.filter((member) => member.membershipStatus === "EXPIRING").length,
      EXPIRED: members.filter((member) => member.membershipStatus === "EXPIRED").length,
    }),
    [members],
  );

  function reveal(member: MemberListRow) {
    startTransition(async () => {
      const result = await revealAadhaarAction(member.id);
      if (result.ok) {
        setRevealed({ id: member.id, value: result.data.aadhaar });
        toast.info("This view has been recorded in the audit log.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, mobile or member ID…"
            className="pl-9"
            aria-label="Search members"
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="w-44"
          aria-label="Filter by membership status"
        >
          <option value="ALL">All ({counts.ALL})</option>
          <option value="ACTIVE">Active ({counts.ACTIVE})</option>
          <option value="EXPIRING">Expiring ({counts.EXPIRING})</option>
          <option value="EXPIRED">Expired ({counts.EXPIRED})</option>
          <option value="NONE">No membership</option>
        </NativeSelect>
        {canManage ? (
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload aria-hidden />
              Import from a sheet
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden />
              New member
            </Button>
          </>
        ) : null}
      </div>

      <ImportMembersDialog open={importing} onOpenChange={setImporting} />

      {members.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Register your regulars to give them member pricing automatically at the counter, or import a list you already keep in a sheet."
          action={canManage ? <Button onClick={() => setEditing("new")}>Add the first member</Button> : null}
        />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Member</TH>
                <TH>Mobile</TH>
                <TH>Aadhaar</TH>
                <TH>Valid until</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((member) => (
                <TR key={member.id} className={member.isActive ? "" : "opacity-60"}>
                  <TD>
                    <span className="font-medium text-ink">{member.fullName}</span>
                    <span className="block text-xs text-ink-faint">{member.memberCode}</span>
                  </TD>
                  <TD className="tabular">{member.mobile}</TD>
                  <TD className="tabular text-ink-muted">
                    {revealed?.id === member.id ? (
                      <span className="font-semibold text-gold">{revealed.value}</span>
                    ) : (
                      member.aadhaarMasked
                    )}
                    {canViewSensitive && member.hasAadhaar && revealed?.id !== member.id ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-1 align-middle"
                        disabled={pending}
                        onClick={() => reveal(member)}
                        aria-label={`Reveal Aadhaar for ${member.fullName}`}
                        title="Reveal full Aadhaar (audited)"
                      >
                        <Eye />
                      </Button>
                    ) : null}
                  </TD>
                  <TD className="tabular">
                    {member.membershipEnd
                      ? new Date(member.membershipEnd).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[member.membershipStatus]}>
                      {STATUS_LABEL[member.membershipStatus]}
                      {member.membershipStatus === "EXPIRING" && member.daysRemaining !== null
                        ? ` · ${member.daysRemaining}d`
                        : ""}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setEditing(member)} aria-label={`Edit ${member.fullName}`}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRenewing(member)}
                          aria-label={`Renew membership for ${member.fullName}`}
                          title="Renew membership"
                        >
                          <RefreshCw />
                        </Button>
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      {filtered.length === 0 && members.length > 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">No members match those filters.</p>
      ) : null}

      <MemberDialog
        value={editing}
        canViewSensitive={canViewSensitive}
        onClose={() => setEditing(null)}
        onSaved={() => router.refresh()}
      />

      <RenewDialog
        member={renewing}
        currencySymbol={currencySymbol}
        defaultPrice={defaultMembershipPrice}
        membershipDays={membershipDays}
        onClose={() => setRenewing(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}

function MemberDialog({
  value,
  canViewSensitive,
  onClose,
  onSaved,
}: {
  value: MemberListRow | "new" | null;
  canViewSensitive: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveMemberAction, null);
  const editing = value && value !== "new" ? value : null;

  useEffect(() => {
    if (state?.ok) {
      toast.success("Member saved");
      onSaved();
      onClose();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={Boolean(value)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? `Edit ${editing.fullName}` : "New member"}
          description={editing ? editing.memberCode : "Membership can be added straight after saving."}
        />
        <DialogForm action={formAction} key={editing?.id ?? "new"}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Full name"
                htmlFor="m-name"
                required
                error={state?.ok === false ? state.fieldErrors?.fullName : undefined}
              >
                <Input id="m-name" name="fullName" defaultValue={editing?.fullName} required />
              </Field>
              <Field
                label="Mobile"
                htmlFor="m-mobile"
                required
                error={state?.ok === false ? state.fieldErrors?.mobile : undefined}
              >
                <Input
                  id="m-mobile"
                  name="mobile"
                  inputMode="numeric"
                  maxLength={10}
                  defaultValue={editing?.mobile}
                  placeholder="9876543210"
                  required
                />
              </Field>
              <Field label="Date of birth" htmlFor="m-dob">
                <Input id="m-dob" name="dateOfBirth" type="date" defaultValue={editing?.dateOfBirth ?? ""} />
              </Field>
              <Field
                label="Aadhaar"
                htmlFor="m-aadhaar"
                hint={
                  editing?.hasAadhaar
                    ? "Stored securely. Leave blank to keep the current number."
                    : "12 digits. Encrypted at rest and shown masked everywhere."
                }
                error={state?.ok === false ? state.fieldErrors?.aadhaar : undefined}
              >
                <Input
                  id="m-aadhaar"
                  name="aadhaar"
                  inputMode="numeric"
                  maxLength={14}
                  placeholder={editing?.hasAadhaar ? editing.aadhaarMasked : "1234 5678 9012"}
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field label="Address" htmlFor="m-address">
              <Textarea id="m-address" name="address" />
            </Field>
            <Field label="Notes" htmlFor="m-notes">
              <Input id="m-notes" name="notes" placeholder="e.g. prefers PC-04" />
            </Field>

            <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-muted">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
              Aadhaar numbers are encrypted with AES-256-GCM, never written to logs or exports, and only the last four
              digits are displayed.
              {canViewSensitive
                ? " As an admin with sensitive-data access you can reveal the full number; every reveal is recorded."
                : " Only an admin with sensitive-data access can reveal the full number."}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save member
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function RenewDialog({
  member,
  currencySymbol,
  defaultPrice,
  membershipDays,
  onClose,
  onSaved,
}: {
  member: MemberListRow | null;
  currencySymbol: string;
  defaultPrice: number;
  membershipDays: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(renewMembershipAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Membership added");
      onSaved();
      onClose();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          title="Renew membership"
          description={member ? `${member.fullName} · ${member.memberCode}` : undefined}
        />
        <DialogForm action={formAction} key={member?.id}>
          <input type="hidden" name="memberId" value={member?.id ?? ""} />
          <DialogBody className="space-y-4">
            {member?.membershipEnd && new Date(member.membershipEnd) > new Date() ? (
              <p className="rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">
                The current term runs to{" "}
                {new Date(member.membershipEnd).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
                . The renewal is added on top of it, and the previous term is kept in the member&apos;s history.
              </p>
            ) : null}

            <Field label="Start date" htmlFor="ms-start" required>
              <Input id="ms-start" name="startDate" type="date" defaultValue={today} required />
            </Field>
            <Field
              label="Duration"
              htmlFor="ms-months"
              hint={`Leave blank to use the configured ${membershipDays}-day term.`}
            >
              <NativeSelect id="ms-months" name="months" defaultValue="">
                <option value="">Default ({membershipDays} days)</option>
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </NativeSelect>
            </Field>
            <Field label={`Amount charged (${currencySymbol})`} htmlFor="ms-price" required>
              <Input
                id="ms-price"
                name="price"
                type="number"
                step="0.01"
                min={0}
                defaultValue={toMajor(defaultPrice)}
                required
              />
            </Field>
            <Field label="Note" htmlFor="ms-note">
              <Input id="ms-note" name="note" placeholder="e.g. paid in cash" />
            </Field>
            <p className="text-xs text-ink-faint">
              Membership fees are recorded separately from gaming sales and appear in the membership report — they are
              not mixed into station revenue.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Add membership
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
