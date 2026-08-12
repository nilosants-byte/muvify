import {
  apiRequest,
  ApiError,
  authApi,
  availabilityApi,
  bookingsApi,
  categoriesApi,
  favoritesApi,
  notificationsApi,
  paymentsApi,
  providersApi,
  reviewsApi,
  userApi
} from "../services/api/client";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => "application/json"
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  } as unknown as Response;
}

function noContentResponse() {
  return {
    ok: true,
    status: 204,
    headers: {
      get: () => null
    },
    json: async () => undefined,
    text: async () => ""
  } as unknown as Response;
}

describe("api client - fluxos criticos", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("apiRequest retorna payload e propaga ApiError com mensagem da API", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const ok = await apiRequest<{ ok: boolean }>("/health");
    expect(ok.ok).toBe(true);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Falha de validação" }, 400)
    );

    await expect(apiRequest("/bad")).rejects.toMatchObject({
      status: 400,
      message: "Falha de validação"
    } as Partial<ApiError>);
  });

  it("Frente 10 (segunda camada), Lote 3: sem mensagem amigável do backend, cai num texto em português (nunca 'HTTP 500' cru)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const err500 = (await apiRequest("/broken").catch((e) => e)) as ApiError;
    expect(err500.status).toBe(500);
    expect(err500.message).not.toMatch(/^HTTP \d+/);

    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    const err401 = (await apiRequest("/needs-auth").catch((e) => e)) as ApiError;
    expect(err401.message).not.toMatch(/^HTTP \d+/);
    expect(err401.message.toLowerCase()).toContain("sessão");
  });

  it("executa endpoints de auth e user", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ user: { id: "u1" }, accessToken: "a", refreshToken: "r" }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: "u1" }, accessToken: "a2", refreshToken: "r2" }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: "u1" }, accessToken: "a3", refreshToken: "r3" }))
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ message: "ok", resetToken: "t1" }))
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ id: "u1", name: "User", email: "u@test.com", role: "CLIENT" }));

    await authApi.register({
      name: "User",
      email: "u@test.com",
      password: "StrongPass123",
      phone: "11999998888",
      role: "CLIENT",
      termsVersion: "2026.05",
      consentAccepted: true
    });
    await authApi.login({ email: "u@test.com", password: "StrongPass123" });
    await authApi.refresh("refresh-token");
    await authApi.logout("refresh-token");
    await authApi.forgotPassword({ channel: "EMAIL", email: "u@test.com" });
    await authApi.resetPassword({ token: "token", newPassword: "NewPass123" });
    await userApi.me("access-token");

    expect(fetchMock.mock.calls[0][0]).toContain("/auth/register");
    expect(fetchMock.mock.calls[1][0]).toContain("/auth/login");
    expect(fetchMock.mock.calls[2][0]).toContain("/auth/refresh");
    expect(fetchMock.mock.calls[3][0]).toContain("/auth/logout");
    expect(fetchMock.mock.calls[4][0]).toContain("/auth/forgot-password");
    expect(fetchMock.mock.calls[5][0]).toContain("/auth/reset-password");
    expect(fetchMock.mock.calls[6][0]).toContain("/users/me");
  });

  it("executa endpoints de categorias, providers, disponibilidade e agendamentos", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ id: "c1", name: "Personal" }]))
      .mockResolvedValueOnce(jsonResponse([{ id: "p1", displayName: "Pro A" }]))
      .mockResolvedValueOnce(jsonResponse({ id: "p1", displayName: "Pro A" }))
      .mockResolvedValueOnce(jsonResponse({ id: "profile-1" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "slot-1" }]))
      .mockResolvedValueOnce(jsonResponse({ id: "slot-2" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "b1" }]))
      .mockResolvedValueOnce(jsonResponse({ id: "b2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "b2", status: "CONFIRMED" }));

    await categoriesApi.list();
    await providersApi.list({ categoryId: "c1", q: "car", minRating: 4 });
    await providersApi.detail("p1");
    await providersApi.createProfile("token", {
      displayName: "Pro A",
      bio: "Bio",
      experienceYears: 2,
      priceCents: 10000,
      serviceRadiusKm: 12,
      categoryIds: ["c1"]
    });
    await availabilityApi.me("token");
    await availabilityApi.create("token", {
      weekday: 1,
      startTime: "09:00",
      endTime: "18:00",
      isActive: true
    });
    await bookingsApi.me("token");
    await bookingsApi.create("token", {
      providerId: "p1",
      categoryId: "c1",
      scheduledAt: "2026-04-01T10:00:00.000Z",
      notes: "Treino"
    });
    await bookingsApi.updateStatus("token", "b2", "CONFIRMED");

    expect(fetchMock.mock.calls[0][0]).toContain("/categories");
    expect(fetchMock.mock.calls[1][0]).toContain("/providers?");
    expect(fetchMock.mock.calls[2][0]).toContain("/providers/p1");
    expect(fetchMock.mock.calls[3][0]).toContain("/providers/profile");
    expect(fetchMock.mock.calls[4][0]).toContain("/availability/me");
    expect(fetchMock.mock.calls[5][0]).toContain("/availability");
    expect(fetchMock.mock.calls[6][0]).toContain("/bookings/me");
    expect(fetchMock.mock.calls[7][0]).toContain("/bookings");
    expect(fetchMock.mock.calls[8][0]).toContain("/bookings/b2/status");
  });

  it("executa endpoints de reviews, favoritos e pagamentos", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "r1" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "f1" }]))
      .mockResolvedValueOnce(jsonResponse({ id: "f2" }))
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ configured: true, hasCustomer: true, hasDefaultPaymentMethod: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          setupIntentId: "seti_1",
          setupIntentClientSecret: "secret",
          customerId: "cus_1",
          ephemeralKeySecret: "eph_1"
        })
      )
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse({ accountId: "acct_1", onboardingUrl: "https://onboard2" }))
      .mockResolvedValueOnce(jsonResponse({ hasAccount: true, accountId: "acct_1", chargesEnabled: true, payoutsEnabled: true }))
      .mockResolvedValueOnce(jsonResponse({ id: "pay_1", status: "AUTHORIZED", amountCents: 10000, currency: "BRL", bookingId: "b1" }));

    await reviewsApi.create("token", {
      bookingId: "b1",
      rating: 5,
      comment: "Excelente"
    });
    await favoritesApi.list("token");
    await favoritesApi.add("token", "provider-1");
    await favoritesApi.remove("token", "provider-1");
    await paymentsApi.customerStatus("token");
    await paymentsApi.createCustomerSetupIntent("token");
    await paymentsApi.confirmCustomerSetupIntent("token", "seti_1");
    await paymentsApi.setupCustomer("token", "pm_1");
    await paymentsApi.createOnboardingLink("token");
    await paymentsApi.providerStatus("token");
    await paymentsApi.bookingPayment("token", "b1");

    expect(fetchMock.mock.calls[0][0]).toContain("/reviews");
    expect(fetchMock.mock.calls[1][0]).toContain("/favorites");
    expect(fetchMock.mock.calls[2][0]).toContain("/favorites");
    expect(fetchMock.mock.calls[3][0]).toContain("/favorites/provider-1");
    expect(fetchMock.mock.calls[4][0]).toContain("/payments/customer");
    expect(fetchMock.mock.calls[5][0]).toContain("/payments/customer/setup-intent");
    expect(fetchMock.mock.calls[6][0]).toContain(
      "/payments/customer/setup-intent/confirm"
    );
    expect(fetchMock.mock.calls[7][0]).toContain("/payments/customer/setup");
    expect(fetchMock.mock.calls[8][0]).toContain(
      "/payments/provider/account/onboarding-link"
    );
    expect(fetchMock.mock.calls[9][0]).toContain("/payments/provider/account");
    expect(fetchMock.mock.calls[10][0]).toContain("/payments/booking/b1");
  });

  it("executa endpoints de notificações push", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "pd1",
            token: "ExponentPushToken[testPushToken123]",
            platform: "ANDROID",
            isActive: true,
            lastSeenAt: "2026-03-17T10:00:00.000Z",
            createdAt: "2026-03-17T10:00:00.000Z",
            updatedAt: "2026-03-17T10:00:00.000Z"
          }
        ])
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "pd1",
          token: "ExponentPushToken[testPushToken123]",
          platform: "ANDROID",
          isActive: true,
          lastSeenAt: "2026-03-17T10:00:00.000Z",
          createdAt: "2026-03-17T10:00:00.000Z",
          updatedAt: "2026-03-17T10:00:00.000Z"
        })
      )
      .mockResolvedValueOnce(noContentResponse());

    await notificationsApi.listDevices("token");
    await notificationsApi.registerDevice("token", {
      token: "ExponentPushToken[testPushToken123]",
      platform: "android",
      appVersion: "1.0.0",
      deviceName: "Pixel"
    });
    await notificationsApi.unregisterDevice("token", "ExponentPushToken[testPushToken123]");

    expect(fetchMock.mock.calls[0][0]).toContain("/notifications/devices");
    expect(fetchMock.mock.calls[1][0]).toContain("/notifications/devices");
    expect(fetchMock.mock.calls[2][0]).toContain("/notifications/devices");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: "DELETE"
    });
  });
});


