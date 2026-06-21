import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const ROOT_DIR = path.resolve("C:/Users/Danilo/Documents/dev/personal-app-backend");
const MOBILE_DIR = path.join(ROOT_DIR, "mobile-app");
const APP_PORT = Number(process.env.CAPTURE_APP_PORT || 8091);
const API_PORT = Number(process.env.CAPTURE_API_PORT || 3010);
const APP_URL = process.env.CAPTURE_APP_URL ?? `http://127.0.0.1:${APP_PORT}`;
const API_BASE_URL = process.env.CAPTURE_API_BASE_URL ?? `http://127.0.0.1:${API_PORT}/api`;
const OUTPUT_DIR =
  process.env.CAPTURE_OUT_DIR ??
  "C:/Users/Danilo/Documents/testes app/muvify-cliente-catalogo";

const enhancedProviders = [
  {
    id: "prov-1",
    displayName: "Mariana Coach",
    bio: "Treinos personalizados com foco em resultado.",
    experienceYears: 7,
    priceCents: 15000,
    avgRating: 4.9,
    reviewCount: 112,
    age: 32,
    latitude: -23.5514,
    longitude: -46.6361,
    serviceMode: "PRESENTIAL_ONLY",
    specialties: ["Musculacao", "Funcional"],
    photoUrl: "https://images.unsplash.com/photo-1594381898411-846e7d193883?q=80&w=400",
    fixedLocations: [
      {
        id: "loc-prov-1",
        name: "Studio Mariana Coach",
        latitude: -23.5514,
        longitude: -46.6361,
        radiusKm: 5
      }
    ]
  },
  {
    id: "prov-2",
    displayName: "Lucas Trainer",
    bio: "Performance e emagrecimento de forma segura.",
    experienceYears: 5,
    priceCents: 13000,
    avgRating: 4.8,
    reviewCount: 78,
    age: 29,
    latitude: -23.5478,
    longitude: -46.6306,
    serviceMode: "BOTH",
    specialties: ["Emagrecimento", "Crossfit"],
    photoUrl: "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?q=80&w=400",
    fixedLocations: [
      {
        id: "loc-prov-2",
        name: "Box Lucas Trainer",
        latitude: -23.5478,
        longitude: -46.6306,
        radiusKm: 8
      }
    ]
  },
  {
    id: "prov-3",
    displayName: "Camila Santos",
    bio: "Acompanhamento para emagrecimento e condicionamento.",
    experienceYears: 6,
    priceCents: 14000,
    avgRating: 4.9,
    reviewCount: 96,
    age: 31,
    latitude: -23.5542,
    longitude: -46.6278,
    serviceMode: "HOME_VISIT_ONLY",
    specialties: ["Emagrecimento", "Pilates"],
    photoUrl: "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?q=80&w=400",
    fixedLocations: [
      {
        id: "loc-prov-3",
        name: "Atendimento domiciliar",
        latitude: -23.5542,
        longitude: -46.6278,
        radiusKm: 6
      }
    ]
  }
];

