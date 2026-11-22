import {
  BarChart3,
  CalendarClock,
  ChefHat,
  CreditCard,
  DollarSign,
  LayoutDashboard,
  MonitorPlay,
  Settings,
  ShieldCheck,
  Tags,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";

import type { Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
  /** Shown in the phone bottom bar (max 5). */
  primary?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    icon: LayoutDashboard,
    permission: "dashboard.view",
    primary: true,
  },
  {
    href: "/stations",
    label: "Rooms",
    shortLabel: "Rooms",
    icon: MonitorPlay,
    permission: "stations.view",
    primary: true,
  },
  { href: "/pricing", label: "Pricing", shortLabel: "Pricing", icon: Tags, permission: "pricing.view" },
  {
    href: "/members",
    label: "Members",
    shortLabel: "Members",
    icon: UsersRound,
    permission: "members.view",
    primary: true,
  },
  {
    href: "/food",
    label: "Food Menu",
    shortLabel: "Food",
    icon: UtensilsCrossed,
    permission: "food.view",
    primary: true,
  },
  { href: "/kitchen", label: "Kitchen", shortLabel: "Kitchen", icon: ChefHat, permission: "food.view" },
  { href: "/income", label: "Income", shortLabel: "Income", icon: DollarSign, permission: "income.view" },
  {
    href: "/transactions",
    label: "Transactions",
    shortLabel: "Bills",
    icon: CreditCard,
    permission: "transactions.view",
    primary: true,
  },
  { href: "/reports", label: "Reports", shortLabel: "Reports", icon: BarChart3, permission: "reports.view" },
  {
    href: "/reservations",
    label: "Reservations",
    shortLabel: "Bookings",
    icon: CalendarClock,
    permission: "reservations.manage",
  },
  { href: "/staff", label: "Staff / Users", shortLabel: "Staff", icon: ShieldCheck, permission: "staff.manage" },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings, permission: "settings.manage" },
];
