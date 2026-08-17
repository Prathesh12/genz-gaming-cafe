"use client";

import { useEffect, useState } from "react";

import { BadgeCheck, Search, TriangleAlert, UserRound, X } from "lucide-react";

import { Input } from "@/components/ui/field";
import { useDebounced } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { searchMembersAction } from "@/server/actions/sessions";

export type MemberHit = {
  id: string;
  memberCode: string;
  fullName: string;
  mobile: string;
  validUntil: string | null;
  membershipStatus: "ACTIVE" | "EXPIRING" | "EXPIRED" | "NONE";
  daysRemaining: number | null;
};

/** A lapsed membership is not an error — that player simply pays regular rates. */
export function isLapsed(member: MemberHit | null): boolean {
  return !member || member.membershipStatus === "EXPIRED" || member.membershipStatus === "NONE";
}

export function formatValidUntil(member: MemberHit): string {
  if (!member.validUntil) return "—";
  return new Date(member.validUntil).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Search-and-select one member.
 *
 * Used once on a single-seat station and once per seat on a shared one, which
 * is why `excludeIds` exists: a member already sitting in another seat is
 * filtered out of the results so nobody can be added to the same session twice.
 */
export function MemberPicker({
  value,
  onChange,
  excludeIds = [],
  placeholder = "Search members…",
  inputId,
  autoFocus,
}: {
  value: MemberHit | null;
  onChange: (member: MemberHit | null) => void;
  excludeIds?: string[];
  placeholder?: string;
  inputId?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MemberHit[]>([]);
  const debouncedQuery = useDebounced(query, 250);

  useEffect(() => {
    let cancelled = false;
    if (debouncedQuery.trim().length < 2 || value) return;

    void searchMembersAction(debouncedQuery).then((result) => {
      if (!cancelled && result.ok) setHits(result.data as MemberHit[]);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, value]);

  if (value) {
    const lapsed = isLapsed(value);
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border px-3 py-2.5",
          lapsed ? "border-line bg-surface-2" : "border-gold/40 bg-gold/5",
        )}
      >
        <BadgeCheck className={cn("mt-0.5 size-5 shrink-0", lapsed ? "text-ink-faint" : "text-gold")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{value.fullName}</p>
          <p className="text-xs text-ink-muted">
            {value.memberCode}
            {value.mobile ? ` · ${value.mobile}` : ""}
          </p>
          {lapsed ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-danger">
              <TriangleAlert className="size-3.5" aria-hidden />
              Membership expired — regular pricing
            </p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-ok">
              Member pricing · valid until {formatValidUntil(value)}
              {value.daysRemaining !== null && value.daysRemaining <= 30
                ? ` (${value.daysRemaining} days left)`
                : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
            setHits([]);
          }}
          className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-ink"
          aria-label={`Clear ${value.fullName}`}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const visible = hits.filter((hit) => !excludeIds.includes(hit.id));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
        <Input
          id={inputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="pl-9"
          autoComplete="off"
          autoFocus={autoFocus}
        />
      </div>

      {query.trim().length >= 2 && visible.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {visible.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(hit);
                  setQuery("");
                  setHits([]);
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <UserRound className="size-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{hit.fullName}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {hit.memberCode} · {hit.mobile}
                  </span>
                </span>
                <span
                  className={
                    isLapsed(hit) ? "text-xs font-semibold text-danger" : "text-xs font-semibold text-ok"
                  }
                >
                  {isLapsed(hit) ? "Expired" : "Active"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {query.trim().length >= 2 && visible.length === 0 && hits.length > 0 ? (
        <p className="text-xs text-ink-faint">Everyone matching that is already on this station.</p>
      ) : null}
    </div>
  );
}
