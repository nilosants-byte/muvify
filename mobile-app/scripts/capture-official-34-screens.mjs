import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR =
  process.env.CAPTURE_OUT_DIR ?? "C:/Users/Danilo/Documents/testes app";
const APP_URL = process.env.CAPTURE_APP_URL ?? "http://127.0.0.1:8081";

const OFFICIAL_FILES = [
  "01-auth-splash-intro.png",
  "02-auth-onboarding.png",
  "03-auth-login.png",
  "04-auth-register.png",
  "05-auth-forgot-password.png",
  "06-auth-session-expired.png",
  "07-auth-profile-selection.png",
  "08-client-home.png",
  "09-client-categories.png",
  "10-client-bookings.png",
  "11-client-favorites.png",
  "12-client-profile.png",
  "13-client-settings.png",
  "14-client-search.png",
  "15-client-professionals-list.png",
  "16-client-professional-detail.png",
  "17-client-create-booking.png",
  "18-client-booking-confirmation.png",
  "19-client-booking-detail.png",
  "20-client-confirm-completion.png",
  "21-client-review-professional.png",
  "22-shared-notifications.png",
  "23-shared-support.png",
  "24-shared-generic-error.png",
  "25-shared-offline-required.png",
  "26-provider-home.png",
  "27-provider-agenda.png",
  "28-provider-booking-detail.png",
  "29-provider-confirm-completion.png",
  "30-provider-booking-payment-status.png",
  "31-provider-profile-editor.png",
  "32-provider-availability-manager.png",
  "33-provider-connect-payout-account.png",
  "34-provider-payout-status.png"
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickAction(page, label) {
  const roleButton = page.locator('[role="button"]').filter({ hasText: label });
  if ((await roleButton.count()) > 0 && (await roleButton.first().isVisible())) {
    await roleButton.first().click();
    return true;
  }

  const textNode = page.getByText(label).first();
  if ((await textNode.count()) > 0 && (await textNode.isVisible())) {
    await textNode.click({ force: true });
    return true;
  }

  return false;
}

async function waitForNavReady(page) {
  await page.waitForFunction(() => {
    const nav = window.__PERSONALAPP_NAV__;
    return Boolean(nav && typeof nav.isReady === "function" && nav.isReady());
  }, undefined, { timeout: 30000 });
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

  if (!ok) {
    throw new Error(`Global navigation failed for screen: ${screen}`);
  }
}

async function navigateClientTab(page, screen) {
  await navigateGlobal(page, "ClientTabs", { screen });
  await delay(350);
}

async function navigateProfessionalTab(page, screen) {
  await navigateGlobal(page, "ProfessionalTabs", { screen });
  await delay(350);
}

async function gotoApp(page, suffix = "") {
  await page.goto(`${APP_URL}${suffix}`, {
    waitUntil: "commit",
    timeout: 300000
  });
}

async function waitLogin(page) {
  try {
    await page.locator("input").first().waitFor({ timeout: 20000 });
    return;
  } catch {
    // fallthrough
  }

  await waitForNavReady(page);
  await page.evaluate(() => {
    const nav = window.__PERSONALAPP_NAV__;
    if (nav && typeof nav.navigate === "function") {
      nav.navigate("Login");
    }
  });
  await page.locator("input").first().waitFor({ timeout: 120000 });
}

async function login(page, email) {
  await waitLogin(page);
  await page.locator("input").nth(0).fill(email);
  await page.locator("input").nth(1).fill("12345678");
  await clickAction(page, "Entrar");
}

async function chooseRole(page, role) {
  const hasRoleSelection = await page
    .getByText(/Escolha seu perfil|Como você deseja usar o app/i)
    .first()
    .waitFor({ timeout: 6000 })
    .then(() => true)
    .catch(() => false);

  if (!hasRoleSelection) {
    return false;
  }

  const roleButtons = page.locator('[role="button"]').filter({ hasText: /Ver perfil|Selecionar/i });
  if ((await roleButtons.count()) > 1) {
    if (role === "CLIENT") {
      await roleButtons.first().click();
    } else {
      await roleButtons.nth(1).click();
    }
  } else {
    await clickAction(page, "Ver perfil");
  }

  await page.getByText(/Escolher este perfil/i).first().waitFor({ timeout: 120000 });
  await clickAction(page, "Escolher este perfil");
  return true;
}

async function loginAndEnterClientHome(page) {
  await gotoApp(page);
  await login(page, "cliente@demo.com");
  await chooseRole(page, "CLIENT");
  await delay(1200);
}

async function loginAndEnterProviderHome(page) {
  await gotoApp(page);
  await login(page, "profissional@demo.com");
  await chooseRole(page, "PROVIDER");
  await delay(1200);
}

function screenshotPath(fileName) {
  return path.join(OUT_DIR, fileName);
}

async function take(page, fileName) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await delay(250);
      await page.screenshot({
        path: screenshotPath(fileName),
        animations: "disabled",
        timeout: 120000
      });
      return;
    } catch (error) {
      lastError = error;
      await delay(800);
    }
  }

  throw lastError;
}

async function waitAfterNavigation(ms = 900) {
  await delay(ms);
}

