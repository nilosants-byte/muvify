/**
 * Frente 13 (segunda camada), Lote 15: logout (desregistro de push, chamada
 * de logout ao backend) e parada de rastreamento de localização em
 * background nunca capturavam falha — sessão podia ficar "pendurada" no
 * backend sem que ninguém soubesse.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppStateProvider, useAppState } from "../state/AppState";
import { ToastProvider } from "../state/ToastState";
import { SubscriptionGateProvider } from "../state/SubscriptionGateState";
import { authApi, AuthUser, notificationsApi } from "../services/api/client";
import { getPushRegistrationPayload } from "../services/notifications/push";
import { stopProviderBackgroundLocation } from "../services/location/providerBackgroundLocation";
import { captureException } from "../observability/sentry";

jest.mock("../services/notifications/push", () => ({
  getPushRegistrationPayload: jest.fn().mockResolvedValue(null)
}));

jest.mock("../services/location/providerBackgroundLocation", () => ({
  stopProviderBackgroundLocation: jest.fn().mockResolvedValue(undefined),
  setProviderBackgroundLocationEnabled: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../observability/sentry", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setSentryUser: jest.fn(),
  addNavigationBreadcrumb: jest.fn()
}));

type Store = Record<string, string>;
let asyncStore: Store;
let secureStore: Store;
let context = {} as ReturnType<typeof useAppState>;

function ContextProbe() {
  context = useAppState();
  return null;
}

function buildSession(user: AuthUser, accessToken: string, refreshToken: string) {
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
  asyncStore = {};
  secureStore = {};
  jest.clearAllMocks();

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

  (getPushRegistrationPayload as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Frente 13, Lote 15 — captura de erro no logout e na parada de localização em background", () => {
  it("falha ao chamar authApi.logout no backend chama captureException, mas a sessão local ainda é encerrada", async () => {
    jest.spyOn(authApi, "login").mockResolvedValueOnce(
      buildSession({ id: "u1", name: "User", email: "u1@test.com", role: "CLIENT" }, "access-1", "refresh-1")
    );
    jest.spyOn(authApi, "logout").mockRejectedValueOnce(new Error("falha ao encerrar sessão no backend"));

    await renderProvider();
    await act(async () => {
      await context.login({ email: "u1@test.com", password: "StrongPass123" });
    });
    expect(context.isAuthenticated).toBe(true);

    await act(async () => {
      await context.signOut();
    });

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: "app-state-signout-logout-backend" })
    );
    expect(context.isAuthenticated).toBe(false);
  });

  it("falha ao desregistrar o device de push chama captureException, mas a sessão local ainda é encerrada", async () => {
    asyncStore["@personalapp/pushToken"] = "ExponentPushToken[teste]";
    jest.spyOn(authApi, "login").mockResolvedValueOnce(
      buildSession({ id: "u2", name: "User", email: "u2@test.com", role: "CLIENT" }, "access-2", "refresh-2")
    );
    jest.spyOn(authApi, "logout").mockResolvedValueOnce(undefined as any);
    jest.spyOn(notificationsApi, "unregisterDevice").mockRejectedValueOnce(
      new Error("falha ao desregistrar device")
    );

    await renderProvider();
    await act(async () => {
      await context.login({ email: "u2@test.com", password: "StrongPass123" });
    });

    await act(async () => {
      await context.signOut();
    });

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: "app-state-signout-unregister-push" })
    );
  });

  it("falha ao parar o rastreamento de localização em background chama captureException", async () => {
    (stopProviderBackgroundLocation as jest.Mock).mockRejectedValueOnce(
      new Error("falha ao parar rastreamento")
    );
    jest.spyOn(authApi, "login").mockResolvedValueOnce(
      buildSession({ id: "u3", name: "User", email: "u3@test.com", role: "PROVIDER" }, "access-3", "refresh-3")
    );
    jest.spyOn(authApi, "logout").mockResolvedValueOnce(undefined as any);

    await renderProvider();
    await act(async () => {
      await context.login({ email: "u3@test.com", password: "StrongPass123" });
    });

    await act(async () => {
      await context.signOut();
    });

    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ area: "app-state-stop-background-location" })
    );
  });
});
