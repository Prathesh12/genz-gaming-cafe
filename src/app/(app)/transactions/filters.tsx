"use client";

import { useEffect, useState } from "react";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input, NativeSelect } from "@/components/ui/field";
import { useDebounced } from "@/hooks/use-live";

export function TransactionFilters({
  stations,
}: {
  stations: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const debounced = useDebounced(search, 350);

  function apply(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== "ALL") params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    const current = searchParams.get("search") ?? "";
    if (debounced !== current) apply({ search: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <div className="relative lg:col-span-2">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Bill number, customer or station…"
          className="pl-9"
          aria-label="Search transactions"
        />
      </div>
      <NativeSelect
        value={searchParams.get("paymentMethod") ?? "ALL"}
        onChange={(event) => apply({ paymentMethod: event.target.value })}
        aria-label="Payment method"
      >
        <option value="ALL">All payment methods</option>
        <option value="CASH">Cash</option>
        <option value="UPI">UPI</option>
        <option value="SPLIT">Split</option>
      </NativeSelect>
      <NativeSelect
        value={searchParams.get("stationId") ?? "ALL"}
        onChange={(event) => apply({ stationId: event.target.value })}
        aria-label="Room"
      >
        <option value="ALL">All stations</option>
        {stations.map((station) => (
          <option key={station.id} value={station.id}>
            {station.code} — {station.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        value={searchParams.get("status") ?? "ALL"}
        onChange={(event) => apply({ status: event.target.value })}
        aria-label="Status"
      >
        <option value="ALL">All statuses</option>
        <option value="COMPLETED">Completed</option>
        <option value="VOID">Void</option>
        <option value="REFUNDED">Refunded</option>
      </NativeSelect>
    </div>
  );
}
