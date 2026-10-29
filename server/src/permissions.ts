import { forbidden } from "./errors.js";

export type CustomerPermission = "customers.read" | "customers.create" | "customers.update" | "customers.archive";
export const customerPermissions: readonly CustomerPermission[] = ["customers.read", "customers.create", "customers.update", "customers.archive"];
export const operationalPermissions = ["products.read", "products.create", "products.update", "products.archive", "products.cost.read", "stock.read", "stock.receive", "sales.read", "sales.create", "sales.deliver", "sales.discount", "orders.read", "orders.create", "orders.update", "orders.advance", "orders.deliver", "purchases.read", "purchases.import", "purchases.receive", "audit.read"] as const;
export type OperationalPermission = typeof operationalPermissions[number];
export const financePermissions = ["finance.read", "finance.agreements.create", "finance.receive", "finance.accounts.manage", "finance.cash.manage"] as const;
export type AssignablePermission = CustomerPermission | OperationalPermission | typeof financePermissions[number];
export type Permission = AssignablePermission | "team.read" | "team.manage";
export type PermissionOverrides = Partial<Record<AssignablePermission, boolean>>;
export const assignablePermissions: readonly AssignablePermission[] = [...customerPermissions, ...operationalPermissions, ...financePermissions];
export const permissionDependencies: Partial<Record<AssignablePermission, readonly AssignablePermission[]>> = {
  "customers.create": ["customers.read"], "customers.update": ["customers.read"], "customers.archive": ["customers.read", "customers.update"],
  "products.create": ["products.read"], "products.update": ["products.read"], "products.archive": ["products.read", "products.update"], "products.cost.read": ["products.read"],
  "stock.read": ["products.read"], "stock.receive": ["stock.read"],
  "sales.read": ["products.read", "customers.read"], "sales.create": ["sales.read", "stock.read"], "sales.deliver": ["sales.read", "stock.read"],
  "sales.discount": ["sales.create"],
  "orders.read": ["customers.read"], "orders.create": ["orders.read"], "orders.update": ["orders.read"], "orders.advance": ["orders.read"], "orders.deliver": ["orders.read"],
  "purchases.read": ["products.read", "products.cost.read"], "purchases.import": ["purchases.read"], "purchases.receive": ["purchases.read", "stock.receive"],
  "finance.agreements.create": ["finance.read", "customers.read"], "finance.receive": ["finance.read", "customers.read"],
  "finance.accounts.manage": ["finance.read"], "finance.cash.manage": ["finance.read"],
};

export function permissionsForRole(role: string, overrides: unknown = {}): Permission[] {
  if (role === "owner") return [...assignablePermissions, "team.read", "team.manage"];
  if (role !== "operator" && role !== "viewer") return [];
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return [];
  const entries = Object.entries(overrides);
  if (entries.some(([key, value]) => !assignablePermissions.includes(key as AssignablePermission) || typeof value !== "boolean")) return [];
  const allowed = new Set<AssignablePermission>(role === "operator" ? customerPermissions : ["customers.read"]);
  for (const [key, value] of entries) {
    if (value) allowed.add(key as AssignablePermission);
    else allowed.delete(key as AssignablePermission);
  }
  // Invalid persisted overrides fail closed; the management API rejects these combinations.
  for (let iteration = 0; iteration < assignablePermissions.length; iteration++)
    for (const permission of allowed) if (permissionDependencies[permission]?.some((dependency) => !allowed.has(dependency))) allowed.delete(permission);
  return assignablePermissions.filter((permission) => allowed.has(permission));
}

export function requirePermission(role: string, permission: Permission, overrides: unknown = {}): void {
  if (!permissionsForRole(role, overrides).includes(permission)) throw forbidden();
}
