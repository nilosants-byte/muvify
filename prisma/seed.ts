import { PrismaClient } from "@prisma/client";
import { encryptJson } from "../src/shared/utils/encryption";
const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// HASHES DAS SENHAS ORIGINAIS (bcrypt $2a$12)
// Contas de teste (personal1, personal2, cliente1, cliente2) → mesma senha
// Admin (muvifyadm@gmail.com) → senha diferente
// ─────────────────────────────────────────────────────────────────────────────
const TEST_PASSWORD_HASH = "$2a$12$hFnoG0I8hgfP09PkUHLFy.XzlPAwEyGZ5zlclIQr97.zLB0A/cGXW";
const ADMIN_PASSWORD_HASH = "$2a$12$7jGLxLXVJg47JFRyGYitXOdNoKkjXAjW3oKUtRGHYb0nCDGJjkuZa";

async function main() {
  console.log("🌱 Iniciando seed do banco de dados...\n");

  // ── 1. CATEGORIAS ──────────────────────────────────────────────────────────
  console.log("📂 Criando categorias...");
  const categoriesData = [
    { name: "Diarista",                       description: "Limpeza residencial e comercial." },
    { name: "Eletricista",                    description: "Instalacoes e manutencao eletrica." },
    { name: "Encanador",                      description: "Servicos hidraulicos e reparos." },
    { name: "Personal Trainer",               description: "Treinamento fisico personalizado." },
    { name: "Hipertrofia",                    description: null },
    { name: "Alongamento",                    description: null },
    { name: "Emagrecimento",                  description: null },
    { name: "Tudo",                           description: null },
    { name: "LPO (Levantamento de Peso Olímpico)", description: null },
    { name: "Reabilitação e Lesão",           description: null },
  ];
  for (const cat of categoriesData) {
    await prisma.serviceCategory.upsert({
      where: { name: cat.name },
      update: { description: cat.description },
      create: cat,
    });
  }
  console.log(`   ✅ ${categoriesData.length} categorias criadas.\n`);

  // ── 2. USUÁRIOS ────────────────────────────────────────────────────────────
  console.log("👤 Criando usuários...");
  const usersData = [
    {
      name: "Muvify Admin",
      email: "muvifyadm@gmail.com",
      password: ADMIN_PASSWORD_HASH,
      role: "CLIENT" as const,     // role ADMIN é resolvido via email em runtime
      apelido: "muvifyadmin",
      emailVerifiedAt: new Date(), // necessário para resolveEffectiveUserRole retornar ADMIN
    },
    {
      name: "Carlos Personal",
      email: "personal1@muvify.test",
      password: TEST_PASSWORD_HASH,
      role: "PROVIDER" as const,
      apelido: "carlos_personal",
    },
    {
      name: "Diana Personal",
      email: "personal2@muvify.test",
      password: TEST_PASSWORD_HASH,
      role: "PROVIDER" as const,
      apelido: "diana_personal",
    },
    {
      name: "Bernardo",
      email: "cliente1@muvify.test",
      password: TEST_PASSWORD_HASH,
      role: "CLIENT" as const,
      apelido: "will",
    },
    {
      name: "Fulaninho Fulano",
      email: "cliente2@muvify.test",
      password: TEST_PASSWORD_HASH,
      role: "CLIENT" as const,
      apelido: "dancsan",
    },
  ];
  const createdUsers: Record<string, { id: string }> = {};
  for (const user of usersData) {
    const u = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        // Garante emailVerifiedAt para o admin (sem isso o role efetivo fica CLIENT)
        ...(("emailVerifiedAt" in user) ? { emailVerifiedAt: user.emailVerifiedAt } : {}),
      },
      create: user,
      select: { id: true, email: true },
    });
    createdUsers[user.email] = u;
  }
  console.log(`   ✅ ${usersData.length} usuários criados.\n`);

  const personal1Id = createdUsers["personal1@muvify.test"]!.id;
  const personal2Id = createdUsers["personal2@muvify.test"]!.id;
  const cliente1Id  = createdUsers["cliente1@muvify.test"]!.id;
  const cliente2Id  = createdUsers["cliente2@muvify.test"]!.id;

  // ── 3. PERFIS DE PROVIDER ──────────────────────────────────────────────────
  console.log("🏋️  Criando perfis de personal...");

  // Personal 1 — Carlos (displayName "Will Mesquita") — CREF APROVADO
  const p1 = await prisma.providerProfile.upsert({
    where: { userId: personal1Id },
    update: {},
    create: {
      userId: personal1Id,
      displayName: "Will Mesquita",
      bio: "Personal trainer com 8 anos de experiência. Especialista em hipertrofia e emagrecimento.",
      experienceYears: 8,
      priceCents: 10000,
      serviceRadiusKm: 3,
      latitude: -8.031848166037875,
      longitude: -34.89342583064421,
      serviceMode: "BOTH",
      specialties: ["Hipertrofia", "Emagrecimento", "LPO (Levantamento de Peso Olímpico)", "Reabilitação e Lesão"],
      crefNumber: "014577",
      crefValidationStatus: "APPROVED",
      fixedLocations: [
        { id: "seed-p1-loc1", name: "Selfit", address: "Recife", latitude: -8.0492964, longitude: -34.9064051, radiusKm: null },
        { id: "seed-p1-loc2", name: "Smartfit", address: "ZN",   latitude: -26.1161705, longitude: 28.0012256, radiusKm: null },
      ],
    },
    select: { id: true },
  });

  // Personal 2 — Diana (displayName "Danilo Santos") — CREF PENDENTE
  const p2 = await prisma.providerProfile.upsert({
    where: { userId: personal2Id },
    update: {},
    create: {
      userId: personal2Id,
      displayName: "Danilo Santos",
      bio: "Bom em Tudo",
      experienceYears: 3,
      priceCents: 15000,
      serviceRadiusKm: 3,
      latitude: -8.007203237556663,
      longitude: -34.87878321851091,
      serviceMode: "BOTH",
      specialties: ["Hipertrofia", "Alongamento", "Emagrecimento", "Tudo"],
      crefNumber: null,
      crefValidationStatus: "PENDING",
      fixedLocations: [
        { id: "seed-p2-loc1", name: "Selfit Academias Campo Grande", address: "Estr. de Belém, 1704 - Campo Grande, Recife - PE", latitude: -8.0321134, longitude: -34.8767681, radiusKm: null },
        { id: "seed-p2-loc2", name: "Academia Smart Fit - Mix Mateus Peixinhos",  address: "Av. Pres. Kennedy, 3092 - Peixinhos, Olinda - PE", latitude: -8.0067227, longitude: -34.8789797, radiusKm: null },
      ],
    },
    select: { id: true },
  });

  console.log("   ✅ 2 perfis de personal criados.\n");

  // ── 4. CATEGORIAS DOS PROVIDERS ────────────────────────────────────────────
  console.log("🔗 Vinculando categorias aos personais...");
  const getCatId = async (name: string) => {
    const c = await prisma.serviceCategory.findUnique({ where: { name }, select: { id: true } });
    return c!.id;
  };

  const p1CatNames = ["Hipertrofia", "Emagrecimento", "LPO (Levantamento de Peso Olímpico)", "Reabilitação e Lesão"];
  const p2CatNames = ["Hipertrofia", "Alongamento", "Emagrecimento", "Tudo"];

  for (const name of p1CatNames) {
    const catId = await getCatId(name);
    await prisma.providerCategory.upsert({
      where: { providerId_categoryId: { providerId: p1.id, categoryId: catId } },
      update: {},
      create: { providerId: p1.id, categoryId: catId },
    });
  }
  for (const name of p2CatNames) {
    const catId = await getCatId(name);
    await prisma.providerCategory.upsert({
      where: { providerId_categoryId: { providerId: p2.id, categoryId: catId } },
      update: {},
      create: { providerId: p2.id, categoryId: catId },
    });
  }
  console.log("   ✅ Categorias vinculadas.\n");

  // ── 5. HORÁRIOS DE DISPONIBILIDADE ─────────────────────────────────────────
  console.log("📅 Criando horários de disponibilidade...");

  // Personal 1 — horários
  const p1Slots = [
    { weekday: 1, startTime: "05:00", endTime: "06:00" },
    { weekday: 1, startTime: "08:00", endTime: "09:00" },
    { weekday: 1, startTime: "10:00", endTime: "11:00" },
    { weekday: 2, startTime: "05:00", endTime: "06:00" },
    { weekday: 2, startTime: "08:00", endTime: "09:00" },
    { weekday: 2, startTime: "10:00", endTime: "11:00" },
    { weekday: 3, startTime: "05:00", endTime: "06:00" },
    { weekday: 3, startTime: "08:00", endTime: "09:00" },
    { weekday: 3, startTime: "10:00", endTime: "11:00" },
    { weekday: 4, startTime: "05:00", endTime: "06:00" },
    { weekday: 4, startTime: "08:00", endTime: "09:00" },
    { weekday: 4, startTime: "10:00", endTime: "11:00" },
    { weekday: 5, startTime: "05:00", endTime: "06:00" },
    { weekday: 5, startTime: "08:00", endTime: "09:00" },
    { weekday: 5, startTime: "10:00", endTime: "11:00" },
    { weekday: 6, startTime: "05:00", endTime: "06:00" },
    { weekday: 6, startTime: "10:00", endTime: "11:00" },
  ];
  // Personal 2 — horários
  const p2Slots = [
    { weekday: 1, startTime: "08:00", endTime: "09:00" },
    { weekday: 1, startTime: "10:00", endTime: "11:00" },
    { weekday: 1, startTime: "15:00", endTime: "16:00" },
    { weekday: 1, startTime: "17:00", endTime: "18:00" },
    { weekday: 2, startTime: "08:00", endTime: "09:00" },
    { weekday: 2, startTime: "17:00", endTime: "18:00" },
    { weekday: 3, startTime: "08:00", endTime: "09:00" },
    { weekday: 3, startTime: "17:00", endTime: "18:00" },
    { weekday: 4, startTime: "08:00", endTime: "09:00" },
    { weekday: 4, startTime: "17:00", endTime: "18:00" },
    { weekday: 5, startTime: "08:00", endTime: "09:00" },
    { weekday: 5, startTime: "17:00", endTime: "18:00" },
  ];

  await prisma.availability.deleteMany({ where: { providerId: p1.id } });
  await prisma.availability.deleteMany({ where: { providerId: p2.id } });
  for (const slot of p1Slots) {
    await prisma.availability.create({ data: { providerId: p1.id, ...slot, isActive: true } });
  }
  for (const slot of p2Slots) {
    await prisma.availability.create({ data: { providerId: p2.id, ...slot, isActive: true } });
  }
  console.log("   ✅ Horários criados.\n");

  // ── 6. CONFIGURAÇÃO ONLINE CONSULTANCY (personal 2) ────────────────────────
  await prisma.onlineConsultancySetting.upsert({
    where: { providerId: p2.id },
    update: {},
    create: { providerId: p2.id, enabled: false },
  });

  // ── 7. ANAMNESE DOS CLIENTES ───────────────────────────────────────────────
  console.log("📋 Criando anamneses...");
  await prisma.clientAnamnesis.upsert({
    where: { clientId: cliente1Id },
    update: {},
    create: { clientId: cliente1Id, status: "COMPLETED", answers: encryptJson({}), completedAt: new Date() },
  });
  await prisma.clientAnamnesis.upsert({
    where: { clientId: cliente2Id },
    update: {},
    create: { clientId: cliente2Id, status: "DRAFT", answers: encryptJson({}) },
  });
  console.log("   ✅ Anamneses criadas.\n");

  // ── 8. FAVORITOS ───────────────────────────────────────────────────────────
  console.log("⭐ Criando favoritos...");
  await prisma.favorite.upsert({
    where: { userId_providerId: { userId: cliente2Id, providerId: p1.id } },
    update: {},
    create: { userId: cliente2Id, providerId: p1.id },
  });
  console.log("   ✅ Favoritos criados.\n");

  // ── 9. CONQUISTAS ──────────────────────────────────────────────────────────
  await seedAchievements();

  console.log("🎉 Seed concluído com sucesso!");
  console.log("\n📌 Contas criadas:");
  console.log("   Admin:     muvifyadm@gmail.com  → senha original preservada");
  console.log("   Personal1: personal1@muvify.test → senha original preservada");
  console.log("   Personal2: personal2@muvify.test → senha original preservada");
  console.log("   Cliente1:  cliente1@muvify.test  → senha original preservada");
  console.log("   Cliente2:  cliente2@muvify.test  → senha original preservada");
}

