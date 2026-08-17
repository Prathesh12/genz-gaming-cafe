"use client";

import { useState, useTransition } from "react";

import { Ban, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { deleteTransactionAction, voidTransactionAction } from "@/server/actions/checkout";

/**
 * Voiding is the correction path for a mistaken bill. The row is kept — it just
 * stops counting towards income — and the reason is written to the audit log,
 * so the money trail is never edited or deleted.
 */
/**
 * Permanent removal, offered only once a bill has been voided and only to an
 * admin. Two deliberate steps mean a real sale cannot vanish by accident.
 */
export function DeleteTransactionButton({ transactionId, code }: { transactionId: string; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        Delete permanently
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${code} for good?`}
        destructive
        loading={pending}
        confirmLabel="Delete permanently"
        description="The bill and its payment records are erased and cannot be recovered. The activity log keeps a note that it was deleted, by whom and when."
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteTransactionAction(transactionId);
            if (result.ok) {
              toast.success("Bill deleted");
              router.push("/transactions");
            } else {
              toast.error(result.error);
            }
          })
        }
      />
    </>
  );
}

export function VoidButton({ transactionId, code }: { transactionId: string; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Ban aria-hidden />
        Void bill
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setReason("");
        }}
        title={`Void ${code}?`}
        destructive
        loading={pending}
        confirmLabel="Void this bill"
        description={
          <div className="space-y-3">
            <p>
              The bill stays in the records for the audit trail but is removed from income and
              reports. Use this for a wrong amount or a duplicate charge.
            </p>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (required)"
              aria-label="Reason for voiding"
            />
          </div>
        }
        onConfirm={() => {
          if (reason.trim().length < 3) {
            toast.error("Enter a reason before voiding a bill.");
            return;
          }
          startTransition(async () => {
            const result = await voidTransactionAction(transactionId, reason);
            if (result.ok) {
              toast.success("Bill voided");
              setOpen(false);
              setReason("");
              router.refresh();
            } else {
              toast.error(result.error);
            }
          });
        }}
      />
    </>
  );
}
