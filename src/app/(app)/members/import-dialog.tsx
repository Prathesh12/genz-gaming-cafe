"use client";

import { useRef, useState, useTransition } from "react";

import { CheckCircle2, FileSpreadsheet, TriangleAlert, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/ui/field";
import { IMPORT_FIELDS, type ColumnMapping, type DateOrder, type ImportField } from "@/lib/member-import";
import {
  importMembersAction,
  previewMemberImportAction,
  type ImportPreview,
} from "@/server/actions/members";
import type { ImportOutcome } from "@/server/services/member-import";

/** Plain names for the fields, in the order a person would look for them. */
const FIELD_LABELS: Record<ImportField, string> = {
  fullName: "Name",
  mobile: "Mobile number",
  membershipStart: "Membership start date",
  membershipEnd: "Membership expiry date",
  dateOfBirth: "Date of birth",
  aadhaar: "Aadhaar number",
  price: "Amount paid",
  address: "Address",
  notes: "Notes",
};

const REQUIRED: ImportField[] = ["fullName", "mobile"];

export function ImportMembersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [fileName, setFileName] = useState<string | null>(null);
  /** Kept so the mapping can be changed without asking for the file again. */
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  function reset() {
    setFileName(null);
    setText(null);
    setPreview(null);
    setOutcome(null);
  }

  function look(source: string, overrides?: { mapping?: ColumnMapping; dateOrder?: DateOrder }) {
    startTransition(async () => {
      const result = await previewMemberImportAction(source, overrides);
      if (result.ok) {
        setPreview(result.data);
      } else {
        setPreview(null);
        toast.error(result.error);
      }
    });
  }

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("That file is very large. Export just the membership list and try again.");
      return;
    }
    startTransition(async () => {
      const source = await file.text();
      setFileName(file.name);
      setText(source);
      setOutcome(null);
      look(source);
    });
  }

  function remap(field: ImportField, column: string) {
    if (!text || !preview) return;
    const mapping: ColumnMapping = { ...preview.mapping };
    if (column === "") delete mapping[field];
    else mapping[field] = Number(column);
    look(text, { mapping, dateOrder: preview.dateOrder });
  }

  function setDateOrder(order: DateOrder) {
    if (!text || !preview) return;
    look(text, { mapping: preview.mapping, dateOrder: order });
  }

  function commit() {
    if (!text || !preview) return;
    startTransition(async () => {
      const result = await importMembersAction(text, {
        mapping: preview.mapping,
        dateOrder: preview.dateOrder,
      });
      if (result.ok) {
        setOutcome(result.data);
        toast.success(`${result.data.imported} members imported`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const missingRequired = preview
    ? REQUIRED.filter((field) => preview.mapping[field] === undefined)
    : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader
          title="Import members from a sheet"
          description="Bring across a membership list you already keep in Google Sheets or Excel."
        />

        <DialogBody className="space-y-4">
          {/* ------------------------- After importing ------------------------ */}
          {outcome ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
                <div>
                  <p className="font-semibold text-ink">
                    {outcome.imported} {outcome.imported === 1 ? "member" : "members"} imported
                  </p>
                  <p className="text-sm text-ink-muted">
                    {outcome.withMembership} of them came across with a membership term from your sheet.
                  </p>
                </div>
              </div>

              <ReportList
                title={`Already on file — left unchanged (${outcome.duplicates.length})`}
                rows={outcome.duplicates.map((row) => `Line ${row.line}: ${row.name} · ${row.mobile}`)}
              />
              <ReportList
                title={`Not imported (${outcome.rejected.length})`}
                tone="danger"
                rows={outcome.rejected.map((row) => `Line ${row.line}: ${row.reason}`)}
              />
              <ReportList
                title={`Imported with something missing (${outcome.warnings.length})`}
                tone="warn"
                rows={outcome.warnings.map((row) => `Line ${row.line}, ${row.name}: ${row.issues.join("; ")}`)}
              />
            </div>
          ) : (
            <>
              {/* ------------------------- Choose a file ----------------------- */}
              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <p className="mb-1 text-sm font-semibold text-ink">Getting the file out of Google Sheets</p>
                <p className="text-xs text-ink-muted">
                  Open your sheet, then <strong>File → Download → Comma-separated values (.csv)</strong>. Pick
                  that downloaded file here. The first row of the sheet should be the column headings.
                </p>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                className="sr-only"
                onChange={(event) => {
                  pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => inputRef.current?.click()} loading={pending}>
                  <Upload aria-hidden />
                  {fileName ? "Choose a different file" : "Choose your CSV file"}
                </Button>
                {fileName ? (
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
                    <FileSpreadsheet className="size-4 shrink-0 text-ink-faint" aria-hidden />
                    <span className="truncate">{fileName}</span>
                  </span>
                ) : null}
              </div>

              {/* --------------------------- Preview --------------------------- */}
              {preview ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Count label="Ready to import" value={preview.ready} tone="ok" />
                    <Count label="Already members" value={preview.duplicates.length} />
                    <Count label="Cannot be imported" value={preview.rejected.length} tone="danger" />
                  </div>

                  {/* Dates are the easiest thing to get silently wrong. */}
                  {preview.mapping.membershipStart !== undefined ||
                  preview.mapping.membershipEnd !== undefined ||
                  preview.mapping.dateOfBirth !== undefined ? (
                    <Field
                      label="How your dates are being read"
                      htmlFor="dateOrder"
                      hint={
                        preview.dateOrderCertain
                          ? "Your sheet contains a date that could only be read one way, so this is certain."
                          : "Every date in your sheet works either way, so please check this is right."
                      }
                    >
                      <NativeSelect
                        id="dateOrder"
                        value={preview.dateOrder}
                        onChange={(event) => setDateOrder(event.target.value as DateOrder)}
                      >
                        <option value="DMY">Day first — 05/09/2026 means 5 September</option>
                        <option value="MDY">Month first — 05/09/2026 means 9 May</option>
                      </NativeSelect>
                    </Field>
                  ) : null}

                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                      Which column is which
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {IMPORT_FIELDS.map((field) => (
                        <Field
                          key={field}
                          label={FIELD_LABELS[field]}
                          htmlFor={`map-${field}`}
                          required={REQUIRED.includes(field)}
                        >
                          <NativeSelect
                            id={`map-${field}`}
                            value={preview.mapping[field] ?? ""}
                            onChange={(event) => remap(field, event.target.value)}
                          >
                            <option value="">Not in my sheet</option>
                            {preview.headers.map((header, index) => (
                              <option key={`${header}-${index}`} value={index}>
                                {header || `Column ${index + 1}`}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                      ))}
                    </div>
                  </div>

                  {preview.sample.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-line">
                      <p className="border-b border-line px-3 py-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                        The first few, as they will be saved
                      </p>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-line">
                          {preview.sample.map((row) => (
                            <tr key={row.line}>
                              <td className="px-3 py-2 text-ink">{row.fullName}</td>
                              <td className="px-3 py-2 text-ink-muted">{row.mobile}</td>
                              <td className="px-3 py-2 text-right text-xs text-ink-faint">
                                {row.end ? `expires ${row.end}` : "no expiry date"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <ReportList
                    title={`Will not be imported (${preview.rejected.length})`}
                    tone="danger"
                    rows={preview.rejected.map((row) => `Line ${row.line}: ${row.reason}`)}
                  />
                  <ReportList
                    title={`Will be imported with something missing (${preview.warnings.length})`}
                    tone="warn"
                    rows={preview.warnings.map((row) => `Line ${row.line}, ${row.name}: ${row.issues.join("; ")}`)}
                  />

                  {missingRequired.length > 0 ? (
                    <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      Choose which column holds the {missingRequired.map((f) => FIELD_LABELS[f].toLowerCase()).join(" and the ")}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {outcome ? "Done" : "Cancel"}
          </Button>
          {outcome ? null : (
            <Button
              onClick={commit}
              loading={pending}
              disabled={!preview || preview.ready === 0 || missingRequired.length > 0}
            >
              {preview ? `Import ${preview.ready} members` : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "ok" | "danger" }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p
        className={
          tone === "ok" && value > 0
            ? "tabular text-2xl font-bold text-ok"
            : tone === "danger" && value > 0
              ? "tabular text-2xl font-bold text-danger"
              : "tabular text-2xl font-bold text-ink"
        }
      >
        {value}
      </p>
    </div>
  );
}

/** A collapsed list — a 500-row import can produce a lot of lines. */
function ReportList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: string[];
  tone?: "danger" | "warn";
}) {
  if (rows.length === 0) return null;
  return (
    <details className="rounded-lg border border-line">
      <summary
        className={
          tone === "danger"
            ? "cursor-pointer px-3 py-2 text-sm font-semibold text-danger"
            : tone === "warn"
              ? "cursor-pointer px-3 py-2 text-sm font-semibold text-warn"
              : "cursor-pointer px-3 py-2 text-sm font-semibold text-ink"
        }
      >
        {title}
      </summary>
      <ul className="scrollbar-slim max-h-56 space-y-1 overflow-y-auto border-t border-line px-3 py-2 text-xs text-ink-muted">
        {rows.map((row, index) => (
          <li key={index}>{row}</li>
        ))}
      </ul>
    </details>
  );
}
