import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { AppStateProvider, useAppState } from "../state/AppState";
import { ApiError, authApi, AuthUser, userApi } from "../services/api/client";
import { getPushRegistrationPayload } from "../services/notifications/push";

jest.mock("../services/notifications/push", () => ({
  getPushRegistrationPayload: jest.fn().mockResolvedValue(null)
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
    <AppStateProvider>
      <ContextProbe />
    </AppStateProvider>
  );
  await waitFor(() => expect(context.bootstrapping).toBe(false));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  asyncStore = {};
  secureStore = {};

  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => asyncStore[key] ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    asyncStore[key] = value;
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    delete asyncStore[key];
  });

  (SecureStore.getItemAsync as jest.Mock).mockImplementation(
    async (key: string) => secureStore[key] ?? null
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    async (key: string, value: string) => {
      secureStore[key] = value;
    }
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    delete secureStore[key];
  });

  (getPushRegistrationPayload as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AppStateProvider - fluxos criticos", () => {
  it("hidrata sessão válida e infere role a partir do usuario", async () => {
    asyncStore["@personalapp/onboardingDone"] = "1";
    asyncStore["@personalapp/role"] = "CLIENT";
    secureStore["personalapp.accessToken"] = "access-1";
    secureStore["personalapp.refreshToken"] = "refresh-1";

    jest.spyOn(userApi, "me").mockResolvedValue({
      id: "u1",
      name: "Provider User",
      email: "provider@test.com",
      role: "PROVIDER"
    });

    await renderProvider();

    expect(context.onboardingDone).toBe(true);
    expect(context.isAuthenticated).toBe(true);
    expect(context.role).toBe("PROVIDER");
    expect(context.user?.email).toBe("provider@test.com");
    expect(userApi.me).toHaveBeenCalledWith("access-1");
  });

  it("faz refresh automatico quando access token expirou na hidratacao", async () => {
    secureStore["personalapp.accessToken"] = "expired-access";
    secureStore["personalapp.refreshToken"] = "refresh-ok";

    jest.spyOn(userApi, "me").mockRejectedValue(new ApiError(401, "expired"));
    jest.spyOn(authApi, "refresh").mockResolvedValue(
      buildSession(
        {
          id: "u2",
          name: "Client User",
          email: "client@test.com",
          role: "CLIENT"
        },
        "access-2",
        "refresh-2"
      )
    );

    await renderProvider();

    expect(authApi.refresh).toHaveBeenCalledWith("refresh-ok");
    expect(context.isAuthenticated).toBe(true);
    expect(context.role).toBe("CLIENT");
    expect(context.user?.id).toBe("u2");
  });

  it("usa role escolhida no cadastro e encerra sessão no signOut", async () => {
    jest.spyOn(authApi, "register").mockResolvedValue(
      buildSession(
        {
          id: "u3",
          name: "New Provider",
          email: "new-provider@test.com",
          role: "PROVIDER"
        },
        "access-3",
        "refresh-3"
      )
    );
    jest.spyOn(authApi, "logout").mockResolvedValue();

    await renderProvider();

    await act(async () => {
      await context.chooseRole("PROVIDER");
    });

    await act(async () => {
      await context.register({
        name: "New Provider",
        email: "new-provider@test.com",
        password: "StrongPass123",
        phone: "11999998888",
        termsVersion: "2026.05",
        consentAccepted: true
      });
    });

    expect(authApi.register).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "PROVIDER"
      })
    );
    expect(context.isAuthenticated).toBe(true);

    await act(async () => {
      await context.signOut();
    });

    expect(authApi.logout).toHaveBeenCalledWith("refresh-3");
    expect(context.isAuthenticated).toBe(false);
    expect(context.user).toBeNull();
  });

  it("runWithAuth faz retry após 401 quando refresh ocorre com sucesso", async () => {
    jest.spyOn(authApi, "login").mockResolvedValue(
      buildSession(
        {
          id: "u4",
          name: "Retry User",
          email: "retry@test.com",
          role: "CLIENT"
        },
        "access-old",
        "refresh-old"
      )
    );
    jest.spyOn(authApi, "refresh").mockResolvedValue(
      buildSession(
        {
          id: "u4",
          name: "Retry User",
          email: "retry@test.com",
          role: "CLIENT"
        },
        "access-new",
        "refresh-new"
      )
    );

    await renderProvider();

    await act(async () => {
      await context.login({ email: "retry@test.com", password: "StrongPass123" });
    });

    let attempts = 0;
    const operation = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError(401, "expired");
      }
      return "ok";
    });

    let result: string | undefined;
    await act(async () => {
      result = await context.runWithAuth(operation);
    });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(authApi.refresh).toHaveBeenCalledWith("refresh-old");
  });

  it("runWithAuth falha sem token, preserva sessão em erro de rede e invalida em refresh 401", async () => {
    await renderProvider();

    let noSessionError: unknown;
    await act(async () => {
      try {
        await context.runWithAuth(async () => "x");
      } catch (error) {
        noSessionError = error;
      }
    });
    expect((noSessionError as Error).message).toContain("Sessão inválida. Faça login novamente.");

    jest.spyOn(authApi, "login").mockResolvedValue(
      buildSession(
        {
          id: "u5",
          name: "Expired User",
          email: "expired@test.com",
          role: "CLIENT"
        },
        "access-e1",
        "refresh-e1"
      )
    );
    jest.spyOn(authApi, "refresh").mockRejectedValue(new Error("refresh failed"));

    await act(async () => {
      await context.login({ email: "expired@test.com", password: "StrongPass123" });
    });

    let expiredError: unknown;
    await act(async () => {
      try {
        await context.runWithAuth(async () => {
          throw new ApiError(401, "expired");
        });
      } catch (error) {
        expiredError = error;
      }
    });
    expect((expiredError as Error).message).toContain("Falha de conexão ao renovar sessão. Tente novamente.");
    expect(context.isAuthenticated).toBe(true);

    (authApi.refresh as jest.Mock).mockRejectedValueOnce(
      new ApiError(401, "refresh expired")
    );

    let trulyExpiredError: unknown;
    await act(async () => {
      try {
        await context.runWithAuth(async () => {
          throw new ApiError(401, "expired");
        });
      } catch (error) {
        trulyExpiredError = error;
      }
    });

    expect((trulyExpiredError as Error).message).toContain("Sessão expirada. Faça login novamente.");
    await waitFor(() => expect(context.isAuthenticated).toBe(false));
  });
});



