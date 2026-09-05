import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppStateProvider, useAppState } from "../state/AppState";
import { ToastProvider } from "../state/ToastState";
import { SubscriptionGateProvider } from "../state/SubscriptionGateState";
import { authApi } from "../services/api/client";
import { identifyUser, applyAnalyticsPreference } from "../services/analytics";

// Épico de Frentes, Frente 11, Lote 4: PostHog rodava por padrão (opt-out)
// antes de qualquer consentimento, e identifyUser mandava o nome real do
// usuário pro PostHog (servidor na Europa) sem necessidade.
jest.mock("../services/notifications/push", () => ({
  getPushRegistrationPayload: jest.fn().mockResolvedValue(null)
}));

jest.mock("../services/analytics", () => ({
  identifyUser: jest.fn(),
  trackEvent: jest.fn(),
  resetAnalyticsUser: jest.fn(),
  applyAnalyticsPreference: jest.fn()
}));

type Store = Record<string, string>;

let asyncStore: Store;
let secureStore: Store;
let context = {} as ReturnType<typeof useAppState>;

function ContextProbe() {
  context = useAppState();
  return null;
}

function buildSession(
  user: { id: string; name: string; email: string; role: "CLIENT" | "PROVIDER" | "ADMIN" },
  accessToken: string,
  refreshToken: string
) {
  return { user, accessToken, refreshToken };
}

async function renderProvider() {
  render(
    <ToastProvider>
      <SubscriptionGateProvider>
        <AppStateProvider>
          <ContextProbe />
        </AppStateProvider>
      </SubscriptionGateProvider>
    </ToastProvider>
  );
  await waitFor(() => expect(context.bootstrapping).toBe(false));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  asyncStore = {};
  secureStore = {};

  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => asyncStore[key] ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    asyncStore[key] = value;
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    delete asyncStore[key];
  });

  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => secureStore[key] ?? null);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    secureStore[key] = value;
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    delete secureStore[key];
  });
});

describe("Consentimento de analytics (PostHog)", () => {
  it("analyticsEnabled começa desligado (opt-in) quando não há preferência salva", async () => {
    await renderProvider();

    expect(context.analyticsEnabled).toBe(false);
    expect(applyAnalyticsPreference).toHaveBeenCalledWith(false);
  });

  it("preferência salva como ligada é respeitada (opt-in explícito persiste)", async () => {
    asyncStore["@personalapp/analyticsEnabled"] = "1";
    await renderProvider();

    expect(context.analyticsEnabled).toBe(true);
    expect(applyAnalyticsPreference).toHaveBeenCalledWith(true);
  });

  it("login chama identifyUser sem enviar o nome do usuário", async () => {
    jest.spyOn(authApi, "login").mockResolvedValue(
      buildSession(
        { id: "u1", name: "Nome Sensível Do Usuário", email: "consent@test.com", role: "CLIENT" },
        "access-1",
        "refresh-1"
      )
    );

    await renderProvider();
    await act(async () => {
      await context.login({ email: "consent@test.com", password: "StrongPass123" });
    });

    expect(identifyUser).toHaveBeenCalledWith("u1", { role: "CLIENT" });
    const call = (identifyUser as jest.Mock).mock.calls[0];
    expect(call[1]).not.toHaveProperty("name");
  });
});
