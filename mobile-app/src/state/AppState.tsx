import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { captureException, setSentryUser } from "../observability/sentry";
import { identifyUser, resetAnalyticsUser, trackEvent } from "../services/analytics";
import {
  ApiError,
  authApi,
  AuthLoginResponse,
  AuthLoginTwoFactorChallenge,
  AuthUser,
  notificationsApi,
  userApi
} from "../services/api/client";
import { stopProviderBackgroundLocation } from "../services/location/providerBackgroundLocation";
import { getPushRegistrationPayload } from "../services/notifications/push";
import { ThemeMode, setThemeMode } from "../theme/tokens";

type UserRole = "CLIENT" | "PROVIDER" | "ADMIN";
type ToastType = "success" | "error" | "info";

type ToastPayload = {
  id: number;
  message: string;
  type: ToastType;
};

type AppStateContextValue = {
  bootstrapping: boolean;
  onboardingDone: boolean;
  isAuthenticated: boolean;
  themeMode: ThemeMode;
  role: UserRole | null;
  user: AuthUser | null;
  toast: ToastPayload | null;
  completeOnboarding: () => Promise<void>;
  chooseRole: (role: UserRole) => Promise<void>;
  setThemePreference: (mode: ThemeMode) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<{ requiresTwoFactor: true; challengeToken: string } | void>;
  completeTwoFactorLogin: (challengeToken: string, code: string) => Promise<void>;
  register: (input: {
    name: string;
    apelido?: string;
    email: string;
    password: string;
    phone: string;
    termsVersion: string;
    consentAccepted: true;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  setCurrentUser: (user: AuthUser) => void;
  syncCurrentUser: () => Promise<AuthUser | null>;
  runWithAuth: <T>(operation: (accessToken: string) => Promise<T>) => Promise<T>;
  showToast: (message: string, type?: ToastType) => void;
  clearToast: () => void;
};

const STORAGE_KEYS = {
  onboardingDone: "@personalapp/onboardingDone",
  themeMode: "@personalapp/themeMode",
  role: "@personalapp/role",
  roleUserId: "@personalapp/roleUserId",
  pushToken: "@personalapp/pushToken",
  pushTokenUserId: "@personalapp/pushTokenUserId",
  userCache: "@personalapp/userCache"
} as const;

async function saveUserCache(user: AuthUser) {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.userCache, JSON.stringify(user));
  } catch {
    // best effort — não bloqueia o fluxo principal
  }
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).email === "string" &&
    typeof (value as Record<string, unknown>).role === "string"
  );
}

async function loadUserCache(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.userCache);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const SECURE_KEYS = {
  accessToken: "personalapp.accessToken",
  refreshToken: "personalapp.refreshToken"
} as const;

const WEB_SECURE_FALLBACK_KEYS = {
  accessToken: "@personalapp/secure/accessToken",
  refreshToken: "@personalapp/secure/refreshToken"
} as const;

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

function resolveSessionRole(user: AuthUser, preferredRole: UserRole | null): UserRole | null {
  if (user.role === "ADMIN") {
    return "ADMIN";
  }
  if (user.role === "CLIENT" || user.role === "PROVIDER") {
    if (preferredRole && preferredRole === user.role) {
      return preferredRole;
    }
    return user.role;
  }
  return null;
}

function isTwoFactorChallenge(
  payload: AuthLoginResponse
): payload is AuthLoginTwoFactorChallenge {
  return "requiresTwoFactor" in payload && payload.requiresTwoFactor === true;
}

async function secureSet(
  key: (typeof SECURE_KEYS)[keyof typeof SECURE_KEYS],
  fallbackKey: (typeof WEB_SECURE_FALLBACK_KEYS)[keyof typeof WEB_SECURE_FALLBACK_KEYS],
  value: string
) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    if (Platform.OS === "web") {
      await AsyncStorage.setItem(fallbackKey, value);
      return;
    }
    throw new Error("Falha ao armazenar token em SecureStore.");
  }
}

async function secureGet(
  key: (typeof SECURE_KEYS)[keyof typeof SECURE_KEYS],
  fallbackKey: (typeof WEB_SECURE_FALLBACK_KEYS)[keyof typeof WEB_SECURE_FALLBACK_KEYS]
) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    if (Platform.OS === "web") {
      return AsyncStorage.getItem(fallbackKey);
    }
    throw new Error("Falha ao ler token em SecureStore.");
  }
}

async function secureDelete(
  key: (typeof SECURE_KEYS)[keyof typeof SECURE_KEYS],
  fallbackKey: (typeof WEB_SECURE_FALLBACK_KEYS)[keyof typeof WEB_SECURE_FALLBACK_KEYS]
) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    if (Platform.OS === "web") {
      await AsyncStorage.removeItem(fallbackKey);
      return;
    }
    throw new Error("Falha ao remover token em SecureStore.");
  }
}

