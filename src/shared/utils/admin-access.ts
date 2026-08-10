import { UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { AppError } from "../errors/app-error";

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

// Frente 7 (segunda camada), Lote 1: essa checagem (defesa em profundidade
// no service, revalidando contra o banco em vez de confiar só no
// ensureRole(ADMIN) da rota) já tinha sido corrigida separadamente 3 vezes
// (admin.service.ts, moderation.service.ts, exercise.service.ts,
// category.service.ts) pra incluir emailVerifiedAt, sempre copiando a
// implementação em vez de reaproveitar — e 3 outros services
// (dispute-case.service.ts, debt.service.ts, provider.service.ts)
// continuavam com a versão antiga (só isAdminEmail, sem emailVerifiedAt),
// deixando resolver disputa com reembolso, dar baixa em dívida e
// aprovar/rejeitar CREF vulneráveis ao mesmo cenário: e-mail de admin
// revogado que continua funcionando até o token expirar sozinho.
// Centralizado aqui pra próxima cópia não voltar a divergir.
export async function assertAdminAccess(adminUserId: string) {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { id: true, name: true, email: true, role: true, emailVerifiedAt: true }
  });

  if (!admin || !admin.emailVerifiedAt || !isAdminEmail(admin.email)) {
    throw new AppError("Acesso negado.", StatusCodes.FORBIDDEN);
  }

  return admin;
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
