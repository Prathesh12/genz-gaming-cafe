"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Pencil, Plus, PowerOff, RotateCcw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { formatMoney, toMajor } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  saveFoodCategoryAction,
  saveFoodItemAction,
  toggleFoodCategoryAction,
  toggleFoodItemActiveAction,
  toggleFoodItemAvailabilityAction,
} from "@/server/actions/food";
import type { MenuItem } from "@/server/services/food";

type FoodCategory = { id: string; name: string; sortOrder: number; isActive: boolean };

export function FoodClient({
  categories,
  items,
  canManage,
  currencySymbol,
  taxEnabled,
}: {
  categories: FoodCategory[];
  items: MenuItem[];
  canManage: boolean;
  currencySymbol: string;
  taxEnabled: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [itemDialog, setItemDialog] = useState<MenuItem | "new" | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<FoodCategory | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (activeCategory === "ALL" || item.categoryId === activeCategory) &&
        (term === "" || item.name.toLowerCase().includes(term)),
    );
  }, [items, query, activeCategory]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(message);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
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
            placeholder="Search the menu…"
            className="pl-9"
            aria-label="Search menu"
          />
        </div>
        {canManage ? (
          <>
            <Button variant="secondary" onClick={() => setCategoryDialog("new")}>
              <Plus aria-hidden />
              Category
            </Button>
            <Button onClick={() => setItemDialog("new")} disabled={categories.length === 0}>
              <Plus aria-hidden />
              Add food
            </Button>
          </>
        ) : null}
      </div>

      {categories.length > 0 ? (
        <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <Chip label="All items" active={activeCategory === "ALL"} onClick={() => setActiveCategory("ALL")} />
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={`${category.name}${category.isActive ? "" : " (off)"}`}
              active={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
              onEdit={canManage ? () => setCategoryDialog(category) : undefined}
            />
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="The menu is empty"
          description={
            categories.length === 0
              ? "Create a food category first — for example Snacks, Drinks or Combos."
              : "Add burgers, fries, cold drinks and combos so staff can bill them against a session."
          }
          action={
            canManage ? (
              <Button onClick={() => (categories.length === 0 ? setCategoryDialog("new") : setItemDialog("new"))}>
                {categories.length === 0 ? "Create a category" : "Add your first item"}
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((item) => (
            <Card key={item.id} className={cn(item.isActive ? "" : "opacity-60")}>
              <CardContent className="flex h-full flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{item.name}</p>
                    <p className="truncate text-xs text-ink-faint">{item.categoryName}</p>
                  </div>
                  <span className="flex flex-col items-end">
                    <span className="tabular text-lg font-bold text-gold">
                      {formatMoney(item.price, currencySymbol)}
                    </span>
                    {item.memberPrice !== null ? (
                      <span className="tabular text-xs font-semibold text-ok">
                        {formatMoney(item.memberPrice, currencySymbol)} member
                      </span>
                    ) : null}
                  </span>
                </div>

                {item.description ? <p className="line-clamp-2 text-xs text-ink-muted">{item.description}</p> : null}

                <div className="flex flex-wrap gap-1.5">
                  {!item.isActive ? <Badge>Removed</Badge> : item.isAvailable ? (
                    <Badge tone="ok">Available</Badge>
                  ) : (
                    <Badge tone="warn">Unavailable</Badge>
                  )}
                  {taxEnabled && item.taxPercent > 0 ? <Badge>{item.taxPercent}% tax</Badge> : null}
                  {item.prepMinutes ? <Badge>{item.prepMinutes} min prep</Badge> : null}
                </div>

                {canManage ? (
                  <div className="mt-auto flex gap-2 pt-1">
                    <Button variant="secondary" size="sm" onClick={() => setItemDialog(item)} className="flex-1">
                      <Pencil aria-hidden />
                      Edit
                    </Button>
                    {item.isActive ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => toggleFoodItemAvailabilityAction(item.id, !item.isAvailable),
                              item.isAvailable ? "Marked unavailable" : "Marked available",
                            )
                          }
                        >
                          {item.isAvailable ? "Sold out" : "Restock"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          aria-label={`Remove ${item.name}`}
                          onClick={() => run(() => toggleFoodItemActiveAction(item.id, false), "Item removed from menu")}
                        >
                          <PowerOff className="text-danger" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => toggleFoodItemActiveAction(item.id, true), "Item restored")}
                      >
                        <RotateCcw aria-hidden />
                        Restore
                      </Button>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 ? (
            <p className="col-span-full py-8 text-center text-sm text-ink-muted">No items match that search.</p>
          ) : null}
        </div>
      )}

      <ItemDialog
        value={itemDialog}
        categories={categories.filter((category) => category.isActive)}
        currencySymbol={currencySymbol}
        taxEnabled={taxEnabled}
        onClose={() => setItemDialog(null)}
        onSaved={() => router.refresh()}
      />
      <CategoryDialog
        value={categoryDialog}
        onClose={() => setCategoryDialog(null)}
        onSaved={() => router.refresh()}
        onToggle={(category) =>
          run(
            () => toggleFoodCategoryAction(category.id, !category.isActive),
            category.isActive ? "Category hidden" : "Category restored",
          )
        }
      />
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  onEdit,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center rounded-lg border text-sm transition-colors",
        active ? "border-gold bg-gold/15 text-gold" : "border-line bg-surface-2 text-ink-muted hover:text-ink",
      )}
    >
      <button type="button" onClick={onClick} className="px-3 py-1.5 font-medium">
        {label}
      </button>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="px-2 py-1.5 opacity-70 hover:opacity-100" aria-label={`Edit ${label}`}>
          <Pencil className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

function ItemDialog({
  value,
  categories,
  currencySymbol,
  taxEnabled,
  onClose,
  onSaved,
}: {
  value: MenuItem | "new" | null;
  categories: FoodCategory[];
  currencySymbol: string;
  taxEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveFoodItemAction, null);
  const editing = value && value !== "new" ? value : null;

  useEffect(() => {
    if (state?.ok) {
      toast.success("Menu item saved");
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
        <DialogHeader title={editing ? `Edit ${editing.name}` : "Add food item"} />
        <DialogForm action={formAction} key={editing?.id ?? "new"}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="food-name" required error={state?.ok === false ? state.fieldErrors?.name : undefined}>
                <Input id="food-name" name="name" defaultValue={editing?.name} placeholder="Burger" required />
              </Field>
              <Field label="Category" htmlFor="food-category" required>
                <NativeSelect id="food-category" name="categoryId" defaultValue={editing?.categoryId} required>
                  <option value="">Choose a category…</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label={`Price (${currencySymbol})`}
                htmlFor="food-price"
                required
                error={state?.ok === false ? state.fieldErrors?.price : undefined}
              >
                <Input
                  id="food-price"
                  name="price"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={editing ? toMajor(editing.price) : ""}
                  placeholder="150"
                  required
                />
              </Field>
              <Field
                label={`Member price (${currencySymbol})`}
                htmlFor="food-member-price"
                hint="Leave blank if members pay the same as everyone else."
                error={state?.ok === false ? state.fieldErrors?.memberPrice : undefined}
              >
                <Input
                  id="food-member-price"
                  name="memberPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={editing?.memberPrice !== null && editing?.memberPrice !== undefined ? toMajor(editing.memberPrice) : ""}
                  placeholder="Same as normal"
                />
              </Field>
              <Field
                label="Tax %"
                htmlFor="food-tax"
                hint={taxEnabled ? "Applied on the bill." : "Tax is currently disabled in Settings."}
              >
                <Input id="food-tax" name="taxPercent" type="number" min={0} max={50} defaultValue={editing?.taxPercent ?? 0} />
              </Field>
              <Field label="Prep time (min)" htmlFor="food-prep">
                <Input id="food-prep" name="prepMinutes" type="number" min={0} defaultValue={editing?.prepMinutes ?? ""} />
              </Field>
              <Field label="Image URL" htmlFor="food-image" hint="Optional.">
                <Input id="food-image" name="imageUrl" defaultValue={editing?.imageUrl ?? ""} placeholder="https://…" />
              </Field>
            </div>
            <Field label="Description" htmlFor="food-desc">
              <Textarea id="food-desc" name="description" defaultValue={editing?.description ?? ""} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="isAvailable"
                defaultChecked={editing ? editing.isAvailable : true}
                className="size-4 accent-[#F5C518]"
              />
              Available to order right now
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save item
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({
  value,
  onClose,
  onSaved,
  onToggle,
}: {
  value: FoodCategory | "new" | null;
  onClose: () => void;
  onSaved: () => void;
  onToggle: (category: FoodCategory) => void;
}) {
  const [state, formAction, pending] = useActionState(saveFoodCategoryAction, null);
  const editing = value && value !== "new" ? value : null;

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
        <DialogHeader title={editing ? `Edit ${editing.name}` : "New food category"} />
        <DialogForm action={formAction} key={editing?.id ?? "new"}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="fc-name" required>
              <Input id="fc-name" name="name" defaultValue={editing?.name} placeholder="Snacks" required />
            </Field>
            <Field label="Sort order" htmlFor="fc-sort">
              <Input id="fc-sort" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
            </Field>
            {editing ? (
              <Button
                type="button"
                variant={editing.isActive ? "outline" : "secondary"}
                onClick={() => {
                  onToggle(editing);
                  onClose();
                }}
              >
                {editing.isActive ? "Hide this category" : "Restore this category"}
              </Button>
            ) : null}
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