async function saveTokens(accessToken: string, refreshToken: string) {
  await Promise.all([
    secureSet(SECURE_KEYS.accessToken, WEB_SECURE_FALLBACK_KEYS.accessToken, accessToken),
    secureSet(SECURE_KEYS.refreshToken, WEB_SECURE_FALLBACK_KEYS.refreshToken, refreshToken)
  ]);
}

async function clearTokens() {
  await Promise.all([
    secureDelete(SECURE_KEYS.accessToken, WEB_SECURE_FALLBACK_KEYS.accessToken),
    secureDelete(SECURE_KEYS.refreshToken, WEB_SECURE_FALLBACK_KEYS.refreshToken)
  ]);
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark");
  const [role, setRole] = useState<UserRole | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastPayload | null>(null);

  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  // Singleton promise: evita múltiplos refreshes simultâneos quando várias
  // operações falham com 401 ao mesmo tempo (race condition)
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    refreshTokenRef.current = refreshToken;
  }, [refreshToken]);

  useEffect(() => {
    setSentryUser(user);
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !accessToken) {
      return;
    }

    const currentUserId = user.id;
    const currentAccessToken = accessToken;
    let cancelled = false;

    async function syncPushToken() {
      try {
        const payload = await getPushRegistrationPayload();
        if (!payload || cancelled) {
          return;
        }

        const [storedPushToken, storedPushTokenUserId] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.pushToken),
          AsyncStorage.getItem(STORAGE_KEYS.pushTokenUserId)
        ]);

        if (storedPushToken === payload.token && storedPushTokenUserId === currentUserId) {
          return;
        }

        await notificationsApi.registerDevice(currentAccessToken, payload);
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEYS.pushToken, payload.token),
          AsyncStorage.setItem(STORAGE_KEYS.pushTokenUserId, currentUserId)
        ]);
      } catch (error) {
        captureException(error, { stage: "app_state_sync_push_token" });
      }
    }

    void syncPushToken();
    return () => {
      cancelled = true;
    };
  }, [accessToken, isAuthenticated, user?.id]);

  const loadPreferredRoleForUser = useCallback(async (userId: string) => {
    const [storedRole, storedRoleUserId] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.role),
      AsyncStorage.getItem(STORAGE_KEYS.roleUserId)
    ]);

    if (
      (storedRole === "CLIENT" || storedRole === "PROVIDER" || storedRole === "ADMIN") &&
      storedRoleUserId === userId
    ) {
      return storedRole;
    }

    if (storedRoleUserId && storedRoleUserId !== userId) {
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.role),
        AsyncStorage.removeItem(STORAGE_KEYS.roleUserId)
      ]);
    }

    return null;
  }, []);

  const setSession = useCallback(async (input: {
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
  }) => {
    // Update refs synchronously so runWithAuth sees the new token immediately,
    // before any child component effects fire (React runs child effects before parent effects).
    accessTokenRef.current = input.accessToken;
    refreshTokenRef.current = input.refreshToken;
    // Set role synchronously with the other state so there is no render cycle
    // where isAuthenticated=true but role=null, which would flash AuthProfileSelectionScreen.
    const immediateRole = resolveSessionRole(input.user, null);
    setUser(input.user);
    setAccessToken(input.accessToken);
    setRefreshToken(input.refreshToken);
    setRole(immediateRole);
    setIsAuthenticated(true);
    await Promise.all([
      saveTokens(input.accessToken, input.refreshToken),
      saveUserCache(input.user)
    ]);
    const preferredRole = await loadPreferredRoleForUser(input.user.id);
    setRole(resolveSessionRole(input.user, preferredRole));
  }, [loadPreferredRoleForUser]);

  const clearSession = useCallback(async () => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    refreshInFlightRef.current = null;
    setIsAuthenticated(false);
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    setToast(null);
    try {
      await stopProviderBackgroundLocation({ preservePreference: true });
    } catch {
      // best effort
    }
    await Promise.all([
      clearTokens(),
      AsyncStorage.removeItem(STORAGE_KEYS.pushToken),
      AsyncStorage.removeItem(STORAGE_KEYS.pushTokenUserId),
      AsyncStorage.removeItem(STORAGE_KEYS.userCache),
      AsyncStorage.removeItem(STORAGE_KEYS.role),
      AsyncStorage.removeItem(STORAGE_KEYS.roleUserId),
    ]);
  }, []);

  useEffect(() => {
    // Timeout de segurança: se bootstrap travar, desbloqueia o app em 10s
    const bootstrapTimeout = setTimeout(() => setBootstrapping(false), 10_000);
    async function hydrate() {
      try {
        const [storedOnboarding, storedAccessToken, storedRefreshToken, storedThemeMode, cachedUser] =
          await Promise.all([
            AsyncStorage.getItem(STORAGE_KEYS.onboardingDone),
            secureGet(SECURE_KEYS.accessToken, WEB_SECURE_FALLBACK_KEYS.accessToken),
            secureGet(SECURE_KEYS.refreshToken, WEB_SECURE_FALLBACK_KEYS.refreshToken),
            AsyncStorage.getItem(STORAGE_KEYS.themeMode),
            loadUserCache()
          ]);

        // Usuário com sessão existente mas sem onboarding marcado = usuário antigo.
        // Auto-completa silenciosamente para não forçar onboarding em quem já usa o app.
        if (storedAccessToken && storedOnboarding !== "1") {
          await AsyncStorage.setItem(STORAGE_KEYS.onboardingDone, "1");
          setOnboardingDone(true);
        } else {
          setOnboardingDone(storedOnboarding === "1");
        }
        setAccessToken(storedAccessToken ?? null);
        setRefreshToken(storedRefreshToken ?? null);
        if (storedThemeMode === "light" || storedThemeMode === "dark") {
          setThemeModeState(storedThemeMode);
          setThemeMode(storedThemeMode);
        }

        if (!storedAccessToken) {
          setRole(null);
          return;
        }

        // Aplica dados em cache imediatamente — UI mostra foto/nome corretos sem esperar a API
        if (cachedUser && cachedUser.id) {
          setUser(cachedUser);
          setIsAuthenticated(true);
          const preferredRole = await loadPreferredRoleForUser(cachedUser.id);
          setRole(resolveSessionRole(cachedUser, preferredRole));
          setBootstrapping(false);
        } else {
          setRole(null);
        }

        // Atualiza com dados frescos em segundo plano
        try {
          const me = await userApi.me(storedAccessToken);
          setUser(me);
          setIsAuthenticated(true);
          void saveUserCache(me);
          const preferredRole = await loadPreferredRoleForUser(me.id);
          setRole(resolveSessionRole(me, preferredRole));
        } catch (error) {
          captureException(error, { stage: "app_state_hydrate_me" });
          if (!(error instanceof ApiError) || error.status !== 401 || !storedRefreshToken) {
            if (!cachedUser) await clearSession();
            return;
          }

          try {
            const refreshed = await authApi.refresh(storedRefreshToken);
            await setSession(refreshed);
          } catch (refreshError) {
            captureException(refreshError, { stage: "app_state_hydrate_refresh" });
            await clearSession();
          }
        }
      } finally {
        setBootstrapping(false);
      }
    }

    hydrate().finally(() => clearTimeout(bootstrapTimeout));
  }, []);

  async function completeOnboarding() {
    setOnboardingDone(true);
    await AsyncStorage.setItem(STORAGE_KEYS.onboardingDone, "1");
  }

  async function setThemePreference(nextMode: ThemeMode) {
    setThemeModeState(nextMode);
    setThemeMode(nextMode);
    await AsyncStorage.setItem(STORAGE_KEYS.themeMode, nextMode);
  }

  async function chooseRole(nextRole: UserRole) {
    if (user && user.role !== nextRole) {
      setRole(resolveSessionRole(user, null));
      return;
    }
    setRole(nextRole);
    const currentUserId = user?.id;
    await AsyncStorage.setItem(STORAGE_KEYS.role, nextRole);
    if (currentUserId) {
      await AsyncStorage.setItem(STORAGE_KEYS.roleUserId, currentUserId);
    }
  }

  async function login(input: { email: string; password: string }): Promise<{ requiresTwoFactor: true; challengeToken: string } | void> {
    const session = await authApi.login(input);
    if (isTwoFactorChallenge(session)) {
      return { requiresTwoFactor: true, challengeToken: session.challengeToken };
    }
    await setSession(session);
    identifyUser(session.user.id, { name: session.user.name, role: session.user.role });
    trackEvent("user_logged_in", { role: session.user.role });
  }

  async function completeTwoFactorLogin(challengeToken: string, code: string) {
    const session = await authApi.loginWithTwoFactor({ challengeToken, code });
    await setSession(session);
    identifyUser(session.user.id, { name: session.user.name, role: session.user.role });
    trackEvent("user_logged_in", { role: session.user.role, method: "2fa" });
  }

  async function register(input: {
    name: string;
    apelido?: string;
    email: string;
    password: string;
    phone: string;
    termsVersion: string;
    consentAccepted: true;
  }) {
    const registrationRole =
      role === "CLIENT" || role === "PROVIDER"
        ? role
        : undefined;
    const session = await authApi.register({
      ...input,
      role: registrationRole
    });
    await setSession(session);
    identifyUser(session.user.id, { name: session.user.name, role: session.user.role });
    trackEvent("user_registered", { role: session.user.role ?? registrationRole });
  }

  async function signOut() {
    trackEvent("user_logged_out");
    resetAnalyticsUser();
    const currentRefreshToken = refreshTokenRef.current;
    const currentAccessToken = accessTokenRef.current;

    if (currentAccessToken) {
      try {
        const storedPushToken = await AsyncStorage.getItem(STORAGE_KEYS.pushToken);
        if (storedPushToken) {
          await notificationsApi.unregisterDevice(currentAccessToken, storedPushToken);
        }
      } catch {
        // best effort; session will still be removed locally
      }
    }

    if (currentRefreshToken) {
      try {
        await authApi.logout(currentRefreshToken);
      } catch {
        // best effort; session will still be removed locally
      }
    }

    await clearSession();
  }

  async function refreshSession() {
    const currentRefreshToken = refreshTokenRef.current;
    if (!currentRefreshToken) {
      await clearSession();
      return false;
    }

    try {
      if (!refreshInFlightRef.current) {
        refreshInFlightRef.current = authApi.refresh(currentRefreshToken)
          .then((refreshed) => setSession(refreshed))
          .finally(() => { refreshInFlightRef.current = null; });
      }
      await refreshInFlightRef.current;
      return true;
    } catch (error) {
      captureException(error, { stage: "app_state_refresh_session" });
      const shouldInvalidateSession =
        error instanceof ApiError &&
        (error.status === 400 || error.status === 401 || error.status === 403);
      if (shouldInvalidateSession) {
        await clearSession();
      }
      return false;
    }
  }

  const setCurrentUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    setRole((currentRole) => resolveSessionRole(nextUser, currentRole));
    void saveUserCache(nextUser);
  }, []);

  const syncCurrentUser = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token) {
      return null;
    }
    const me = await userApi.me(token);
    setCurrentUser(me);
    return me;
  }, [setCurrentUser]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    setToast({ id: Date.now() + Math.random() * 100_000, message, type });
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const runWithAuth = useCallback(async <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
    const token = accessTokenRef.current;
    if (!token) {
      showToast("Sessão inválida. Faça login novamente.", "error");
      throw new Error("Sessão inválida. Faça login novamente.");
    }

    try {
      return await operation(token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const currentRefreshToken = refreshTokenRef.current;
        if (!currentRefreshToken) {
          await clearSession();
          showToast("Sessão expirada. Faça login novamente.", "error");
          throw new Error("Sessão expirada. Faça login novamente.");
        }
        try {
          // Reutiliza refresh em andamento se já existe (evita race condition)
          if (!refreshInFlightRef.current) {
            refreshInFlightRef.current = authApi.refresh(currentRefreshToken)
              .then((refreshed) => setSession(refreshed))
              .finally(() => { refreshInFlightRef.current = null; });
          }
          await refreshInFlightRef.current;
          const newToken = accessTokenRef.current;
          if (!newToken) {
            showToast("Sessão expirada. Faça login novamente.", "error");
            throw new Error("Sessão expirada. Faça login novamente.");
          }
          return operation(newToken);
        } catch (refreshError) {
          captureException(refreshError, { stage: "app_state_run_with_auth_refresh" });
          const shouldInvalidateSession =
            refreshError instanceof ApiError &&
            (refreshError.status === 400 ||
              refreshError.status === 401 ||
              refreshError.status === 403);
          if (shouldInvalidateSession) {
            await clearSession();
            showToast("Sessão expirada. Faça login novamente.", "error");
            throw new Error("Sessão expirada. Faça login novamente.");
          }
          showToast("Falha de conexão ao renovar sessão. Tente novamente.", "error");
          throw new Error("Falha de conexão ao renovar sessão. Tente novamente.");
        }
      }
      captureException(error, { stage: "app_state_run_with_auth" });
      throw error;
    }
  }, [clearSession, setSession, showToast]);

  const value = useMemo(
    () => ({
      bootstrapping,
      onboardingDone,
      isAuthenticated,
      themeMode,
      role,
      user,
      toast,
      completeOnboarding,
      chooseRole,
      setThemePreference,
      login: login as AppStateContextValue["login"],
      completeTwoFactorLogin,
      register,
      signOut,
      refreshSession,
      setCurrentUser,
      syncCurrentUser,
      runWithAuth,
      showToast,
      clearToast
    }),
    [
      bootstrapping,
      onboardingDone,
      isAuthenticated,
      themeMode,
      role,
      user,
      toast,
      setCurrentUser,
      syncCurrentUser,
      runWithAuth,
      showToast,
      clearToast
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used inside AppStateProvider.");
  }
  return context;
}

export type { UserRole, ToastType };