const captures = [];
const notes = [];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnProc(command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${path.basename(cwd)}:${command}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${path.basename(cwd)}:${command}:err] ${chunk}`);
  });

  return child;
}

async function killProcessTree(child) {
  if (!child || child.killed) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false
      });
      killer.on("exit", () => resolve(true));
      killer.on("error", () => resolve(true));
    });
    return;
  }

  child.kill("SIGTERM");
}

async function waitForHttp(url, { timeoutMs = 360000, intervalMs = 1000, validate } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { status, body } = await httpGetText(url);
      if (!validate || validate(status, body)) return;
    } catch {
      // Keep polling until timeout.
    }
    await wait(intervalMs);
  }

  throw new Error(`Timeout waiting for ${url}`);
}

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error(`Request timeout for ${url}`));
    });
  });
}

async function waitForNavReady(page) {
  await page.waitForFunction(() => {
    const nav = window.__PERSONALAPP_NAV__;
    return Boolean(nav && typeof nav.isReady === "function" && nav.isReady());
  }, undefined, { timeout: 90000 });
}

async function navigateGlobal(page, screen, params) {
  await waitForNavReady(page);
  const ok = await page.evaluate(
    ({ screen, params }) => {
      const nav = window.__PERSONALAPP_NAV__;
      if (!nav || typeof nav.navigate !== "function") return false;
      nav.navigate(screen, params);
      return true;
    },
    { screen, params }
  );

  if (!ok) throw new Error(`Global navigation failed for screen: ${screen}`);
  await wait(900);
}

async function navigateClientTab(page, screen) {
  await navigateGlobal(page, "ClientTabs", { screen });
}

async function gotoApp(page, suffix = "") {
  await page.goto(`${APP_URL}${suffix}`, {
    waitUntil: "commit",
    timeout: 300000
  });
}

async function waitLogin(page) {
  const deadline = Date.now() + 360000;

  while (Date.now() < deadline) {
    const firstInput = page.locator("input").first();
    if ((await firstInput.count()) > 0 && (await firstInput.isVisible().catch(() => false))) {
      return;
    }

    const confirmClientButton = page.getByText(/Confirmar como Aluno/i).first();
    if (
      (await confirmClientButton.count()) > 0 &&
      (await confirmClientButton.isVisible().catch(() => false))
    ) {
      const box = await confirmClientButton.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await page.mouse.click(195, 430);
      }
      await wait(900);
      continue;
    }

    await wait(500);
  }

  try {
    await waitForNavReady(page);
    await page.evaluate(() => {
      const nav = window.__PERSONALAPP_NAV__;
      if (nav && typeof nav.navigate === "function") nav.navigate("Login");
    });
    await page.locator("input").first().waitFor({ timeout: 90000 });
  } catch (error) {
    await saveDebugPage(page, "wait-login");
    throw error;
  }
}

async function clickAction(page, label) {
  const roleButton = page.locator('[role="button"]').filter({ hasText: label });
  if ((await roleButton.count()) > 0 && (await roleButton.first().isVisible())) {
    await roleButton.first().click({ force: true });
    return true;
  }

  const textNode = page.getByText(label).first();
  if ((await textNode.count()) > 0 && (await textNode.isVisible())) {
    await textNode.click({ force: true });
    return true;
  }

  return false;
}

async function optionalClick(page, label, note) {
  const clicked = await clickAction(page, label);
  if (!clicked && note) notes.push(note);
  if (clicked) await wait(500);
  return clicked;
}

async function login(page) {
  await waitLogin(page);
  await page.locator("input").nth(0).fill("cliente@demo.com");
  await page.locator("input").nth(1).fill("12345678");
  await clickAction(page, "Entrar");
}

async function chooseRole(page) {
  const hasRoleSelection = await page
    .getByText(/Escolha seu perfil|Como voc/i)
    .first()
    .waitFor({ timeout: 7000 })
    .then(() => true)
    .catch(() => false);

  if (!hasRoleSelection) return;

  const roleButtons = page
    .locator('[role="button"]')
    .filter({ hasText: /Ver perfil|Selecionar/i });
  if ((await roleButtons.count()) > 0) {
    await roleButtons.first().click({ force: true });
  } else {
    await clickAction(page, "Ver perfil");
  }

  await page.getByText(/Escolher este perfil/i).first().waitFor({ timeout: 60000 });
  await clickAction(page, "Escolher este perfil");
}

async function loginAndEnterClientHome(page) {
  await gotoApp(page);
  await login(page);
  await chooseRole(page);
  await wait(1800);
}

async function resetClientHome(page) {
  await gotoApp(page, `?capture=${Date.now()}`);
  await wait(1400);

  const needsLogin =
    ((await page.locator("input").count().catch(() => 0)) > 0) ||
    (await page.getByText(/Confirmar como Aluno/i).first().isVisible().catch(() => false));

  if (needsLogin) {
    await login(page);
    await chooseRole(page);
    await wait(1200);
  }

  await navigateClientTab(page, "ClientHome");
  await wait(900);
  await clickAction(page, /Agora n/i).catch(() => false);
  await wait(400);
}

function screenshotPath(fileName) {
  return path.join(OUTPUT_DIR, fileName);
}

async function take(page, fileName, title, group) {
  await wait(250);
  await page.screenshot({
    path: screenshotPath(fileName),
    animations: "disabled",
    timeout: 45000
  });
  captures.push({ fileName, title, group });
  console.log(`Captured ${fileName}`);
}

async function safeStep(label, fn) {
  console.log(`Starting ${label}`);
  try {
    await Promise.race([
      fn(),
      wait(75000).then(() => {
        throw new Error("Timeout interno da etapa de captura.");
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`${label}: ${message}`);
    console.warn(`Skipped ${label}: ${message}`);
  }
}

async function setupApiRoutes(page) {
  await page.route("**/api/providers**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/providers") {
      const query = String(url.searchParams.get("q") ?? "").toLowerCase();
      const payload = !query
        ? enhancedProviders
        : enhancedProviders.filter((provider) =>
            `${provider.displayName} ${provider.bio}`.toLowerCase().includes(query)
          );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload)
      });
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
    if (detailMatch) {
      const provider =
        enhancedProviders.find((item) => item.id === detailMatch[1]) ?? enhancedProviders[0];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...provider,
          reviews: [
            {
              id: "review-1",
              rating: 5,
              comment: "Excelente atendimento.",
              createdAt: new Date().toISOString(),
              user: { id: "user-client-1", name: "Cliente Demo" }
            }
          ],
          categoryLinks: [
            { categoryId: "cat-1", category: { id: "cat-1", name: "Musculacao" } },
            { categoryId: "cat-2", category: { id: "cat-2", name: "Funcional" } }
          ]
        })
      });
      return;
    }

    await route.continue();
  });
}

async function saveDebugPage(page, label) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const safeLabel = String(label).replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const imagePath = path.join(OUTPUT_DIR, `_debug-${safeLabel}.png`);
  const htmlPath = path.join(OUTPUT_DIR, `_debug-${safeLabel}.html`);
  const textPath = path.join(OUTPUT_DIR, `_debug-${safeLabel}.txt`);

  try {
    await page.screenshot({ path: imagePath, fullPage: true, timeout: 30000 });
  } catch (error) {
    console.warn(`Falha ao salvar screenshot debug (${safeLabel}): ${error.message}`);
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf8");
  } catch (error) {
    console.warn(`Falha ao salvar HTML debug (${safeLabel}): ${error.message}`);
  }

  try {
    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 4000) ?? "",
      hasNav: Boolean(window.__PERSONALAPP_NAV__),
      navReady:
        Boolean(window.__PERSONALAPP_NAV__) &&
        typeof window.__PERSONALAPP_NAV__.isReady === "function" &&
        window.__PERSONALAPP_NAV__.isReady(),
      inputCount: document.querySelectorAll("input").length
    }));
    fs.writeFileSync(textPath, JSON.stringify(state, null, 2), "utf8");
    console.log(`Debug salvo em: ${imagePath}`);
    console.log(`Estado debug: ${JSON.stringify(state)}`);
  } catch (error) {
    console.warn(`Falha ao salvar estado debug (${safeLabel}): ${error.message}`);
  }
}

async function openTopLeftMenu(page) {
  await page.mouse.click(28, 58);
  await wait(700);
}

async function openTopRightNotifications(page) {
  await page.mouse.click(360, 58);
  await wait(900);
}

async function closeOverlay(page) {
  await page.keyboard.press("Escape");
  await wait(350);
  await page.mouse.click(380, 25);
  await wait(350);
}

async function dismissChatPromptIfVisible(page) {
  const clicked = await clickAction(page, /Agora n/i);
  if (clicked) await wait(600);
  return clicked;
}

async function openMapControl(page, index) {
  const candidateY = [285, 327, 369, 250, 292, 334];
  const y = candidateY[index] ?? candidateY[0];
  await page.mouse.click(26, y);
  await wait(700);
}

async function openProviderSummary(page) {
  const providerText = page.getByText(/Mariana Coach|Lucas Trainer|Camila Santos/i).first();
  if ((await providerText.count()) > 0) {
    const box = await providerText.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await wait(1200);
      return;
    }
  }

  await page.mouse.click(185, 440);
  await wait(1200);
}

async function captureHomeSurfaces(page) {
  await navigateClientTab(page, "ClientHome");
  await wait(1800);

  const anamnesisVisible = await page
    .getByText(/Preencha sua ficha de sa/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (anamnesisVisible) {
    await take(page, "01-home-popup-anamnese.png", "Home - popup de anamnese", "Home / Overlays");
    await optionalClick(page, "Agora nao");
    await optionalClick(page, "Agora nÃ£o");
    await wait(600);
  } else {
    notes.push("Popup de anamnese nao apareceu automaticamente com o estado mock atual.");
  }

  await take(page, "02-home.png", "Home do cliente", "Tabs principais");

  await safeStep("menu lateral do avatar", async () => {
    await openTopLeftMenu(page);
    await take(page, "03-home-menu-lateral-avatar.png", "Home - menu lateral do avatar", "Home / Overlays");
    await resetClientHome(page);
  });

  await safeStep("drawer de notificacoes da home", async () => {
    await openTopRightNotifications(page);
    await take(page, "04-home-drawer-notificacoes.png", "Home - drawer de notificacoes", "Home / Overlays");
    await resetClientHome(page);
  });

  await safeStep("modal busca local no mapa", async () => {
    await openMapControl(page, 0);
    await take(page, "05-home-modal-buscar-local.png", "Home - modal buscar local", "Home / Overlays");
    await resetClientHome(page);
  });

  await safeStep("modal busca personal no mapa", async () => {
    await openMapControl(page, 1);
    await take(page, "06-home-modal-buscar-personal.png", "Home - modal buscar personal", "Home / Overlays");
    await resetClientHome(page);
  });

  await safeStep("modal busca academia no mapa", async () => {
    await openMapControl(page, 2);
    await take(page, "07-home-modal-buscar-academia.png", "Home - modal buscar academia", "Home / Overlays");
    await resetClientHome(page);
  });

  await safeStep("modal resumo do personal no mapa", async () => {
    await openProviderSummary(page);
    const visible = await page.getByText(/Resumo do personal/i).first().isVisible().catch(() => false);
    if (!visible) throw new Error("Resumo do personal nao ficou visivel.");
    await take(page, "08-home-modal-resumo-personal.png", "Home - modal resumo do personal", "Home / Overlays");
    await resetClientHome(page);
  });
}

async function withFreshClientHome(browser, fn, { dismissAnamnesis = true } = {}) {
  await withClientContext(browser, async (page) => {
    await loginAndEnterClientHome(page);
    await navigateClientTab(page, "ClientHome");
    await wait(1600);
    if (dismissAnamnesis) {
      await clickAction(page, /Agora n/i).catch(() => false);
      await wait(600);
    }
    await fn(page);
  });
}

async function captureHomeCatalog(browser) {
  await withFreshClientHome(
    browser,
    async (page) => {
      const anamnesisVisible = await page
        .getByText(/Preencha sua ficha de sa/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (anamnesisVisible) {
        await take(page, "01-home-popup-anamnese.png", "Home - popup de anamnese", "Home / Overlays");
        await clickAction(page, /Agora n/i).catch(() => false);
        await wait(600);
      } else {
        notes.push("Popup de anamnese nao apareceu automaticamente com o estado mock atual.");
      }
      await take(page, "02-home.png", "Home do cliente", "Tabs principais");
    },
    { dismissAnamnesis: false }
  );

  const homeSurfaces = [
    [
      "menu lateral do avatar",
      "03-home-menu-lateral-avatar.png",
      "Home - menu lateral do avatar",
      async (page) => openTopLeftMenu(page)
    ],
    [
      "drawer de notificacoes da home",
      "04-home-drawer-notificacoes.png",
      "Home - drawer de notificacoes",
      async (page) => openTopRightNotifications(page)
    ],
    [
      "modal busca local no mapa",
      "05-home-modal-buscar-local.png",
      "Home - modal buscar local",
      async (page) => openMapControl(page, 0)
    ],
    [
      "modal busca personal no mapa",
      "06-home-modal-buscar-personal.png",
      "Home - modal buscar personal",
      async (page) => openMapControl(page, 1)
    ],
    [
      "modal busca academia no mapa",
      "07-home-modal-buscar-academia.png",
      "Home - modal buscar academia",
      async (page) => openMapControl(page, 2)
    ],
    [
      "modal resumo do personal no mapa",
      "08-home-modal-resumo-personal.png",
      "Home - modal resumo do personal",
      async (page) => {
        await openProviderSummary(page);
        const visible = await page.getByText(/Resumo do personal/i).first().isVisible().catch(() => false);
        if (!visible) throw new Error("Resumo do personal nao ficou visivel.");
      }
    ]
  ];

  for (const [label, fileName, title, action] of homeSurfaces) {
    await safeStep(label, async () => {
      await withFreshClientHome(browser, async (page) => {
        await action(page);
        await take(page, fileName, title, "Home / Overlays");
      });
    });
  }
}

async function captureClientTabs(page) {
  const tabs = [
    ["Categories", "09-tab-categorias.png", "Categorias"],
    ["Promotions", "10-tab-promocoes.png", "Promocoes"],
    ["MyTraining", "11-tab-seu-treino.png", "Seu Treino"],
    ["ClientBookings", "12-tab-agenda.png", "Agenda"],
    ["Favorites", "13-tab-favoritos.png", "Favoritos"],
    ["ClientProfile", "14-tab-perfil.png", "Perfil"]
  ];

  for (const [screen, fileName, title] of tabs) {
    await safeStep(`tab ${title}`, async () => {
      await navigateClientTab(page, screen);
      await take(page, fileName, `Tab - ${title}`, "Tabs principais");
    });
  }
}

async function captureClientStack(page) {
  const stackScreens = [
    ["ClientSettings", undefined, "15-configuracoes.png", "Configuracoes"],
    ["ClientAnamnesis", undefined, "16-anamnese.png", "Anamnese"],
    ["ClientPaymentMethod", undefined, "17-metodo-pagamento.png", "Metodo de pagamento"],
    ["ClientChatList", undefined, "18-conversas.png", "Conversas"],
    ["SearchProfessionals", undefined, "19-buscar-profissionais.png", "Buscar profissionais"],
    ["ProfessionalsList", { query: "Mariana" }, "20-lista-profissionais.png", "Lista de profissionais"],
    ["ProfessionalDetail", { professionalId: "prov-1" }, "21-detalhe-profissional.png", "Detalhe do profissional"],
    ["ConsultancyRequest", { professionalId: "prov-1" }, "22-solicitar-consultoria.png", "Solicitar consultoria"],
    ["ArchivedRequests", undefined, "23-solicitacoes-arquivadas.png", "Solicitacoes arquivadas"],
    ["CreateBooking", { professionalId: "prov-1" }, "24-criar-agendamento.png", "Criar agendamento"],
    ["BookingConfirmation", { bookingId: "booking-client-1" }, "25-confirmacao-agendamento.png", "Confirmacao de agendamento"],
    ["BookingPaymentStatus", { bookingId: "booking-client-1" }, "26-status-pagamento.png", "Status do pagamento"],
    ["ClientBookingDetail", { bookingId: "booking-client-1" }, "27-detalhe-agendamento.png", "Detalhe do agendamento"],
    ["ClientConfirmCompletion", { bookingId: "booking-client-1" }, "28-confirmar-conclusao.png", "Confirmar conclusao"],
    ["ReviewProfessional", { bookingId: "booking-client-1", professionalId: "prov-1" }, "29-avaliar-profissional.png", "Avaliar profissional"],
    ["Notifications", undefined, "30-notificacoes-tela.png", "Notificacoes"],
    ["Support", undefined, "31-suporte.png", "Suporte"],
    ["Privacy", undefined, "32-privacidade.png", "Privacidade"],
    ["Security", undefined, "33-seguranca.png", "Seguranca"]
  ];

  for (const [screen, params, fileName, title] of stackScreens) {
    await safeStep(`stack ${title}`, async () => {
      await navigateGlobal(page, screen, params);
      if (screen === "BookingConfirmation") {
        const chatPromptVisible = await page
          .getByText(/Agendamento realizado/i)
          .first()
          .isVisible()
          .catch(() => false);
        if (chatPromptVisible) {
          await take(
            page,
            "25a-confirmacao-popup-chat.png",
            "Confirmacao - popup para abrir chat",
            "Popups"
          );
          await dismissChatPromptIfVisible(page);
        }
      }
      await take(page, fileName, title, "Telas de stack");
      await dismissChatPromptIfVisible(page);
    });
  }
}

async function captureSecurityModals(page) {
  await navigateGlobal(page, "Security");

  const modals = [
    [["Alterar senha"], "34-seguranca-modal-alterar-senha.png", "Seguranca - modal alterar senha"],
    [["Alterar e-mail de login"], "35-seguranca-modal-alterar-email.png", "Seguranca - modal alterar e-mail"],
    [
      [/E-mail de recupera/i],
      "36-seguranca-modal-email-recuperacao.png",
      "Seguranca - modal e-mail de recuperacao"
    ]
  ];

  for (const [labels, fileName, title] of modals) {
    await safeStep(title, async () => {
      let clicked = false;
      for (const label of labels) {
        clicked = await clickAction(page, label);
        if (clicked) break;
      }
      if (!clicked) throw new Error(`Botao "${labels.join(" / ")}" nao encontrado.`);
      await wait(600);
      await take(page, fileName, title, "Modais de seguranca");
      await optionalClick(page, "Cancelar");
      await wait(400);
    });
  }
}
async function captureGenericStates(browser) {
  await withClientContext(browser, async (page, context) => {
    await loginAndEnterClientHome(page);
    await navigateGlobal(page, "GenericError", {
      title: "Erro de teste",
      message: "Falha simulada para validacao visual de tela."
    });
    await take(page, "37-estado-erro-generico.png", "Estado - erro generico", "Estados globais");

    await gotoApp(page);
    await waitLogin(page);
    await context.setOffline(true);
    await wait(1800);
    await take(page, "38-estado-offline.png", "Estado - offline", "Estados globais");
    await context.setOffline(false);
  });
}

async function withClientContext(browser, fn) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
    permissions: ["geolocation"]
  });

  await context.addInitScript(() => {
    try {
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: {
          ready: Promise.resolve(),
          status: "loaded",
          check: () => true,
          load: () => Promise.resolve([]),
          addEventListener: () => undefined,
          removeEventListener: () => undefined
        }
      });
    } catch {
      // Ignore font patch issues.
    }

    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("@personalapp/onboardingDone", "1");
  });

  const page = await context.newPage();
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") {
      console.log(`[browser:${type}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[browser:pageerror] ${error.stack || error.message}`);
  });
  await setupApiRoutes(page);

  try {
    await fn(page, context);
  } finally {
    await context.close();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeGallery() {
  const groups = new Map();
  for (const capture of captures) {
    if (!groups.has(capture.group)) groups.set(capture.group, []);
    groups.get(capture.group).push(capture);
  }

  const sections = [...groups.entries()]
    .map(([group, items]) => {
      const cards = items
        .map(
          (item) => `
            <article class="card">
              <a href="./${encodeURIComponent(item.fileName)}" target="_blank" rel="noreferrer">
                <img src="./${encodeURIComponent(item.fileName)}" alt="${escapeHtml(item.title)}">
              </a>
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.fileName)}</p>
            </article>`
        )
        .join("\n");
      return `<section><h2>${escapeHtml(group)}</h2><div class="grid">${cards}</div></section>`;
    })
    .join("\n");

  const notesHtml = notes.length
    ? `<section><h2>Observacoes</h2><ul>${notes
        .map((note) => `<li>${escapeHtml(note)}</li>`)
        .join("")}</ul></section>`
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Catalogo de prints - Cliente Muvify</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #07110d; color: #f4f7f4; font-family: Arial, sans-serif; padding: 28px; }
    header { max-width: 1040px; margin: 0 auto 26px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    h2 { margin: 32px auto 14px; max-width: 1040px; font-size: 18px; color: #22C55E; }
    p { color: rgba(244,247,244,.68); }
    .grid { max-width: 1040px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .card { border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(255,255,255,.04); overflow: hidden; }
    img { width: 100%; display: block; background: #111; }
    .card h3 { margin: 12px 12px 4px; font-size: 14px; }
    .card p { margin: 0 12px 12px; font-size: 11px; word-break: break-all; }
    ul { max-width: 1040px; margin: 0 auto; color: rgba(244,247,244,.78); line-height: 1.5; }
  </style>
</head>
<body>
  <header>
    <h1>Catalogo de prints - Cliente Muvify</h1>
    <p>${captures.length} capturas geradas automaticamente em ${new Date().toLocaleString("pt-BR")}.</p>
  </header>
  ${sections}
  ${notesHtml}
</body>
</html>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), html, "utf8");
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), captures, notes }, null, 2),
    "utf8"
  );
}

async function runCapture() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    if (
      file.toLowerCase().endsWith(".png") ||
      file === "index.html" ||
      file === "manifest.json" ||
      file.startsWith("_debug-")
    ) {
      fs.unlinkSync(path.join(OUTPUT_DIR, file));
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await captureHomeCatalog(browser);

    await withClientContext(browser, async (page) => {
      await loginAndEnterClientHome(page);
      await captureClientTabs(page);
      await captureClientStack(page);
      await captureSecurityModals(page);
    });

    await captureGenericStates(browser);
  } finally {
    await browser.close();
  }

  writeGallery();
}

async function main() {
  const mockApi = spawnProc(process.execPath, ["scripts/mock-mobile-api.js"], ROOT_DIR, {
    PORT: String(API_PORT)
  });
  let expoWeb;

  try {
    await wait(2500);
    await waitForHttp(`http://127.0.0.1:${API_PORT}/api/health`, {
      timeoutMs: 120000,
      validate: (status) => status === 200
    });

    expoWeb =
      process.platform === "win32"
        ? spawnProc("cmd.exe", ["/c", `npm run web -- --port ${APP_PORT}`], MOBILE_DIR, {
            EXPO_PUBLIC_THEME_MODE: "dark",
            EXPO_PUBLIC_API_BASE_URL: API_BASE_URL,
            EXPO_PUBLIC_SKIP_LAUNCH_SPLASH: "true",
            EXPO_PUBLIC_SKIP_FONT_LOADING: "true"
          })
        : spawnProc("npm", ["run", "web", "--", "--port", String(APP_PORT)], MOBILE_DIR, {
            EXPO_PUBLIC_THEME_MODE: "dark",
            EXPO_PUBLIC_API_BASE_URL: API_BASE_URL,
            EXPO_PUBLIC_SKIP_LAUNCH_SPLASH: "true",
            EXPO_PUBLIC_SKIP_FONT_LOADING: "true"
          });

    await waitForHttp(`${APP_URL}/status`, {
      timeoutMs: 360000,
      validate: (_status, body) => body.includes("packager-status:running")
    });

    await wait(2500);
    await runCapture();
    console.log(`Catalogo gerado em: ${OUTPUT_DIR}`);
  } finally {
    await killProcessTree(expoWeb);
    await killProcessTree(mockApi);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

