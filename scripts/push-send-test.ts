import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { NotificationService } from "../src/modules/notifications/services/notification.service";

const notificationService = new NotificationService();

function parseUserIdsFromEnv() {
  const raw = process.env.PUSH_TEST_USER_IDS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveTargetUsers() {
  const explicit = parseUserIdsFromEnv();
  if (explicit.length > 0) {
    return explicit;
  }

  const devices = await prisma.pushDevice.findMany({
    where: { isActive: true },
    select: { userId: true },
    distinct: ["userId"]
  });

  return devices.map((item) => item.userId);
}

async function main() {
  const targetUsers = await resolveTargetUsers();
  if (targetUsers.length === 0) {
    console.log(
      "Nenhum dispositivo ativo encontrado. Abra o app no celular e faca login para registrar o token push."
    );
    return;
  }

  const result = await notificationService.sendToUsers(targetUsers, {
    title: "Push Smoke Test",
    body: "Teste de notificacao enviado pelo backend.",
    data: {
      type: "PUSH_SMOKE_TEST",
      sentAt: new Date().toISOString()
    }
  });

  console.log(
    JSON.stringify(
      {
        usersTargeted: targetUsers.length,
        result
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Push smoke test failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
