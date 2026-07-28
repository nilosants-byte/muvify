import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

export type AdminAuditAction =
  | "CREF_APPROVED"
  | "CREF_REJECTED"
  | "SUPPORT_TICKET_REPLIED"
  | "DATA_RETENTION_RUN"
  | "DISPUTE_CASE_RESOLVED"
  | "USER_SUSPENDED"
  | "USER_REACTIVATED"
  | "DEBT_WRITTEN_OFF"
  | "EXERCISE_PREBUILT_CREATED"
  | "EXERCISE_PREBUILT_UPDATED"
  | "EXERCISE_PREBUILT_DELETED";

export async function writeAdminAuditLog(params: {
  adminId: string;
  action: AdminAuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: params.adminId,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch (err) {
    // Nunca deixar falha no audit log derrubar a operação principal
    console.error("[admin-audit] Falha ao gravar audit log:", err);
  }
}
