"use client";

import { useActionState, useEffect, useState } from "react";

import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/permissions";
import { createStaffAction, updateStaffAction } from "@/server/actions/admin";

type Staff = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  canDiscount: boolean;
  maxDiscountPercent: number;
  canViewSensitive: boolean;
  lastLoginAt: string | null;
};

export function StaffClient({ staff, currentUserId }: { staff: Staff[]; currentUserId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Staff | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-muted">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <p key={role}>
              <span className="font-semibold text-ink">{ROLE_LABELS[role as Role]}:</span> {description}
            </p>
          ))}
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          New account
        </Button>
      </div>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Discounts</TH>
              <TH>Sensitive data</TH>
              <TH>Last sign-in</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {staff.map((member) => (
              <TR key={member.id} className={member.isActive ? "" : "opacity-60"}>
                <TD className="font-medium text-ink">
                  {member.name}
                  {member.id === currentUserId ? <span className="ml-2 text-xs text-gold">(you)</span> : null}
                </TD>
                <TD className="text-ink-muted">{member.email}</TD>
                <TD>
                  <Badge tone={member.role === "ADMIN" ? "gold" : member.role === "MANAGER" ? "info" : "neutral"}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                </TD>
                <TD className="text-ink-muted">
                  {member.role === "ADMIN"
                    ? "Unlimited"
                    : member.canDiscount
                      ? `Up to ${member.maxDiscountPercent}%`
                      : "Not allowed"}
                </TD>
                <TD>
                  {member.role === "ADMIN" && member.canViewSensitive ? (
                    <Badge tone="warn">
                      <ShieldCheck className="size-3" aria-hidden /> Aadhaar
                    </Badge>
                  ) : (
                    <span className="text-ink-faint">Masked only</span>
                  )}
                </TD>
                <TD className="tabular text-ink-muted">
                  {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString("en-IN") : "Never"}
                </TD>
                <TD>
                  <Badge tone={member.isActive ? "ok" : "danger"}>{member.isActive ? "Active" : "Disabled"}</Badge>
                </TD>
                <TD className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(member)} aria-label={`Edit ${member.name}`}>
                    <Pencil />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>

      {editing ? (
        <StaffDialog
          key={editing === "new" ? "new" : editing.id}
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function StaffDialog({
  value,
  onClose,
  onSaved,
}: {
  value: Staff | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = value && value !== "new" ? value : null;
  const [state, formAction, pending] = useActionState(editing ? updateStaffAction : createStaffAction, null);
  // Keyed by account at the call site, so initial state is always correct.
  const [role, setRole] = useState<Role>(editing?.role ?? "STAFF");

  useEffect(() => {
    if (state?.ok) {
      toast.success("Staff account saved");
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
        <DialogHeader title={editing ? `Edit ${editing.name}` : "New staff account"} />
        <DialogForm action={formAction} key={editing?.id ?? "new"}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="s-name" required>
                <Input id="s-name" name="name" defaultValue={editing?.name} required />
              </Field>
              {editing ? (
                <Field label="Email" hint="Email cannot be changed after the account is created.">
                  <Input value={editing.email} readOnly className="opacity-70" />
                </Field>
              ) : (
                <Field
                  label="Email"
                  htmlFor="s-email"
                  required
                  error={state?.ok === false ? state.fieldErrors?.email : undefined}
                >
                  <Input id="s-email" name="email" type="email" required autoComplete="off" />
                </Field>
              )}
              <Field
                label={editing ? "New password" : "Password"}
                htmlFor="s-password"
                required={!editing}
                hint={editing ? "Leave blank to keep the current password." : "At least 8 characters, with a number."}
                error={state?.ok === false ? state.fieldErrors?.password : undefined}
              >
                <Input
                  id="s-password"
                  name="password"
                  type="password"
                  required={!editing}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Role" htmlFor="s-role" required>
                <NativeSelect
                  id="s-role"
                  name="role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                >
                  <option value="STAFF">Staff</option>
                  <option value="MANAGER">Manager</option>
                  <option value="ADMIN">Admin</option>
                </NativeSelect>
              </Field>
            </div>

            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-muted">
              {ROLE_DESCRIPTIONS[role]}
            </p>

            <div className="space-y-3 rounded-lg border border-line p-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="canDiscount"
                  defaultChecked={editing?.canDiscount ?? false}
                  className="size-4 accent-[#F5C518]"
                />
                May apply discounts
              </label>
              <Field label="Maximum discount %" htmlFor="s-discount">
                <Input
                  id="s-discount"
                  name="maxDiscountPercent"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={editing?.maxDiscountPercent ?? 0}
                />
              </Field>
              {role === "ADMIN" ? (
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="canViewSensitive"
                    defaultChecked={editing?.canViewSensitive ?? false}
                    className="mt-0.5 size-4 accent-[#F5C518]"
                  />
                  <span>
                    May reveal full Aadhaar numbers
                    <span className="block text-xs text-ink-faint">
                      Admin only. Every reveal is written to the audit log.
                    </span>
                  </span>
                </label>
              ) : null}
              {editing ? (
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={editing.isActive}
                    className="size-4 accent-[#F5C518]"
                  />
                  Account is active
                </label>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save account
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
