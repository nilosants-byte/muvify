import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "../src/config/prisma";
import { EmailService } from "../src/shared/services/email.service";
import { EmailQueueService } from "../src/shared/services/email-queue.service";

// Teste manual C10.2 (21/10/2026): "Baixar meus dados" falhou no app, mas o
// e-mail "seus dados foram exportados" já tinha saído — era enviado antes de
// a planilha ficar pronta. E a planilha baixava/decifrava todas as fotos de
// comprovação do R2 só pra usar a quantidade.
const buildMock = vi.hoisted(() => vi.fn());
const realBuild = vi.hoisted(() => ({ fn: null as null | ((...args: any[]) => Promise<Buffer>) }));
const getPrivateObjectMock = vi.hoisted(() => vi.fn());

vi.mock("../src/modules/users/services/data-export-spreadsheet", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/users/services/data-export-spreadsheet")>();
  realBuild.fn = original.buildDataExportWorkbook;
  return { ...original, buildDataExportWorkbook: buildMock };
});
vi.mock("../src/shared/services/storage.service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/services/storage.service")>();
  return { ...original, getPrivateObject: getPrivateObjectMock };
});

const { UserService } = await import("../src/modules/users/services/user.service");

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

describe("planilha de exportação: avisa só depois de pronta e não baixa fotos", () => {
  const userService = new UserService();
  let userId = "";
  let bookingId = "";
  let providerUserId = "";
  let providerId = "";
  let categoryId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: "Aluno Export Notify", email: `${uid("xlsx_notify")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}6`, role: UserRole.CLIENT }
    });
    userId = user.id;
    const providerUser = await prisma.user.create({
      data: { name: "Prof Export Notify", email: `${uid("xlsx_notify_p")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}7`, role: UserRole.PROVIDER }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Prof Export", bio: "t", experienceYears: 1, priceCents: 10000 }
    });
    providerId = provider.id;
    const category = await prisma.serviceCategory.create({ data: { name: uid("XN"), description: "t" } });
    categoryId = category.id;
    const booking = await prisma.booking.create({
      data: { clientId: userId, providerId, categoryId, scheduledAt: new Date(), priceCents: 10000, status: "COMPLETED" }
    });
    bookingId = booking.id;
    await prisma.completionEvidence.create({
      data: { bookingId, userId, cameraFacing: "FRONT", mimeType: "image/jpeg", storageKey: "evidence/fake-key", capturedAt: new Date() } as any
    });
  });

  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation((...args: any[]) => realBuild.fn!(...args));
    getPrivateObjectMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.dataExportLog.deleteMany({ where: { userId } });
    await prisma.completionEvidence.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, providerUserId] } } });
  });

  it("falha ao gerar a planilha: nenhum e-mail e nenhum registro de exportação", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const enqueue = vi.spyOn(EmailQueueService.prototype, "enqueueDataExportConfirmation").mockResolvedValue(undefined as any);
    buildMock.mockRejectedValueOnce(new Error("falhou ao montar a planilha"));

    await expect(userService.exportMyDataSpreadsheet(userId)).rejects.toThrow("falhou ao montar a planilha");
    expect(enqueue).not.toHaveBeenCalled();
    expect(await prisma.dataExportLog.count({ where: { userId } })).toBe(0);
  });

  it("sucesso: avisa uma vez, registra uma vez e não baixa as fotos de comprovação", async () => {
    vi.spyOn(EmailService.prototype, "canSendEmail").mockReturnValue(true);
    const enqueue = vi.spyOn(EmailQueueService.prototype, "enqueueDataExportConfirmation").mockResolvedValue(undefined as any);

    const file = await userService.exportMyDataSpreadsheet(userId);
    expect(file.base64.length).toBeGreaterThan(0);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(await prisma.dataExportLog.count({ where: { userId } })).toBe(1);
    expect(getPrivateObjectMock).not.toHaveBeenCalled();
  });
});
