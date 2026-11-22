"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatMoney } from "@/lib/money";

/**
 * Charts stay deliberately plain: one accent colour (gold) for the value that
 * matters, muted grid lines, and every number also available as text
 * elsewhere on the page so the data never depends on colour alone.
 */

const AXIS = { stroke: "#71717a", fontSize: 11 };
const GRID = "#262626";

function shortMoney(minorUnits: number, currencyCode = "EGP") {
  const amount = minorUnits / 100;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}m ${currencyCode}`;
  if (amount >= 1000) return `${Math.round(amount / 1000)}k ${currencyCode}`;
  return `${Math.round(amount)} ${currencyCode}`;
}

function TooltipBox({
  active,
  payload,
  label,
  currencySymbol,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[];
  label?: string;
  currencySymbol: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="tabular flex items-center gap-2 text-ink-muted">
          <span className="size-2 rounded-full" style={{ background: entry.color }} aria-hidden />
          {entry.name}: <span className="font-semibold text-ink">{formatMoney(entry.value ?? 0, currencySymbol)}</span>
        </p>
      ))}
    </div>
  );
}

export function HourlyRevenueChart({
  data,
  currencySymbol,
}: {
  data: { label: string; total: number; sessions: number }[];
  currencySymbol: string;
}) {
  const peak = Math.max(...data.map((point) => point.total), 0);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={2} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(value) => shortMoney(value, currencySymbol)} />
        <Tooltip
          cursor={{ fill: "rgba(245,197,24,0.08)" }}
          content={<TooltipBox currencySymbol={currencySymbol} />}
        />
        <Bar dataKey="total" name="Revenue" radius={[3, 3, 0, 0]}>
          {data.map((point) => (
            // The busiest hour is highlighted; quieter hours recede.
            <Cell key={point.label} fill={point.total === peak && peak > 0 ? "#F5C518" : "#5c4a0a"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyRevenueChart({
  data,
  currencySymbol,
}: {
  data: { label: string; gaming: number; food: number; total: number }[];
  currencySymbol: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(value) => shortMoney(value, currencySymbol)} />
        <Tooltip content={<TooltipBox currencySymbol={currencySymbol} />} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
        <Line type="monotone" dataKey="total" name="Total" stroke="#F5C518" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="gaming" name="Gaming" stroke="#a1a1aa" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="food" name="Food" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CategoryRevenueChart({
  data,
  currencySymbol,
}: {
  data: { category: string; total: number }[];
  currencySymbol: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => shortMoney(value, currencySymbol)}
        />
        <YAxis type="category" dataKey="category" tick={AXIS} tickLine={false} axisLine={false} width={110} />
        <Tooltip cursor={{ fill: "rgba(245,197,24,0.08)" }} content={<TooltipBox currencySymbol={currencySymbol} />} />
        <Bar dataKey="total" name="Revenue" fill="#F5C518" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
