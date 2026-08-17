"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { ArrowLeft, Pencil, Plus, PowerOff, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge, StationStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ColorField, Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ActionResult } from "@/lib/errors";
import {
  deleteStationAction,
  saveStationAction,
  saveStationCategoryAction,
  toggleStationActiveAction,
  toggleStationCategoryAction,
} from "@/server/actions/stations";

type Category = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  maxPlayers: number;
  sortOrder: number;
  isActive: boolean;
};

/**
 * Ready-made colour schemes for station cards. Picking one fills in both
 * colours; the pickers underneath stay available for anything custom.
 */
const COLOUR_PRESETS: { name: string; from: string; to: string }[] = [
  { name: "Gold", from: "#F5C518", to: "#FF9D00" },
  { name: "Ocean", from: "#22D3EE", to: "#6366F1" },
  { name: "Violet", from: "#8B5CF6", to: "#EC4899" },
  { name: "Emerald", from: "#22C55E", to: "#14B8A6" },
  { name: "Sunset", from: "#F97316", to: "#EF4444" },
  { name: "Rose", from: "#F43F5E", to: "#A855F7" },
  { name: "Ice", from: "#38BDF8", to: "#0EA5E9" },
  { name: "Lime", from: "#A3E635", to: "#22C55E" },
  { name: "Ember", from: "#FBBF24", to: "#DC2626" },
  { name: "Steel", from: "#94A3B8", to: "#475569" },
  { name: "Neon", from: "#00E5FF", to: "#7C3AED" },
  { name: "Magma", from: "#FF4D4D", to: "#7C2D12" },
];

type Station = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  color: string;
  colorStyle: "SOLID" | "GRADIENT";
  colorAccent: string;
  description: string | null;
  status: string;
  sortOrder: number;
  isActive: boolean;
};

