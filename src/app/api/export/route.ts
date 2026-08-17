import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { formatMoneyPlain } from "@/lib/money";
import { can } from "@/lib/permissions";
import { toCsv } from "@/lib/utils";
import {
  getFoodSales,
  getStationIncome,
  listSessionHistory,
  listTransactionsForExport,
  resolveRange,
  type RangePreset,
} from "@/server/services/income";
import { listMembers } from "@/server/services/members";

/**
 * CSV exports.
 *
 * Deliberately server-rendered rather than built in the browser so that only
 * the columns a user is allowed to see ever leave the database. Aadhaar is
 * never exported, in any report, for any role.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "transactions";
  const range = await resolveRange(
    (params.get("preset") as RangePreset) ?? "today",
    params.get("from") ?? undefined,
    params.get("to") ?? undefined,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  let filename = `genz-${type}-${stamp}.csv`;
  let csv = "";

  switch (type) {
    case "transactions": {
      if (!can(user, "transactions.view")) return forbidden();
      const rows = await listTransactionsForExport(range);
      csv = toCsv(
        [
          "Bill",
          "Date",
          "Time",
          "Station",
          "Category",
          "Customer",
          "Customer type",
          "Billed minutes",
          "Gaming",
          "Food",
          "Tax",
          "Discount",
          "Total",
          "Payment method",
          "Cash",
          "UPI",
          "Status",
          "Staff",
        ],
        rows.map((row) => [
          row.code,
          row.createdAt.toISOString().slice(0, 10),
          row.createdAt.toISOString().slice(11, 19),
          row.station,
          row.category,
          row.customerName ?? "Walk-in",
          row.customerType,
          row.billedMinutes,
          formatMoneyPlain(row.gamingAmount),
          formatMoneyPlain(row.foodAmount),
          formatMoneyPlain(row.taxAmount),
          formatMoneyPlain(row.discountAmount),
          formatMoneyPlain(row.totalAmount),
          row.paymentMethod,
          formatMoneyPlain(row.cashAmount),
          formatMoneyPlain(row.upiAmount),
          row.status,
          row.staffName,
        ]),
      );
      break;
    }

    case "income":
    case "stations": {
      if (!can(user, "income.view")) return forbidden();
      const rows = await getStationIncome(range);
      csv = toCsv(
        ["Station", "Category", "Sessions", "Billed minutes", "Gaming", "Food", "Total"],
        rows.map((row) => [
          row.station,
          row.category,
          row.sessions,
          row.minutes,
          formatMoneyPlain(row.gaming),
          formatMoneyPlain(row.food),
          formatMoneyPlain(row.total),
        ]),
      );
      filename = `genz-station-income-${stamp}.csv`;
      break;
    }

    case "food": {
      if (!can(user, "reports.view")) return forbidden();
      const rows = await getFoodSales(range);
      csv = toCsv(
        ["Item", "Orders", "Quantity", "Revenue"],
        rows.map((row) => [row.name, row.orders, row.quantity, formatMoneyPlain(row.revenue)]),
      );
      break;
    }

    case "sessions": {
      if (!can(user, "reports.view")) return forbidden();
      const rows = await listSessionHistory(range, 5000);
      csv = toCsv(
        ["Session", "Station", "Customer", "Type", "Started", "Ended", "Status", "Bill", "Total", "Payment", "Staff"],
        rows.map((row) => [
          row.code,
          row.station,
          row.memberName ?? row.customerName ?? "Walk-in",
          row.customerType,
          row.startedAt.toISOString(),
          row.endedAt?.toISOString() ?? "",
          row.status,
          row.transactionCode ?? "",
          row.total === null ? "" : formatMoneyPlain(row.total),
          row.paymentMethod ?? "",
          row.staffName ?? "",
        ]),
      );
      break;
    }

    case "members": {
      if (!can(user, "members.manage")) return forbidden();
      const rows = await listMembers();
      // Note: Aadhaar (even masked) is intentionally excluded from exports.
      csv = toCsv(
        ["Member ID", "Name", "Mobile", "Membership start", "Membership end", "Status", "Active"],
        rows.map((row) => [
          row.memberCode,
          row.fullName,
          row.mobile,
          row.membershipStart?.toISOString().slice(0, 10) ?? "",
          row.membershipEnd?.toISOString().slice(0, 10) ?? "",
          row.membershipStatus,
          row.isActive ? "Yes" : "No",
        ]),
      );
      break;
    }

    default:
      return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function forbidden() {
  return NextResponse.json({ error: "You do not have permission to export this data." }, { status: 403 });
}