async function seedAchievements() {
  console.log("🏆 Criando conquistas...");
  const achievements = [
    // ── Progressão de Nível ──────────────────────────────────────────────────
    { key: "level_2",  name: "Deu o Primeiro Passo",        description: "Atingiu o nível Ativo.",            category: "PROGRESSION", medalType: "BRONZE",  xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 2,   sortOrder: 10 },
    { key: "level_3",  name: "Comprometido com a Evolução", description: "Atingiu o nível Dedicado.",          category: "PROGRESSION", medalType: "BRONZE",  xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 3,   sortOrder: 11 },
    { key: "level_4",  name: "Atleta de Verdade",            description: "Atingiu o nível Atleta.",            category: "PROGRESSION", medalType: "SILVER",  xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 4,   sortOrder: 12 },
    { key: "level_5",  name: "Espírito Guerreiro",           description: "Atingiu o nível Guerreiro.",         category: "PROGRESSION", medalType: "SILVER",  xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 5,   sortOrder: 13 },
    { key: "level_6",  name: "Mentalidade de Campeão",       description: "Atingiu o nível Campeão.",           category: "PROGRESSION", medalType: "GOLD",    xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 6,   sortOrder: 14 },
    { key: "level_7",  name: "No Nível Elite",               description: "Atingiu o nível Elite.",             category: "PROGRESSION", medalType: "GOLD",    xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 7,   sortOrder: 15 },
    { key: "level_8",  name: "Mestre da Disciplina",         description: "Atingiu o nível Mestre.",            category: "PROGRESSION", medalType: "DIAMOND", xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 8,   sortOrder: 16 },
    { key: "level_9",  name: "Uma Lenda Viva",               description: "Atingiu o nível Lenda.",             category: "PROGRESSION", medalType: "DIAMOND", xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 9,   sortOrder: 17 },
    { key: "level_10", name: "Status Imortal",               description: "Atingiu o nível máximo: Imortal.",   category: "PROGRESSION", medalType: "SPECIAL", xpReward: 0,     conditionType: "LEVEL_REACHED", conditionValue: 10,  sortOrder: 18 },
    // ── Sequência de Treinos ─────────────────────────────────────────────────
    { key: "streak_3",   name: "Primeiros Passos",         description: "3 treinos consecutivos.",              category: "CONSISTENCY", medalType: "BRONZE",  xpReward: 20,    conditionType: "STREAK_SESSIONS", conditionValue: 3,   sortOrder: 200 },
    { key: "streak_5",   name: "Ritmo de Treino",          description: "5 treinos consecutivos.",              category: "CONSISTENCY", medalType: "BRONZE",  xpReward: 40,    conditionType: "STREAK_SESSIONS", conditionValue: 5,   sortOrder: 201 },
    { key: "streak_7",   name: "Semana Iniciada",          description: "7 treinos consecutivos.",              category: "CONSISTENCY", medalType: "BRONZE",  xpReward: 70,    conditionType: "STREAK_SESSIONS", conditionValue: 7,   sortOrder: 202 },
    { key: "streak_10",  name: "Dez Dias Seguidos",        description: "10 treinos consecutivos.",             category: "CONSISTENCY", medalType: "BRONZE",  xpReward: 80,    conditionType: "STREAK_SESSIONS", conditionValue: 10,  sortOrder: 203 },
    { key: "streak_14",  name: "Quinzena de Ferro",        description: "14 treinos consecutivos.",             category: "CONSISTENCY", medalType: "BRONZE",  xpReward: 120,   conditionType: "STREAK_SESSIONS", conditionValue: 14,  sortOrder: 204 },
    { key: "streak_21",  name: "Três Semanas de Ouro",     description: "21 treinos consecutivos.",             category: "CONSISTENCY", medalType: "SILVER",  xpReward: 180,   conditionType: "STREAK_SESSIONS", conditionValue: 21,  sortOrder: 205 },
    { key: "streak_30",  name: "Mês de Ferro",             description: "30 treinos consecutivos.",             category: "CONSISTENCY", medalType: "BRONZE",  xpReward: 200,   conditionType: "STREAK_SESSIONS", conditionValue: 30,  sortOrder: 206 },
    { key: "streak_45",  name: "Quase Dois Meses",         description: "45 treinos consecutivos.",             category: "CONSISTENCY", medalType: "SILVER",  xpReward: 350,   conditionType: "STREAK_SESSIONS", conditionValue: 45,  sortOrder: 207 },
    { key: "streak_60",  name: "Dois Meses Sólidos",       description: "60 treinos consecutivos.",             category: "CONSISTENCY", medalType: "SILVER",  xpReward: 500,   conditionType: "STREAK_SESSIONS", conditionValue: 60,  sortOrder: 208 },
    { key: "streak_90",  name: "Trimestre de Aço",         description: "90 treinos consecutivos.",             category: "CONSISTENCY", medalType: "GOLD",    xpReward: 1000,  conditionType: "STREAK_SESSIONS", conditionValue: 90,  sortOrder: 209 },
    { key: "streak_100", name: "Centena de Consistência",  description: "100 treinos consecutivos.",            category: "CONSISTENCY", medalType: "GOLD",    xpReward: 1200,  conditionType: "STREAK_SESSIONS", conditionValue: 100, sortOrder: 210 },
    { key: "streak_120", name: "Inabalável",               description: "120 treinos consecutivos.",            category: "CONSISTENCY", medalType: "DIAMOND", xpReward: 2000,  conditionType: "STREAK_SESSIONS", conditionValue: 120, sortOrder: 211 },
    { key: "streak_150", name: "Cinco Meses Sólidos",      description: "150 treinos consecutivos.",            category: "CONSISTENCY", medalType: "DIAMOND", xpReward: 3000,  conditionType: "STREAK_SESSIONS", conditionValue: 150, sortOrder: 212 },
    { key: "streak_180", name: "Semestre de Aço",          description: "180 treinos consecutivos.",            category: "CONSISTENCY", medalType: "DIAMOND", xpReward: 4000,  conditionType: "STREAK_SESSIONS", conditionValue: 180, sortOrder: 213 },
    { key: "streak_200", name: "200 e Contando",           description: "200 treinos consecutivos.",            category: "CONSISTENCY", medalType: "DIAMOND", xpReward: 5000,  conditionType: "STREAK_SESSIONS", conditionValue: 200, sortOrder: 214 },
    { key: "streak_250", name: "250 Dias Sem Descanso",    description: "250 treinos consecutivos.",            category: "CONSISTENCY", medalType: "DIAMOND", xpReward: 7000,  conditionType: "STREAK_SESSIONS", conditionValue: 250, sortOrder: 215 },
    { key: "streak_365", name: "Um Ano Inteiro",           description: "365 treinos consecutivos.",            category: "CONSISTENCY", medalType: "SPECIAL", xpReward: 10000, conditionType: "STREAK_SESSIONS", conditionValue: 365, sortOrder: 216 },
    // ── Volume de Treinos ────────────────────────────────────────────────────
    { key: "workouts_1",    name: "Primeiro Treino",         description: "Concluiu o primeiro treino.",          category: "VOLUME", medalType: "BRONZE",  xpReward: 0,     conditionType: "TOTAL_WORKOUTS", conditionValue: 1,    sortOrder: 300 },
    { key: "workouts_5",    name: "Primeiros Cinco",         description: "5 treinos concluídos.",                category: "VOLUME", medalType: "BRONZE",  xpReward: 30,    conditionType: "TOTAL_WORKOUTS", conditionValue: 5,    sortOrder: 303 },
    { key: "workouts_10",   name: "Aquecendo",               description: "10 treinos concluídos.",               category: "VOLUME", medalType: "BRONZE",  xpReward: 100,   conditionType: "TOTAL_WORKOUTS", conditionValue: 10,   sortOrder: 304 },
    { key: "workouts_20",   name: "Vinte e Forte",           description: "20 treinos concluídos.",               category: "VOLUME", medalType: "BRONZE",  xpReward: 100,   conditionType: "TOTAL_WORKOUTS", conditionValue: 20,   sortOrder: 306 },
    { key: "workouts_30",   name: "Um Mês de Treinos",       description: "30 treinos concluídos.",               category: "VOLUME", medalType: "SILVER",  xpReward: 200,   conditionType: "TOTAL_WORKOUTS", conditionValue: 30,   sortOrder: 308 },
    { key: "workouts_50",   name: "Comprometido",            description: "50 treinos concluídos.",               category: "VOLUME", medalType: "SILVER",  xpReward: 300,   conditionType: "TOTAL_WORKOUTS", conditionValue: 50,   sortOrder: 310 },
    { key: "workouts_100",  name: "Centurião",               description: "100 treinos concluídos.",              category: "VOLUME", medalType: "GOLD",    xpReward: 600,   conditionType: "TOTAL_WORKOUTS", conditionValue: 100,  sortOrder: 312 },
    { key: "workouts_200",  name: "Duzentos e Forte",        description: "200 treinos concluídos.",              category: "VOLUME", medalType: "GOLD",    xpReward: 1200,  conditionType: "TOTAL_WORKOUTS", conditionValue: 200,  sortOrder: 314 },
    { key: "workouts_500",  name: "Imortal do Treino",       description: "500 treinos concluídos.",              category: "VOLUME", medalType: "DIAMOND", xpReward: 3000,  conditionType: "TOTAL_WORKOUTS", conditionValue: 500,  sortOrder: 317 },
    { key: "workouts_1000", name: "Milhar Completo",         description: "1000 treinos concluídos.",             category: "VOLUME", medalType: "SPECIAL", xpReward: 10000, conditionType: "TOTAL_WORKOUTS", conditionValue: 1000, sortOrder: 319 },
    // ── Social ───────────────────────────────────────────────────────────────
    { key: "following_1",   name: "Primeiro Contato",      description: "Começou a seguir alguém.",             category: "SOCIAL", medalType: "BRONZE",  xpReward: 10,  conditionType: "TOTAL_FOLLOWING", conditionValue: 1,   sortOrder: 400 },
    { key: "following_5",   name: "Rede Nascente",         description: "Seguindo 5 pessoas.",                  category: "SOCIAL", medalType: "BRONZE",  xpReward: 25,  conditionType: "TOTAL_FOLLOWING", conditionValue: 5,   sortOrder: 402 },
    { key: "following_10",  name: "Conectado",             description: "Seguindo 10 pessoas.",                 category: "SOCIAL", medalType: "BRONZE",  xpReward: 30,  conditionType: "TOTAL_FOLLOWING", conditionValue: 10,  sortOrder: 403 },
    { key: "following_50",  name: "Rede de Apoio",         description: "Seguindo 50 pessoas.",                 category: "SOCIAL", medalType: "SILVER",  xpReward: 120, conditionType: "TOTAL_FOLLOWING", conditionValue: 50,  sortOrder: 406 },
    { key: "following_100", name: "Influenciador Social",  description: "Seguindo 100 pessoas.",                category: "SOCIAL", medalType: "GOLD",    xpReward: 200, conditionType: "TOTAL_FOLLOWING", conditionValue: 100, sortOrder: 407 },
    { key: "followers_1",   name: "Primeiro Seguidor",     description: "Alguém te seguiu.",                    category: "SOCIAL", medalType: "BRONZE",  xpReward: 5,   conditionType: "TOTAL_FOLLOWERS", conditionValue: 1,   sortOrder: 410 },
    { key: "followers_5",   name: "Crescendo",             description: "5 seguidores.",                        category: "SOCIAL", medalType: "BRONZE",  xpReward: 20,  conditionType: "TOTAL_FOLLOWERS", conditionValue: 5,   sortOrder: 413 },
    { key: "followers_10",  name: "Pequena Turma",         description: "10 seguidores.",                       category: "SOCIAL", medalType: "BRONZE",  xpReward: 35,  conditionType: "TOTAL_FOLLOWERS", conditionValue: 10,  sortOrder: 414 },
    { key: "followers_25",  name: "Comunidade Inicial",    description: "25 seguidores.",                       category: "SOCIAL", medalType: "SILVER",  xpReward: 70,  conditionType: "TOTAL_FOLLOWERS", conditionValue: 25,  sortOrder: 416 },
    { key: "followers_50",  name: "Popular",               description: "50 seguidores.",                       category: "SOCIAL", medalType: "SILVER",  xpReward: 100, conditionType: "TOTAL_FOLLOWERS", conditionValue: 50,  sortOrder: 417 },
    { key: "followers_100", name: "Comunidade Ativa",      description: "100 seguidores.",                      category: "SOCIAL", medalType: "GOLD",    xpReward: 150, conditionType: "TOTAL_FOLLOWERS", conditionValue: 100, sortOrder: 418 },
    // ── Ranking ──────────────────────────────────────────────────────────────
    { key: "ranking_weekly_top3",      name: "No Pódio",         description: "Entrou no top 3 semanal.",        category: "RANKING", medalType: "GOLD",    xpReward: 150,  conditionType: "WEEKLY_TOP3_REACHED",           conditionValue: 1,  sortOrder: 500 },
    { key: "ranking_weekly_1st",       name: "Líder da Semana",  description: "1º lugar no ranking semanal.",    category: "RANKING", medalType: "DIAMOND", xpReward: 300,  conditionType: "WEEKLY_1ST_REACHED",            conditionValue: 1,  sortOrder: 501 },
    { key: "ranking_weekly_top3_2wks", name: "Dupla Dominância", description: "Top 3 por 2 semanas seguidas.",   category: "RANKING", medalType: "GOLD",    xpReward: 400,  conditionType: "WEEKLY_TOP3_CONSECUTIVE_WEEKS", conditionValue: 2,  sortOrder: 502 },
    { key: "ranking_weekly_top3_4wks", name: "Dominante",        description: "Top 3 por 4 semanas seguidas.",   category: "RANKING", medalType: "DIAMOND", xpReward: 1000, conditionType: "WEEKLY_TOP3_CONSECUTIVE_WEEKS", conditionValue: 4,  sortOrder: 503 },
    // ── Avaliações ───────────────────────────────────────────────────────────
    { key: "reviews_1",  name: "Primeira Avaliação",  description: "Avaliou um personal pela primeira vez.",   category: "VOLUME", medalType: "BRONZE",  xpReward: 10,  conditionType: "TOTAL_REVIEWS_SUBMITTED", conditionValue: 1,  sortOrder: 600 },
    { key: "reviews_5",  name: "Avaliador",           description: "5 avaliações enviadas.",                   category: "VOLUME", medalType: "BRONZE",  xpReward: 50,  conditionType: "TOTAL_REVIEWS_SUBMITTED", conditionValue: 5,  sortOrder: 603 },
    { key: "reviews_10", name: "Crítico Ativo",       description: "10 avaliações enviadas.",                  category: "VOLUME", medalType: "SILVER",  xpReward: 100, conditionType: "TOTAL_REVIEWS_SUBMITTED", conditionValue: 10, sortOrder: 604 },
    // ── Fotos ────────────────────────────────────────────────────────────────
    { key: "photos_1",  name: "Primeiro Click",  description: "Primeira foto pós-treino.",                    category: "VOLUME", medalType: "BRONZE",  xpReward: 10,  conditionType: "TOTAL_PHOTO_POSTS", conditionValue: 1,  sortOrder: 610 },
    { key: "photos_5",  name: "Galeria Iniciada",description: "5 fotos pós-treino.",                          category: "VOLUME", medalType: "BRONZE",  xpReward: 40,  conditionType: "TOTAL_PHOTO_POSTS", conditionValue: 5,  sortOrder: 613 },
    { key: "photos_25", name: "Arquivo de Evolução",description: "25 fotos postadas.",                        category: "VOLUME", medalType: "SILVER",  xpReward: 150, conditionType: "TOTAL_PHOTO_POSTS", conditionValue: 25, sortOrder: 615 },
    // ── Personais Diferentes ─────────────────────────────────────────────────
    { key: "providers_1", name: "Primeiro Personal",  description: "Completou o primeiro treino com um personal.", category: "VOLUME", medalType: "BRONZE",  xpReward: 10,  conditionType: "DISTINCT_PROVIDERS_TRAINED", conditionValue: 1,  sortOrder: 620 },
    { key: "providers_3", name: "Diversificado",      description: "Treinou com 3 personais diferentes.",          category: "VOLUME", medalType: "SILVER",  xpReward: 100, conditionType: "DISTINCT_PROVIDERS_TRAINED", conditionValue: 3,  sortOrder: 622 },
    { key: "providers_5", name: "Variedade de Treinos",description: "Treinou com 5 personais diferentes.",         category: "VOLUME", medalType: "GOLD",    xpReward: 200, conditionType: "DISTINCT_PROVIDERS_TRAINED", conditionValue: 5,  sortOrder: 624 },
  ] as const;

  for (const a of achievements) {
    await (prisma as any).achievement.upsert({
      where: { key: a.key },
      update: { name: a.name, description: a.description, xpReward: a.xpReward, sortOrder: a.sortOrder },
      create: a,
    });
  }
  console.log(`   ✅ ${achievements.length} conquistas criadas.\n`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
