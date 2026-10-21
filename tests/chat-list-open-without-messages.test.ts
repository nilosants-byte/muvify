import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/config/prisma";
import { ChatController } from "../src/modules/bookings/controllers/chat.controller";

// Teste manual C9.1 (21/10/2026): conversa sem nenhuma mensagem ficava fora
// da lista — o botão "Chat com o personal" abria a lista vazia e o aluno
// nunca conseguia mandar a primeira mensagem. Conversa aberta (agendamento
// PENDING/CONFIRMED) entra mesmo sem mensagem; encerrada sem mensagem, não.

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

let clientId = "";
let providerUserId = "";
let providerId = "";
let categoryId = "";
const bookingIds: string[] = [];

describe("Lista de conversas inclui conversa aberta sem mensagens", () => {
  beforeAll(async () => {
    const category = await prisma.serviceCategory.create({ data: { name: uid("CHL"), description: "test" } });
    categoryId = category.id;
    const client = await prisma.user.create({
      data: { name: "Chat List Client", email: `${uid("chl_c")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}4`, role: "CLIENT" }
    });
    clientId = client.id;
    const providerUser = await prisma.user.create({
      data: { name: "Chat List Provider", email: `${uid("chl_p")}@test.com`, password: "x", phone: `11${Date.now().toString().slice(-9)}5`, role: "PROVIDER" }
    });
    providerUserId = providerUser.id;
    const provider = await prisma.providerProfile.create({
      data: { userId: providerUserId, displayName: "Personal Lista", bio: "t", experienceYears: 1, priceCents: 10000 }
    });
    providerId = provider.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.providerProfile.deleteMany({ where: { id: providerId } });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, providerUserId] } } });
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
  });

  it("agendamento confirmado sem mensagem aparece; concluído sem mensagem não", async () => {
    const open = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(Date.now() + 86_400_000), priceCents: 10000, status: "CONFIRMED" }
    });
    const closed = await prisma.booking.create({
      data: { clientId, providerId, categoryId, scheduledAt: new Date(Date.now() - 86_400_000), priceCents: 10000, status: "COMPLETED" }
    });
    bookingIds.push(open.id, closed.id);

    let body: any = null;
    const res: any = { json: (data: unknown) => { body = data; return res; } };
    await new ChatController().listMyChats({ user: { id: clientId } } as any, res);

    const ids = (body as Array<{ bookingId: string }>).map((c) => c.bookingId);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(closed.id);
    const item = (body as any[]).find((c) => c.bookingId === open.id);
    expect(item.isOpen).toBe(true);
    expect(item.unreadCount).toBe(0);
    expect(item.lastMessage.content).toBe("Nenhuma mensagem ainda. Toque para conversar.");
    expect(item.otherUser.name).toBe("Personal Lista");
  });
});
