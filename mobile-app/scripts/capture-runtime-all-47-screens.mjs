import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR =
  process.env.CAPTURE_OUT_DIR ??
  "C:/Users/Danilo/Documents/testes app/muvify-prints-runtime";
const APP_URL = process.env.CAPTURE_APP_URL ?? "http://127.0.0.1:8081";

const SCREEN_FILES = [
  "01-auth-splash-intro.png",
  "02-auth-onboarding.png",
  "03-auth-login.png",
  "04-auth-register.png",
  "05-auth-forgot-password.png",
  "06-auth-session-expired.png",
  "07-auth-profile-selection.png",
  "08-client-home.png",
  "09-client-categories.png",
  "10-client-promotions.png",
  "11-client-my-training.png",
  "12-client-bookings.png",
  "13-client-favorites.png",
  "14-client-profile.png",
  "15-client-settings.png",
  "16-client-anamnesis.png",
  "17-client-payment-method.png",
  "18-client-search.png",
  "19-client-professionals-list.png",
  "20-client-professional-detail.png",
  "21-client-consultancy-request.png",
  "22-client-archived-requests.png",
  "23-client-create-booking.png",
  "24-client-booking-confirmation.png",
  "25-client-booking-detail.png",
  "26-client-confirm-completion.png",
  "27-client-review-professional.png",
  "28-shared-notifications.png",
  "29-shared-support.png",
  "30-shared-generic-error.png",
  "31-shared-offline-required.png",
  "32-provider-home.png",
  "33-provider-agenda.png",
  "34-provider-consultancy-center.png",
  "35-provider-payout-status.png",
  "36-provider-notifications.png",
  "37-provider-profile-editor.png",
  "38-provider-settings.png",
  "39-provider-availability.png",
  "40-provider-archived-requests.png",
  "41-provider-booking-detail.png",
  "42-provider-confirm-completion.png",
  "43-provider-connect-payout.png",
  "44-provider-booking-payment-status.png",
  "45-provider-students.png",
  "46-provider-student-detail.png"
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const roleButtons = page
    .locator('[role="button"]')
    .filter({ hasText: /Ver perfil|Selecionar/i });
  if ((await roleButtons.count()) > 1) {
    if (role === "CLIENT") {
      await roleButtons.first().click();
    } else {
      await roleButtons.nth(1).click();
    }
  } else {
    await clickAction(page, "Ver perfil");
  }

  await page
    .getByText(/Escolher este perfil/i)
    .first()
    .waitFor({ timeout: 120000 });
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

  for (const fileName of SCREEN_FILES) {
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
      await take(page, SCREEN_FILES[0]);
    });

    // 02 onboarding slide 1
    await withFreshContext(browser, { onboardingDone: false }, async (page) => {
      await gotoApp(page);
      await waitAfterNavigation(1600);
      await take(page, SCREEN_FILES[1]);
    });

    // 03 login
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[2]);
    });

    // 04 register
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await clickAction(page, "Criar conta");
      await waitAfterNavigation(1200);
      await take(page, SCREEN_FILES[3]);
    });

    // 05 forgot password
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await clickAction(page, "Esqueci minha senha");
      await waitAfterNavigation(1200);
      await take(page, SCREEN_FILES[4]);
    });

    // 06 session expired
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await gotoApp(page);
      await waitLogin(page);
      await navigateGlobal(page, "SessionExpired", {
        reason: "Sessão de teste expirada para validação visual."
      });
      await waitAfterNavigation(1200);
      await take(page, SCREEN_FILES[5]);
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
      await take(page, SCREEN_FILES[6]);
    });

    // 08-14 client tabs
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[7]);

      await navigateClientTab(page, "Categories");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[8]);

      await navigateClientTab(page, "Promotions");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[9]);

      await navigateClientTab(page, "MyTraining");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[10]);

      await navigateClientTab(page, "ClientBookings");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[11]);

      await navigateClientTab(page, "Favorites");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[12]);

      await navigateClientTab(page, "ClientProfile");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[13]);
    });

    // 15-27 client stack extras
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterClientHome(page);

      await navigateGlobal(page, "ClientSettings");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[14]);

      await navigateGlobal(page, "ClientAnamnesis");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[15]);

      await navigateGlobal(page, "ClientPaymentMethod");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[16]);

      await navigateGlobal(page, "SearchProfessionals");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[17]);

      await navigateGlobal(page, "ProfessionalsList", { query: "Mariana" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[18]);

      await navigateGlobal(page, "ProfessionalDetail", { professionalId: "prov-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[19]);

      await navigateGlobal(page, "ConsultancyRequest", { professionalId: "prov-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[20]);

      await navigateGlobal(page, "ArchivedRequests");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[21]);

      await navigateGlobal(page, "CreateBooking", { professionalId: "prov-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[22]);

      await navigateGlobal(page, "BookingConfirmation", { bookingId: "booking-client-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[23]);

      await navigateGlobal(page, "ClientBookingDetail", { bookingId: "booking-client-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[24]);

      await navigateGlobal(page, "ClientConfirmCompletion", { bookingId: "booking-client-1" });
      await delay(900);
      await take(page, SCREEN_FILES[25]);

      await navigateGlobal(page, "ReviewProfessional", {
        bookingId: "booking-client-1",
        professionalId: "prov-1"
      });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[26]);
    });

    // 28-31 shared
    await withFreshContext(browser, { onboardingDone: true }, async (page, context) => {
      await loginAndEnterClientHome(page);
      await navigateGlobal(page, "Notifications");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[27]);

      await navigateGlobal(page, "Support");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[28]);

      await navigateGlobal(page, "GenericError", {
        title: "Erro de teste",
        message: "Falha simulada para validação visual de tela."
      });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[29]);

      await gotoApp(page);
      await waitLogin(page);
      await context.setOffline(true);
      await waitAfterNavigation(1500);
      await take(page, SCREEN_FILES[30]);
      await context.setOffline(false);
    });

    // 32-37 provider tabs
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[31]);

      await navigateProfessionalTab(page, "ProfessionalAgenda");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[32]);

      await navigateProfessionalTab(page, "ProfessionalConsultancyCenter");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[33]);

      await navigateProfessionalTab(page, "PayoutStatus");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[34]);

      await navigateProfessionalTab(page, "Notifications");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[35]);

      await navigateProfessionalTab(page, "ProfessionalProfileEditor");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[36]);
    });

    // 38-46 provider stack extras
    await withFreshContext(browser, { onboardingDone: true }, async (page) => {
      await loginAndEnterProviderHome(page);

      await navigateGlobal(page, "ProfessionalSettings");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[37]);

      await navigateGlobal(page, "AvailabilityManager");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[38]);

      await navigateGlobal(page, "ProfessionalArchivedRequests");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[39]);

      await navigateGlobal(page, "BookingDetailProfessional", { bookingId: "booking-provider-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[40]);

      await navigateGlobal(page, "ProfessionalConfirmCompletion", {
        bookingId: "booking-provider-1"
      });
      await delay(900);
      await take(page, SCREEN_FILES[41]);

      await navigateGlobal(page, "ConnectPayoutAccount");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[42]);

      await navigateGlobal(page, "BookingPaymentStatus", { bookingId: "booking-provider-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[43]);

      await navigateGlobal(page, "ProfessionalStudents");
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[44]);

      await navigateGlobal(page, "ProfessionalStudentDetail", { clientId: "user-client-1" });
      await waitAfterNavigation();
      await take(page, SCREEN_FILES[45]);
    });

    const missing = SCREEN_FILES.filter((name) => !fs.existsSync(path.join(OUT_DIR, name)));
    if (missing.length > 0) {
      throw new Error(`Missing screenshot(s): ${missing.join(", ")}`);
    }

    console.log(`OK: ${SCREEN_FILES.length} screenshots gerados em ${OUT_DIR}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