export function ManageClient({ categories, stations }: { categories: Category[]; stations: Station[] }) {
  const router = useRouter();
  const [categoryDialog, setCategoryDialog] = useState<Category | "new" | null>(null);
  const [stationDialog, setStationDialog] = useState<Station | "new" | null>(null);
  const [deleting, setDeleting] = useState<Station | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(action: () => Promise<ActionResult<undefined>>, message: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label="Back to stations">
          <Link href="/stations">
            <ArrowLeft />
          </Link>
        </Button>
        <p className="text-sm text-ink-muted">
          Categories and stations are fully configurable — nothing here is hard-coded.
        </p>
      </div>

      {/* ----------------------------- Categories ----------------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Station categories</CardTitle>
          <Button size="sm" onClick={() => setCategoryDialog("new")}>
            <Plus aria-hidden />
            New category
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {categories.length === 0 ? (
            <EmptyState
              className="m-4 border-0"
              title="No categories yet"
              description="Create categories such as Gaming PC, PS5 Multiplayer, F1 Simulator or VR."
            />
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Colour</TH>
                    <TH>Players</TH>
                    <TH>Stations</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {categories.map((category) => {
                    const count = stations.filter((station) => station.categoryId === category.id).length;
                    return (
                      <TR key={category.id}>
                        <TD>
                          <span className="font-medium text-ink">{category.name}</span>
                          {category.description ? (
                            <span className="block text-xs text-ink-faint">{category.description}</span>
                          ) : null}
                        </TD>
                        <TD>
                          <span className="flex items-center gap-2">
                            <span
                              className="size-4 rounded border border-line"
                              style={{ backgroundColor: category.color }}
                              aria-hidden
                            />
                            <span className="font-mono text-xs text-ink-muted">{category.color.toUpperCase()}</span>
                          </span>
                        </TD>
                        <TD className="tabular">
                          {category.maxPlayers > 1 ? `Up to ${category.maxPlayers}` : "1"}
                        </TD>
                        <TD className="tabular">{count}</TD>
                        <TD>
                          <Badge tone={category.isActive ? "ok" : "neutral"}>
                            {category.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setCategoryDialog(category)} aria-label={`Edit ${category.name}`}>
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pending}
                              onClick={() =>
                                toggle(
                                  () => toggleStationCategoryAction(category.id, !category.isActive),
                                  category.isActive ? "Category deactivated" : "Category reactivated",
                                )
                              }
                              aria-label={category.isActive ? `Deactivate ${category.name}` : `Reactivate ${category.name}`}
                            >
                              {category.isActive ? <PowerOff className="text-danger" /> : <RotateCcw />}
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------ Stations ------------------------------ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Stations</CardTitle>
          <Button size="sm" onClick={() => setStationDialog("new")} disabled={categories.length === 0}>
            <Plus aria-hidden />
            New station
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {stations.length === 0 ? (
            <EmptyState
              className="m-4 border-0"
              title="No stations yet"
              description={
                categories.length === 0
                  ? "Create a category first, then add your PCs and consoles."
                  : "Add PC-01, PS5-01, F1-01 and the rest of your floor."
              }
            />
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Code</TH>
                    <TH>Name</TH>
                    <TH>Category</TH>
                    <TH>Colour</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {stations.map((station) => (
                    <TR key={station.id} className={station.isActive ? "" : "opacity-60"}>
                      <TD className="font-semibold text-ink">{station.code}</TD>
                      <TD>{station.name}</TD>
                      <TD className="text-ink-muted">{station.categoryName}</TD>
                      <TD>
                        <span
                          className="inline-block h-4 w-8 rounded border border-line align-middle"
                          style={
                            station.colorStyle === "GRADIENT"
                              ? {
                                  backgroundImage: `linear-gradient(90deg, ${station.color}, ${station.colorAccent})`,
                                }
                              : { backgroundColor: station.color }
                          }
                          aria-label={station.colorStyle === "GRADIENT" ? "Gradient" : station.color}
                        />
                      </TD>
                      <TD>
                        {station.isActive ? <StationStatusBadge status={station.status} /> : <Badge>Inactive</Badge>}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setStationDialog(station)} aria-label={`Edit ${station.code}`}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() =>
                              toggle(
                                () => toggleStationActiveAction(station.id, !station.isActive),
                                station.isActive ? "Station deactivated" : "Station reactivated",
                              )
                            }
                            aria-label={station.isActive ? `Deactivate ${station.code}` : `Reactivate ${station.code}`}
                            title={station.isActive ? "Deactivate (keeps history)" : "Reactivate"}
                          >
                            {station.isActive ? <PowerOff className="text-danger" /> : <RotateCcw />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() => setDeleting(station)}
                            aria-label={`Delete ${station.code}`}
                            title="Delete permanently"
                          >
                            <Trash2 className="text-danger" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code ?? ""} permanently?`}
        destructive
        loading={pending}
        confirmLabel="Delete station"
        description={
          <span>
            This removes the station completely. It only works if the station has never hosted a session — once it
            has, its bills must stay linked to it, so use <strong>Deactivate</strong> instead. Deactivated stations
            disappear from the board but keep your income history intact.
          </span>
        }
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const result = await deleteStationAction(deleting.id);
            if (result.ok) {
              toast.success(`${deleting.code} deleted`);
              router.refresh();
              setDeleting(null);
            } else {
              toast.error(result.error);
            }
          });
        }}
      />

      {categoryDialog ? (
        <CategoryDialog
          key={categoryDialog === "new" ? "new" : categoryDialog.id}
          value={categoryDialog}
          onClose={() => setCategoryDialog(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
      {stationDialog ? (
        <StationDialog
          key={stationDialog === "new" ? "new" : stationDialog.id}
          value={stationDialog}
          categories={categories.filter((category) => category.isActive)}
          onClose={() => setStationDialog(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  value,
  onClose,
  onSaved,
}: {
  value: Category | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveStationCategoryAction, null);
  const editing = value && value !== "new" ? value : null;
  // The dialog is keyed by the row it edits, so plain initial state is correct.
  const [color, setColor] = useState(editing?.color ?? "#F5C518");

  useEffect(() => {
    if (state?.ok) {
      toast.success("Category saved");
      onSaved();
      onClose();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={Boolean(value)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title={editing ? `Edit ${editing.name}` : "New station category"} />
        <DialogForm action={formAction} key={editing?.id ?? "new"}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="color" value={color} />
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="cat-name" required error={state?.ok === false ? state.fieldErrors?.name : undefined}>
              <Input id="cat-name" name="name" defaultValue={editing?.name} placeholder="Gaming PC" required />
            </Field>
            <Field label="Description" htmlFor="cat-desc">
              <Textarea id="cat-desc" name="description" defaultValue={editing?.description ?? ""} />
            </Field>
            <Field label="Colour" hint="Used for the category chip on the board.">
              <ColorField value={color} onChange={setColor} />
            </Field>
            <Field
              label="Players per station"
              htmlFor="cat-players"
              hint="Leave at 1 for a single-seat PC. Set 4 for PS5 multiplayer and the counter can add each player and charge them their own rate."
              error={state?.ok === false ? state.fieldErrors?.maxPlayers : undefined}
            >
              <Input
                id="cat-players"
                name="maxPlayers"
                type="number"
                defaultValue={editing?.maxPlayers ?? 1}
                min={1}
                max={12}
              />
            </Field>
            <Field label="Sort order" htmlFor="cat-sort" hint="Lower numbers appear first.">
              <Input id="cat-sort" name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} min={0} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save category
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function StationDialog({
  value,
  categories,
  onClose,
  onSaved,
}: {
  value: Station | "new" | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveStationAction, null);
  const editing = value && value !== "new" ? value : null;
  const [color, setColor] = useState(editing?.color ?? "#F5C518");
  const [colorStyle, setColorStyle] = useState<"SOLID" | "GRADIENT">(editing?.colorStyle ?? "SOLID");
  const [colorAccent, setColorAccent] = useState(editing?.colorAccent ?? "#FF8A00");

  useEffect(() => {
    if (state?.ok) {
      toast.success("Station saved");
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
        <DialogHeader title={editing ? `Edit ${editing.code}` : "New station"} />
        <DialogForm action={formAction} key={editing?.id ?? "new"}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="color" value={color} />
          <input type="hidden" name="colorStyle" value={colorStyle} />
          <input type="hidden" name="colorAccent" value={colorAccent} />
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Code"
                htmlFor="station-code"
                required
                hint="Short and unique, e.g. PC-01"
                error={state?.ok === false ? state.fieldErrors?.code : undefined}
              >
                <Input id="station-code" name="code" defaultValue={editing?.code} placeholder="PC-01" required />
              </Field>
              <Field label="Display name" htmlFor="station-name" required>
                <Input id="station-name" name="name" defaultValue={editing?.name} placeholder="Gaming PC 1" required />
              </Field>
            </div>
            <Field label="Category" htmlFor="station-category" required>
              <NativeSelect id="station-category" name="categoryId" defaultValue={editing?.categoryId} required>
                <option value="">Choose a category…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Colour scheme" hint="Tap one to apply it, or set your own colours below.">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {COLOUR_PRESETS.map((preset) => {
                  const active =
                    color.toUpperCase() === preset.from &&
                    (colorStyle === "SOLID" || colorAccent.toUpperCase() === preset.to);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      title={preset.name}
                      aria-label={preset.name}
                      aria-pressed={active}
                      onClick={() => {
                        setColor(preset.from);
                        setColorAccent(preset.to);
                        setColorStyle("GRADIENT");
                      }}
                      className={
                        active
                          ? "h-10 rounded-lg ring-2 ring-gold ring-offset-2 ring-offset-surface"
                          : "h-10 rounded-lg border border-line hover:border-line-strong"
                      }
                      style={{ backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                    />
                  );
                })}
              </div>
            </Field>

            <Field label="Colour style" hint="How the strip across the top of the station card is filled.">
              <div className="grid grid-cols-2 gap-2">
                {(["SOLID", "GRADIENT"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setColorStyle(option)}
                    aria-pressed={colorStyle === option}
                    className={
                      colorStyle === option
                        ? "rounded-lg border border-gold bg-gold/15 px-3 py-2 text-sm font-semibold text-gold"
                        : "rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-muted hover:text-ink"
                    }
                  >
                    {option === "SOLID" ? "Solid colour" : "Gradient"}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={colorStyle === "GRADIENT" ? "Gradient — start" : "Colour"}>
              <ColorField value={color} onChange={setColor} />
            </Field>

            {colorStyle === "GRADIENT" ? (
              <Field label="Gradient — end">
                <ColorField value={colorAccent} onChange={setColorAccent} />
              </Field>
            ) : null}

            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">Preview</p>
              <div className="overflow-hidden rounded-lg border border-line">
                <div
                  className="h-2 w-full"
                  style={
                    colorStyle === "GRADIENT"
                      ? { backgroundImage: `linear-gradient(90deg, ${color} 0%, ${colorAccent} 100%)` }
                      : { backgroundColor: color }
                  }
                />
                <div className="bg-surface-2 px-3 py-2 text-sm text-ink-muted">how the card will look</div>
              </div>
            </div>
            <Field label="Description" htmlFor="station-desc">
              <Textarea
                id="station-desc"
                name="description"
                defaultValue={editing?.description ?? ""}
                placeholder="RTX 4060 · 27″ 165Hz"
              />
            </Field>
            <Field label="Sort order" htmlFor="station-sort" hint="Controls the order on the board.">
              <Input id="station-sort" name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} min={0} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save station
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
