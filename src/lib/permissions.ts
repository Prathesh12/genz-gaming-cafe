/**
 * Role / permission matrix.
 *
 * Roles give a baseline; individual users can be granted two extra powers
 * (applying discounts, viewing unmasked Aadhaar) from the Staff screen.
 * Every server action re-checks permissions — the sidebar simply hides what a
 * user cannot reach.
 */

export type Role = "ADMIN" | "MANAGER" | "STAFF";

export const PERMISSIONS = [
  "dashboard.view",
  "stations.view",
  "stations.manage",
  "sessions.operate",
  "pricing.view",
  "pricing.manage",
  "members.view",
  "members.manage",
  "members.viewSensitive",
  "food.view",
  "food.manage",
  "checkout.process",
  "discount.apply",
  "income.view",
  "transactions.view",
  "reports.view",
  "reservations.manage",
  "staff.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "stations.view",
  "sessions.operate",
  "pricing.view",
  "members.view",
  "food.view",
  "checkout.process",
  "transactions.view",
  "reservations.manage",
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  "stations.manage",
  "pricing.manage",
  "members.manage",
  "food.manage",
  "discount.apply",
  "income.view",
  "reports.view",
  "audit.view",
];

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  STAFF: STAFF_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Full access, including staff accounts, settings and sensitive member data.",
  MANAGER: "Everything operational plus stations, pricing, menu, members, income and reports.",
  STAFF: "Counter operations: sessions, food orders, payments and their own transactions.",
};

export type PermissionSubject = {
  role: Role;
  canDiscount: boolean;
  maxDiscountPercent: number;
  canViewSensitive: boolean;
};

export function can(user: PermissionSubject | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (permission === "discount.apply") {
    return user.role === "ADMIN" || user.canDiscount || ROLE_PERMISSIONS[user.role].includes(permission);
  }
  if (permission === "members.viewSensitive") {
    return user.role === "ADMIN" && user.canViewSensitive;
  }
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

/** Largest percentage discount this user may apply. */
export function discountCeiling(user: PermissionSubject): number {
  if (user.role === "ADMIN") return 100;
  if (!can(user, "discount.apply")) return 0;
  return Math.min(100, Math.max(0, user.maxDiscountPercent));
}