async function withFreshContext(browser, { onboardingDone = true } = {}, fn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(
    ({ onboardingDone }) => {
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
        // Ignore patch issues and continue with native font loader.
      }

      localStorage.clear();
      sessionStorage.clear();

      if (onboardingDone) {
        localStorage.setItem("@personalapp/onboardingDone", "1");
      } else {
        localStorage.removeItem("@personalapp/onboardingDone");
      }

      localStorage.removeItem("@personalapp/role");
      localStorage.removeItem("@personalapp/roleUserId");
      localStorage.removeItem("@personalapp/secure/accessToken");
      localStorage.removeItem("@personalapp/secure/refreshToken");
    },
    { onboardingDone }
  );

  const page = await context.newPage();
  try {
    await fn(page, context);
  } finally {
    await context.close();
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const fileName of OFFICIAL_FILES) {
    const full = screenshotPath(fileName);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  }

  const browser = await chromium.launch({ headless: true });

  try {
    // 01 splash intro (forced)
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page, "?preview=splash");
      await waitAfterNavigation(1600);
      await take(page, OFFICIAL_FILES[0]);
    });

    // 02 onboarding slide 1
    await withFreshContext(browser, { onboardingDone: false }, async (page) => {
      await gotoApp(page);
      await waitAfterNavigation(1600);
      await take(page, OFFICIAL_FILES[1]);
    });

    // 03 login
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[2]);
    });

    // 04 register
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await clickAction(page, "Criar conta");
      await waitAfterNavigation(1200);
      await take(page, OFFICIAL_FILES[3]);
    });

    // 05 forgot password
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await clickAction(page, "Esqueci minha senha");
      await waitAfterNavigation(1200);
      await take(page, OFFICIAL_FILES[4]);
    });

    // 06 session expired
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await navigateGlobal(page, "SessionExpired", {
        reason: "Sessão de teste expirada para validação visual."
      });
      await waitAfterNavigation(1200);
      await take(page, OFFICIAL_FILES[5]);
    });

    // 07 profile selection
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await page.route("**/api/auth/login", async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        if (payload?.user?.email === "cliente@demo.com") {
          payload.user.role = null;
        }

        await route.fulfill({
          response,
          json: payload
        });
      });

      await login(page, "cliente@demo.com");
      await waitAfterNavigation(1200);
      await take(page, OFFICIAL_FILES[6]);
    });

    // 08 client home
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[7]);
    });

    // 09 categories
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateClientTab(page, "Categories");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[8]);
    });

    // 10 bookings
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateClientTab(page, "ClientBookings");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[9]);
    });

    // 11 favorites
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateClientTab(page, "Favorites");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[10]);
    });

    // 12 profile
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateClientTab(page, "ClientProfile");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[11]);
    });

    // 13 settings
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "ClientSettings");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[12]);
    });

    // 14-18
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);

      await navigateGlobal(page, "SearchProfessionals");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[13]);

      await navigateGlobal(page, "ProfessionalsList", { query: "Mariana" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[14]);

      await navigateGlobal(page, "ProfessionalDetail", { professionalId: "prov-1" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[15]);

      await navigateGlobal(page, "CreateBooking", { professionalId: "prov-1" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[16]);

      await navigateGlobal(page, "BookingConfirmation", { bookingId: "booking-client-1" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[17]);
    });

    // 19-21
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "ClientBookingDetail", { bookingId: "booking-client-1" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[18]);

      await navigateGlobal(page, "ClientConfirmCompletion", { bookingId: "booking-client-1" });
      await delay(900);
      await take(page, OFFICIAL_FILES[19]);

      await navigateGlobal(page, "ReviewProfessional", {
        bookingId: "booking-client-1",
        professionalId: "prov-1"
      });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[20]);
    });

    // 22 notifications
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "Notifications");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[21]);
    });

    // 23 support
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "Support");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[22]);
    });

    // 24 generic error
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "GenericError", {
        title: "Erro de teste",
        message: "Falha simulada para validação visual de tela."
      });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[23]);
    });

    // 25 offline
    await withFreshContext(browser, { onboardingDone: true }, async (page, context) => {
      await gotoApp(page);
      await waitLogin(page);
      await context.setOffline(true);
      await waitAfterNavigation(1500);
      await take(page, OFFICIAL_FILES[24]);
      await context.setOffline(false);
    });

    // 26 provider home
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[25]);
    });

    // 27 provider agenda
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateProfessionalTab(page, "ProfessionalAgenda");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[26]);
    });

    // 28-30
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateGlobal(page, "BookingDetailProfessional", { bookingId: "booking-provider-1" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[27]);

      await navigateGlobal(page, "ProfessionalConfirmCompletion", { bookingId: "booking-provider-1" });
      await delay(900);
      await take(page, OFFICIAL_FILES[28]);

      await navigateGlobal(page, "BookingPaymentStatus", { bookingId: "booking-provider-1" });
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[29]);
    });

    // 31-32
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateProfessionalTab(page, "ProfessionalProfileEditor");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[30]);

      await navigateGlobal(page, "AvailabilityManager");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[31]);
    });

    // 33
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateGlobal(page, "ConnectPayoutAccount");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[32]);
    });

    // 34
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await navigateProfessionalTab(page, "PayoutStatus");
      await waitAfterNavigation();
      await take(page, OFFICIAL_FILES[33]);
    });

    const missing = OFFICIAL_FILES.filter((name) => !fs.existsSync(path.join(OUT_DIR, name)));
    if (missing.length > 0) {
      throw new Error(`Missing official screenshot(s): ${missing.join(", ")}`);
    }

    console.log(`OK: ${OFFICIAL_FILES.length} screenshots oficiais gerados em ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

