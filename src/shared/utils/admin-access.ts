import { UserRole } from "@prisma/client";
import { env } from "../../config/env";

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}

export function isAdminEmail(email?: string | null) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  return env.ADMIN_ALLOWED_EMAILS.includes(normalized);
}

export function resolveEffectiveUserRole(
  email: string,
  persistedRole: UserRole,
  emailVerifiedAt?: Date | null
) {
  if (isAdminEmail(email) && emailVerifiedAt) {
    return UserRole.ADMIN;
  }

  if (persistedRole === UserRole.ADMIN) {
    return UserRole.CLIENT;
  }

  return persistedRole;
}
