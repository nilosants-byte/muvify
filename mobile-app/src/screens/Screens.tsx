import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  AppBadge,
  AppButton,
  AppCard,
  AppInput,
  AppModal,
  FullScreenLoader,
  HeroOverlay,
  StateBlock
} from "../components/primitives";
import { onboardingSlides } from "../data/onboardingSlides";
import {
  API_BASE_URL,
  authApi,
  ApiError,
  availabilityApi,
  bookingsApi,
  categoriesApi,
  CustomerPaymentStatus,
  Category,
  Favorite,
  favoritesApi,
  PaymentStatusResponse,
  paymentsApi,
  providersApi,
  ProviderSummary,
  reviewsApi
} from "../services/api/client";
import { useAppState } from "../state/AppState";
import { useConnectivity } from "../state/useConnectivity";
import { colors, radius, spacing, typography } from "../theme/tokens";
import { TERMS_VERSION } from "../config/legal";

type NavProps = {
  navigation: any;
  route?: any;
};

type BookingLike = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  scheduledAt: string;
  notes?: string | null;
  providerId: string;
  clientId: string;
  categoryId: string;
  category?: { id: string; name: string };
  payment?: PaymentStatusResponse & { status: PaymentStatusResponse["status"] };
  provider?: {
    id: string;
    displayName?: string;
    user?: { id: string; name?: string };
  };
  client?: { id: string; name?: string };
};

type ProviderDetailLike = ProviderSummary & {
  averageRating?: number;
  totalReviews?: number;
  user?: { id: string; name?: string; email?: string; phone?: string };
  categoryLinks?: Array<{
    categoryId: string;
    category?: { id: string; name: string };
  }>;
  availabilities?: Array<{
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }>;
  reviews?: Array<{
    id: string;
    rating: number;
    comment?: string | null;
    createdAt: string;
    user?: { id: string; name?: string };
  }>;
};

const bookingStatusLabels: Record<BookingLike["status"], string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado"
};

function paymentStatusLabel(status: PaymentStatusResponse["status"]) {
  const map: Record<PaymentStatusResponse["status"], string> = {
    PENDING_AUTH: "Aguardando pré-autorização",
    AUTHORIZING: "Autorizando",
    AUTHORIZED: "Autorizado",
    CAPTURED: "Capturado",
    CANCELED: "Cancelado",
    REFUNDED: "Estornado",
    FAILED: "Falhou"
  };
  return map[status] ?? status;
}

function paymentStatusTone(status: PaymentStatusResponse["status"]) {
  if (status === "CAPTURED") return "success" as const;
  if (status === "FAILED" || status === "CANCELED") return "danger" as const;
  if (status === "REFUNDED") return "warning" as const;
  return "default" as const;
}

function bookingStatusTone(status: BookingLike["status"]) {
  if (status === "CONFIRMED" || status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

function weekdayLabel(index: number) {
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  return days[index] ?? `Dia ${index}`;
}

function formatCurrency(cents: number | undefined) {
  if (!cents && cents !== 0) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cents / 100);
}

function formatDateTime(iso: string | undefined) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function resolveMpCallbackUrls() {
  const apiRoot = API_BASE_URL.endsWith("/api")
    ? API_BASE_URL.slice(0, -4)
    : API_BASE_URL;
  return {
    returnUrl: `${apiRoot}/mp/return`,
    refreshUrl: `${apiRoot}/mp/refresh`
  };
}

function extractApiMessage(error: unknown, fallback = "Falha ao executar ação.") {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function isSessionExpiredMessage(message: string) {
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /sessão\s+(expirada|inválida)/.test(normalized);
}

function providerRating(provider?: Pick<ProviderSummary, "avgRating" | "averageRating">) {
  const rating = provider?.avgRating ?? provider?.averageRating ?? 0;
  return Number.isFinite(rating) ? rating : 0;
}

function providerReviewCount(provider?: Pick<ProviderSummary, "reviewCount" | "totalReviews">) {
  const count = provider?.reviewCount ?? provider?.totalReviews ?? 0;
  return Number.isFinite(count) ? count : 0;
}

function handleScreenError({
  error,
  showToast,
  fallbackMessage,
  navigation
}: {
  error: unknown;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  fallbackMessage: string;
  navigation?: { navigate?: (screen: string) => void };
}) {
  const message = extractApiMessage(error, fallbackMessage);
  showToast(message, "error");
  if (isSessionExpiredMessage(message) && navigation?.navigate) {
    navigation.navigate("SessionExpired");
  }
}

function ScreenContainer({
  children,
  scroll = true
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  if (scroll) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, styles.scrollContent]}>{children}</View>;
}

function SectionTitle({ label }: { label: string }) {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

function EmptyState({ label }: { label: string }) {
  return <StateBlock title="Sem dados" description={label} />;
}

export function SplashScreen() {
  return (
    <View style={styles.splashWrap}>
      <View style={styles.brandWordmark}>
        <Text style={styles.brandTitleMuvi}>muvi</Text>
        <Text style={styles.brandTitleFy}>fy</Text>
      </View>
      <Text style={styles.brandSubtitle}>Marketplace de serviços pessoais</Text>
      <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
    </View>
  );
}

export function OnboardingScreen() {
  const { completeOnboarding } = useAppState();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((previous) => (previous + 1 >= onboardingSlides.length ? 0 : previous + 1));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const current = onboardingSlides[index];
  const isLast = index === onboardingSlides.length - 1;

  return (
    <View style={styles.onboardingWrap}>
      <ImageBackground source={current.imageSource} style={styles.onboardingImage}>
        <HeroOverlay>
          <View style={styles.onboardingHeaderRow}>
            <Pressable onPress={completeOnboarding}>
              <Text style={styles.linkText}>Pular</Text>
            </Pressable>
          </View>
          <Text style={styles.onboardingTitle}>{current.title}</Text>
          <Text style={styles.onboardingSubtitle}>{current.subtitle}</Text>
          <View style={styles.dotsRow}>
            {onboardingSlides.map((slide, slideIndex) => (
              <View
                key={slide.id}
                style={[styles.dot, slideIndex === index ? styles.dotActive : null]}
              />
            ))}
          </View>
          <View style={styles.onboardingActions}>
            {!isLast ? (
              <AppButton
                label="Próximo"
                onPress={() => setIndex((previous) => Math.min(previous + 1, onboardingSlides.length - 1))}
              />
            ) : (
              <AppButton label="Comecar" onPress={completeOnboarding} />
            )}
          </View>
        </HeroOverlay>
      </ImageBackground>
    </View>
  );
}

export function RoleSelectionScreen() {
  const { chooseRole } = useAppState();
  return (
    <ScreenContainer scroll={false}>
      <Text style={styles.pageTitle}>Como você vai usar o app?</Text>
      <Text style={styles.pageSubtitle}>Escolha seu perfil principal para continuar.</Text>
      <View style={styles.stackMd}>
        <AppCard
          title="Sou Cliente"
          description="Buscar profissional, agendar horário e pagar com segurança."
        />
        <AppButton label="Continuar como Cliente" onPress={() => chooseRole("CLIENT")} />
      </View>
      <View style={styles.stackMd}>
        <AppCard
          title="Sou Profissional"
          description="Criar perfil, receber agendamentos e gerenciar agenda."
        />
        <AppButton label="Continuar como Profissional" onPress={() => chooseRole("PROVIDER")} />
      </View>
    </ScreenContainer>
  );
}

export function LoginScreen({ navigation }: NavProps) {
  const { login, showToast } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    try {
      setLoading(true);
      await login({ email: email.trim(), password });
      showToast("Login realizado com sucesso.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Não foi possível entrar.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Entrar</Text>
      <Text style={styles.pageSubtitle}>Use seu e-mail e senha para acessar sua conta.</Text>
      <View style={styles.stackMd}>
        <AppInput
          label="E-mail"
          placeholder="você@email.com"
          value={email}
          onChangeText={setEmail}
        />
        <AppInput
          label="Senha"
          placeholder="Sua senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <AppButton label={loading ? "Entrando..." : "Entrar"} onPress={onSubmit} disabled={loading} />
      </View>
      <Pressable onPress={() => navigation.navigate("ForgotPassword")}>
        <Text style={styles.linkText}>Esqueci minha senha</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate("Register")}>
        <Text style={styles.linkText}>Não tenho conta. Criar cadastro.</Text>
      </Pressable>
    </ScreenContainer>
  );
}

export function RegisterScreen() {
  const { register, showToast } = useAppState();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    try {
      setLoading(true);
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        termsVersion: TERMS_VERSION,
        consentAccepted: true
      });
      showToast("Cadastro realizado com sucesso.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Não foi possível cadastrar."
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Criar conta</Text>
      <Text style={styles.pageSubtitle}>Preencha seus dados para comecar.</Text>
      <View style={styles.stackMd}>
        <AppInput label="Nome" placeholder="Seu nome completo" value={name} onChangeText={setName} />
        <AppInput label="E-mail" placeholder="você@email.com" value={email} onChangeText={setEmail} />
        <AppInput label="Telefone" placeholder="(11) 99999-9999" value={phone} onChangeText={setPhone} />
        <AppInput
          label="Senha"
          placeholder="Mínimo de 8 caracteres"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <AppButton label={loading ? "Criando..." : "Criar conta"} onPress={onSubmit} disabled={loading} />
      </View>
    </ScreenContainer>
  );
}

export function ForgotPasswordScreen({ navigation }: NavProps) {
  const { showToast } = useAppState();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [hasRequested, setHasRequested] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);

  async function requestResetToken() {
    try {
      setLoadingRequest(true);
      const response = await authApi.forgotPassword({
        channel: "EMAIL",
        email: email.trim()
      });
      setHasRequested(true);
      setRequestMessage(response.message);
      if (response.resetToken) {
        setToken(response.resetToken);
      }
      showToast("Solicitação de recuperação enviada.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao solicitar recuperação de senha."
      });
    } finally {
      setLoadingRequest(false);
    }
  }

  async function resetPassword() {
    if (!token.trim()) {
      showToast("Informe o token de recuperação.", "error");
      return;
    }
    if (newPassword.length < 8) {
      showToast("Nova senha deve ter no mínimo 8 caracteres.", "error");
      return;
    }

    try {
      setLoadingReset(true);
      await authApi.resetPassword({
        token: token.trim(),
        newPassword
      });
      showToast("Senha redefinida com sucesso. Faça login.", "success");
      setToken("");
      setNewPassword("");
      navigation.navigate("Login");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao redefinir senha."
      });
    } finally {
      setLoadingReset(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Recuperar senha</Text>
      <Text style={styles.pageSubtitle}>
        Solicite o token de recuperação e defina uma nova senha.
      </Text>
      <View style={styles.stackMd}>
        <AppInput
          label="E-mail cadastrado"
          placeholder="você@email.com"
          value={email}
          onChangeText={setEmail}
        />
        <AppButton
          label={loadingRequest ? "Solicitando..." : "Solicitar recuperação"}
          onPress={requestResetToken}
          disabled={loadingRequest}
        />
        {hasRequested ? <StateBlock title="Solicitação enviada" description={requestMessage} tone="success" /> : null}
        {hasRequested ? (
          <>
            <AppInput
              label="Token de recuperação"
              placeholder="Cole o token recebido"
              value={token}
              onChangeText={setToken}
            />
            <AppInput
              label="Nova senha"
              placeholder="Mínimo 8 caracteres com letras e números"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <AppButton
              label={loadingReset ? "Redefinindo..." : "Redefinir senha"}
              onPress={resetPassword}
              disabled={loadingReset}
            />
          </>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

export function HomeHeaderRoleTag() {
  const { role } = useAppState();
  return (
    <View style={styles.roleTag}>
      <Text style={styles.roleTagText}>{role === "PROVIDER" ? "Profissional" : "Cliente"}</Text>
    </View>
  );
}

export function CustomerHomeScreen({ navigation }: NavProps) {
  const { online } = useConnectivity();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    categoriesApi
      .list()
      .then((result) => {
        if (!alive) return;
        setCategories(result);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!online) {
    return (
      <ScreenContainer>
        <StateBlock
          title="Sem internet"
          description="Reconecte-se para carregar categorias e profissionais."
          tone="offline"
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Home Cliente</Text>
      <Text style={styles.pageSubtitle}>Encontre seu profissional ideal e agende quando quiser.</Text>
      <View style={styles.stackSm}>
        <AppButton label="Ver categorias" onPress={() => navigation.navigate("CategoriesList")} />
        <AppButton label="Buscar profissionais" variant="secondary" onPress={() => navigation.navigate("ProviderSearch")} />
        <AppButton
          label="Configurar pagamento"
          variant="secondary"
          onPress={() => navigation.navigate("CustomerPaymentMethod")}
        />
      </View>
      <SectionTitle label="Categorias populares" />
      {loading ? (
        <FullScreenLoader label="Carregando categorias..." />
      ) : categories.length === 0 ? (
        <EmptyState label="Nenhuma categoria cadastrada." />
      ) : (
        <View style={styles.stackSm}>
          {categories.slice(0, 6).map((category) => (
            <Pressable
              key={category.id}
              onPress={() =>
                navigation.navigate("ProviderList", {
                  categoryId: category.id,
                  categoryName: category.name
                })
              }
            >
              <AppCard title={category.name} description={category.description ?? "Sem descrição"} />
            </Pressable>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

export function CategoriesListScreen({ navigation }: NavProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    categoriesApi
      .list()
      .then((result) => {
        if (!alive) return;
        setCategories(result);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Categorias</Text>
      {loading ? (
        <FullScreenLoader label="Carregando categorias..." />
      ) : categories.length === 0 ? (
        <EmptyState label="Nenhuma categoria encontrada." />
      ) : (
        <View style={styles.stackSm}>
          {categories.map((category) => (
            <Pressable
              key={category.id}
              onPress={() =>
                navigation.navigate("ProviderList", {
                  categoryId: category.id,
                  categoryName: category.name
                })
              }
            >
              <AppCard title={category.name} description={category.description ?? "Sem descrição"} />
            </Pressable>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

export function ProviderSearchScreen({ navigation }: NavProps) {
  const [query, setQuery] = useState("");
  const [minRating, setMinRating] = useState("0");
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const runSearch = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await providersApi.list({
        q: query.trim() || undefined,
        minRating: Number(minRating) > 0 ? Number(minRating) : undefined
      });
      setProviders(result);
      if (result.length === 0) {
        setMessage("Nenhum profissional encontrado para os filtros.");
      }
    } catch (error) {
      setMessage(extractApiMessage(error, "Falha ao buscar profissionais."));
    } finally {
      setLoading(false);
    }
  }, [minRating, query]);

  useEffect(() => {
    runSearch();
  }, []);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Buscar profissionais</Text>
      <View style={styles.stackMd}>
        <AppInput
          label="Nome ou palavra-chave"
          placeholder="Ex: funcional, pilates, joao"
          value={query}
          onChangeText={setQuery}
        />
        <AppInput
          label="Nota minima (0 a 5)"
          placeholder="Ex: 4"
          value={minRating}
          onChangeText={setMinRating}
        />
        <AppButton label={loading ? "Buscando..." : "Atualizar busca"} onPress={runSearch} disabled={loading} />
      </View>
      {message ? <StateBlock title="Busca" description={message} /> : null}
      <View style={styles.stackSm}>
        {providers.map((provider) => (
          <Pressable
            key={provider.id}
            onPress={() => navigation.navigate("ProviderDetail", { providerId: provider.id })}
          >
            <AppCard
              title={provider.displayName}
              description={`${formatCurrency(provider.priceCents)} | Nota ${providerRating(provider).toFixed(1)} (${providerReviewCount(provider)})`}
            />
          </Pressable>
        ))}
      </View>
    </ScreenContainer>
  );
}

export function ProviderListScreen({ navigation, route }: NavProps) {
  const categoryId = route?.params?.categoryId as string | undefined;
  const categoryName = route?.params?.categoryName as string | undefined;
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    providersApi
      .list({ categoryId })
      .then((result) => {
        if (!alive) return;
        setProviders(result);
        if (result.length === 0) {
          setMessage("Nenhum profissional encontrado para está categoria.");
        } else {
          setMessage("");
        }
      })
      .catch((error) => {
        if (!alive) return;
        setMessage(extractApiMessage(error, "Falha ao carregar profissionais."));
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [categoryId]);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Profissionais</Text>
      <Text style={styles.pageSubtitle}>{categoryName ? `Categoria: ${categoryName}` : "Todos"}</Text>
      {loading ? <FullScreenLoader label="Carregando..." /> : null}
      {message ? <StateBlock title="Lista" description={message} /> : null}
      <View style={styles.stackSm}>
        {providers.map((provider) => (
          <Pressable
            key={provider.id}
            onPress={() => navigation.navigate("ProviderDetail", { providerId: provider.id })}
          >
            <AppCard
              title={provider.displayName}
              description={`${provider.experienceYears} anos | ${formatCurrency(provider.priceCents)}`}
            />
          </Pressable>
        ))}
      </View>
    </ScreenContainer>
  );
}

export function ProviderDetailScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const providerId = route?.params?.providerId as string;
  const [provider, setProvider] = useState<ProviderDetailLike | null>(null);
  const [favoriteMap, setFavoriteMap] = useState<Record<string, Favorite>>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [providerData, favorites] = await Promise.all([
        providersApi.detail(providerId),
        runWithAuth((token) => favoritesApi.list(token))
      ]);
      const map: Record<string, Favorite> = {};
      favorites.forEach((item) => {
        map[item.providerId] = item;
      });
      setFavoriteMap(map);
      setProvider(providerData as ProviderDetailLike);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar profissional.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, providerId, runWithAuth, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isFavorite = Boolean(favoriteMap[providerId]);
  const rating = providerRating(provider ?? undefined);
  const reviewCount = providerReviewCount(provider ?? undefined);

  async function toggleFavorite() {
    try {
      if (isFavorite) {
        await runWithAuth((token) => favoritesApi.remove(token, providerId));
        showToast("Removido dos favoritos.", "info");
      } else {
        await runWithAuth((token) => favoritesApi.add(token, providerId));
        showToast("Adicionado aos favoritos.", "success");
      }
      await loadData();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao atualizar favorito.",
        navigation
      });
    }
  }

  if (loading) return <FullScreenLoader label="Carregando perfil..." />;
  if (!provider) {
    return (
      <ScreenContainer>
        <StateBlock title="Erro" description="Não foi possível carregar profissional." tone="error" />
      </ScreenContainer>
    );
  }

  const categories = provider.categoryLinks?.map((item) => item.category?.name).filter(Boolean) ?? [];
  const firstCategoryId = provider.categoryLinks?.[0]?.categoryId;

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>{provider.displayName}</Text>
      <Text style={styles.pageSubtitle}>{provider.bio}</Text>
      <View style={styles.rowWrap}>
        <AppBadge label={`Nota ${rating.toFixed(1)}`} tone="success" />
        <AppBadge label={`${reviewCount} avaliações`} />
        <AppBadge label={formatCurrency(provider.priceCents)} tone="warning" />
      </View>
      <Text style={styles.sectionTitle}>Categorias</Text>
      <Text style={styles.bodyText}>{categories.length ? categories.join(", ") : "Sem categorias"}</Text>

      <View style={styles.stackSm}>
        <AppButton label={isFavorite ? "Remover favorito" : "Favoritar"} variant="secondary" onPress={toggleFavorite} />
        <AppButton
          label="Criar agendamento"
          onPress={() =>
            navigation.navigate("CreateBooking", {
              providerId: provider.id,
              categoryId: firstCategoryId
            })
          }
        />
      </View>

      <SectionTitle label="Disponibilidade ativa" />
      <View style={styles.stackSm}>
        {(provider.availabilities ?? []).length === 0 ? (
          <EmptyState label="Sem horários ativos cadastrados." />
        ) : (
          provider.availabilities?.map((slot) => (
            <AppCard
              key={slot.id}
              title={`${weekdayLabel(slot.weekday)} | ${slot.startTime} - ${slot.endTime}`}
            />
          ))
        )}
      </View>

      <SectionTitle label="Avaliações recentes" />
      <View style={styles.stackSm}>
        {(provider.reviews ?? []).length === 0 ? (
          <EmptyState label="Ainda sem avaliações." />
        ) : (
          provider.reviews?.slice(0, 4).map((review) => (
            <AppCard
              key={review.id}
              title={`${review.user?.name ?? "Cliente"} | Nota ${review.rating}`}
              description={review.comment ?? "Sem comentario"}
            />
          ))
        )}
      </View>
    </ScreenContainer>
  );
}

export function CreateBookingScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const providerId = route?.params?.providerId as string;
  const defaultCategoryId = route?.params?.categoryId as string | undefined;
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  );
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [paymentConfigured, setPaymentConfigured] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(true);

  useEffect(() => {
    let alive = true;
    categoriesApi
      .list()
      .then((result) => {
        if (!alive) return;
        setCategories(result);
        if (result[0]) {
          setCategoryId((current) => current || result[0].id);
        }
      })
      .catch((error) => {
        if (!alive) return;
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Falha ao carregar categorias.",
          navigation
        });
      });
    return () => {
      alive = false;
    };
  }, [navigation, showToast]);

  useEffect(() => {
    let alive = true;
    runWithAuth((token) => paymentsApi.customerStatus(token))
      .then((result) => {
        if (!alive) return;
        setPaymentConfigured(result.configured);
      })
      .catch((error) => {
        if (!alive) return;
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Falha ao validar método de pagamento.",
          navigation
        });
      })
      .finally(() => {
        if (!alive) return;
        setCheckingPayment(false);
      });

    return () => {
      alive = false;
    };
  }, [navigation, runWithAuth, showToast]);

  async function onSubmit() {
    if (!providerId || !categoryId || !scheduledAt) {
      showToast("Preencha categoria e data/hora no formato ISO.", "error");
      return;
    }
    if (!paymentConfigured) {
      showToast("Configure um método de pagamento antes de agendar.", "error");
      navigation.navigate("CustomerPaymentMethod");
      return;
    }
    try {
      setLoading(true);
      const booking = await runWithAuth((token) =>
        bookingsApi.create(token, {
          providerId,
          categoryId,
          scheduledAt,
          notes: notes.trim() || undefined
        })
      );
      showToast("Agendamento criado com sucesso.", "success");
      navigation.replace("BookingConfirmation", { bookingId: booking.id });
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao criar agendamento.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Criar agendamento</Text>
      <Text style={styles.pageSubtitle}>Informe categoria, horário e observações.</Text>
      {checkingPayment ? (
        <FullScreenLoader label="Validando pagamento..." />
      ) : !paymentConfigured ? (
        <StateBlock
          title="Método de pagamento obrigatório"
          description="Antes de confirmar o agendamento, configure um método de pagamento."
          tone="default"
        />
      ) : null}
      <View style={styles.stackMd}>
        <SectionTitle label="Categoria" />
        <View style={styles.rowWrap}>
          {categories.map((category) => (
            <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={styles.chipPress}>
              <View style={[styles.inlineChip, categoryId === category.id ? styles.inlineChipActive : null]}>
                <Text style={[styles.inlineChipText, categoryId === category.id ? styles.inlineChipTextActive : null]}>
                  {category.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <AppInput
          label="Data e hora (ISO)"
          placeholder="2026-03-30T10:30:00.000Z"
          value={scheduledAt}
          onChangeText={setScheduledAt}
        />
        <AppInput label="Observações" placeholder="Detalhes para o profissional" value={notes} onChangeText={setNotes} />
        <AppButton label={loading ? "Criando..." : "Confirmar agendamento"} onPress={onSubmit} disabled={loading} />
        {!paymentConfigured ? (
          <AppButton
            label="Configurar pagamento"
            variant="secondary"
            onPress={() => navigation.navigate("CustomerPaymentMethod")}
            disabled={checkingPayment}
          />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

export function BookingConfirmationScreen({ navigation, route }: NavProps) {
  const bookingId = route?.params?.bookingId as string | undefined;
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Agendamento confirmado</Text>
      <StateBlock
        title="Pagamento com pré-autorização"
        description="A pré-autorização ocorre antes do horário. Serviço concluído captura o pagamento. Cancelamento estorna."
        tone="success"
      />
      <View style={styles.stackSm}>
        <AppButton label="Ver meus agendamentos" onPress={() => navigation.navigate("CustomerBookings")} />
        {bookingId ? (
          <AppButton
            label="Ver status do pagamento"
            variant="secondary"
            onPress={() => navigation.navigate("PaymentStatus", { bookingId })}
          />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

function BookingList({
  bookings,
  onPress
}: {
  bookings: BookingLike[];
  onPress: (bookingId: string) => void;
}) {
  if (bookings.length === 0) {
    return <EmptyState label="Nenhum agendamento neste filtro." />;
  }
  return (
    <View style={styles.stackSm}>
      {bookings.map((booking) => (
        <Pressable key={booking.id} onPress={() => onPress(booking.id)}>
          <AppCard
            title={`${booking.category?.name ?? "Categoria"} | ${formatDateTime(booking.scheduledAt)}`}
            description={
              booking.provider?.displayName ??
              booking.provider?.user?.name ??
              booking.client?.name ??
              booking.notes ??
              "Sem observações"
            }
            rightElement={
              <AppBadge label={bookingStatusLabels[booking.status]} tone={bookingStatusTone(booking.status)} />
            }
          />
        </Pressable>
      ))}
    </View>
  );
}

export function CustomerBookingsScreen({ navigation }: NavProps) {
  const { runWithAuth, user, showToast } = useAppState();
  const [bookings, setBookings] = useState<BookingLike[]>([]);
  const [filter, setFilter] = useState<BookingLike["status"] | "ALL">("ALL");
  const [loading, setLoading] = useState(true);

  const loadBookings = useCallback(async () => {
    try {
      setLoading(true);
      const result = await runWithAuth((token) => bookingsApi.me(token));
      const mine = result.filter((booking) => booking.clientId === user?.id) as BookingLike[];
      setBookings(mine);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar agendamentos.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast, user?.id]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const filtered = useMemo(
    () => (filter === "ALL" ? bookings : bookings.filter((booking) => booking.status === filter)),
    [bookings, filter]
  );

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Meus agendamentos</Text>
      <View style={styles.rowWrap}>
        {(["ALL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] as const).map((status) => (
          <Pressable key={status} onPress={() => setFilter(status)} style={styles.chipPress}>
            <View style={[styles.inlineChip, filter === status ? styles.inlineChipActive : null]}>
              <Text style={[styles.inlineChipText, filter === status ? styles.inlineChipTextActive : null]}>
                {status === "ALL" ? "Todos" : bookingStatusLabels[status]}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <FullScreenLoader label="Carregando..." />
      ) : (
        <BookingList
          bookings={filtered}
          onPress={(bookingId) => navigation.navigate("CustomerBookingDetail", { bookingId })}
        />
      )}
      <AppButton label="Atualizar" variant="secondary" onPress={loadBookings} />
    </ScreenContainer>
  );
}

function useSingleBooking({
  bookingId,
  showToast,
  runWithAuth
}: {
  bookingId: string;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  runWithAuth: <T>(operation: (accessToken: string) => Promise<T>) => Promise<T>;
}) {
  const [booking, setBooking] = useState<BookingLike | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await runWithAuth((token) => bookingsApi.me(token));
      const found = result.find((item) => item.id === bookingId) as BookingLike | undefined;
      setBooking(found ?? null);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar agendamento."
      });
    } finally {
      setLoading(false);
    }
  }, [bookingId, runWithAuth, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  return { booking, loading, reload: load };
}

export function CustomerBookingDetailScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route?.params?.bookingId as string;
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const { booking, loading, reload } = useSingleBooking({ bookingId, showToast, runWithAuth });

  async function updateStatus(status: "CONFIRMED" | "CANCELLED" | "COMPLETED") {
    try {
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, status));
      showToast("Status atualizado.", "success");
      setCancelModalVisible(false);
      await reload();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao atualizar status.",
        navigation
      });
    }
  }

  if (loading) return <FullScreenLoader label="Carregando..." />;
  if (!booking) {
    return (
      <ScreenContainer>
        <StateBlock title="Não encontrado" description="Agendamento não localizado." tone="error" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Detalhe do agendamento</Text>
      <AppCard
        title={formatDateTime(booking.scheduledAt)}
        description={booking.notes ?? "Sem observações"}
        rightElement={<AppBadge label={bookingStatusLabels[booking.status]} tone={bookingStatusTone(booking.status)} />}
      />
      <View style={styles.stackSm}>
        {booking.status === "PENDING" ? (
          <AppButton label="Confirmar agendamento" onPress={() => updateStatus("CONFIRMED")} />
        ) : null}
        {(booking.status === "PENDING" || booking.status === "CONFIRMED") ? (
          <AppButton label="Cancelar agendamento" variant="danger" onPress={() => setCancelModalVisible(true)} />
        ) : null}
        {booking.status === "CONFIRMED" ? (
          <AppButton
            label="Confirmar conclusão"
            variant="secondary"
            onPress={() => navigation.navigate("CustomerCompleteConfirm", { bookingId })}
          />
        ) : null}
        {booking.status === "COMPLETED" ? (
          <AppButton label="Avaliar profissional" onPress={() => navigation.navigate("ReviewCreate", { bookingId })} />
        ) : null}
        <AppButton
          label="Status do pagamento"
          variant="secondary"
          onPress={() => navigation.navigate("PaymentStatus", { bookingId })}
        />
      </View>
      <AppModal
        visible={cancelModalVisible}
        title="Cancelar agendamento"
        message="Deseja cancelar? O pagamento será cancelado/estornado conforme status."
        confirmLabel="Sim, cancelar"
        onConfirm={() => updateStatus("CANCELLED")}
        onCancel={() => setCancelModalVisible(false)}
      />
    </ScreenContainer>
  );
}

export function CustomerCompleteConfirmScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route?.params?.bookingId as string;
  const [loading, setLoading] = useState(false);

  async function onConfirm() {
    try {
      setLoading(true);
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, "COMPLETED"));
      showToast("Confirmação registrada.", "success");
      navigation.replace("ReviewCreate", { bookingId });
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao confirmar conclusão.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Confirmar conclusão</Text>
      <StateBlock
        title="Regra de captura"
        description="Se apenas um lado confirmar, a captura automatica pode ocorrer após a janela configurada."
      />
      <AppButton label={loading ? "Confirmando..." : "Confirmar conclusão"} onPress={onConfirm} disabled={loading} />
    </ScreenContainer>
  );
}

export function ReviewCreateScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route?.params?.bookingId as string;
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    const parsed = Number(rating);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      showToast("Nota deve ser inteiro entre 1 e 5.", "error");
      return;
    }
    try {
      setLoading(true);
      await runWithAuth((token) =>
        reviewsApi.create(token, {
          bookingId,
          rating: parsed,
          comment: comment.trim() || undefined
        })
      );
      showToast("Avaliação enviada.", "success");
      navigation.navigate("CustomerBookings");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao enviar avaliação.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Avaliar profissional</Text>
      <View style={styles.stackMd}>
        <AppInput label="Nota (1-5)" placeholder="5" value={rating} onChangeText={setRating} />
        <AppInput
          label="Comentario"
          placeholder="Como foi sua experiência?"
          value={comment}
          onChangeText={setComment}
        />
        <AppButton label={loading ? "Enviando..." : "Enviar avaliação"} onPress={onSubmit} disabled={loading} />
      </View>
    </ScreenContainer>
  );
}

export function FavoritesScreen({ navigation }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  function providerFromFavorite(item: Favorite): ProviderSummary | null {
    if (!item.provider) return null;
    return {
      id: item.provider.id,
      displayName: item.provider.displayName ?? item.provider.user?.name ?? "Profissional",
      bio: item.provider.bio ?? "",
      experienceYears: item.provider.experienceYears ?? 0,
      priceCents: item.provider.priceCents ?? 0,
      avgRating: item.provider.avgRating,
      reviewCount: item.provider.reviewCount,
      averageRating: item.provider.averageRating,
      totalReviews: item.provider.totalReviews
    };
  }

  const loadFavorites = useCallback(async () => {
    try {
      setLoading(true);
      const favorites = await runWithAuth((token) => favoritesApi.list(token));
      const providersFromFavorite = favorites
        .map(providerFromFavorite)
        .filter((item): item is ProviderSummary => Boolean(item));

      const missingProviderIds = favorites
        .filter((item) => !item.provider)
        .map((item) => item.providerId);

      if (missingProviderIds.length === 0) {
        setProviders(providersFromFavorite);
        return;
      }

      const details = await Promise.all(
        missingProviderIds.map((providerId) => providersApi.detail(providerId).catch(() => null))
      );

      const fallbackProviders = details.filter((item): item is ProviderSummary => Boolean(item));
      setProviders([...providersFromFavorite, ...fallbackProviders]);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar favoritos.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  async function removeFavorite(providerId: string) {
    try {
      await runWithAuth((token) => favoritesApi.remove(token, providerId));
      showToast("Favorito removido.", "info");
      await loadFavorites();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao remover favorito.",
        navigation
      });
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Favoritos</Text>
      {loading ? (
        <FullScreenLoader label="Carregando favoritos..." />
      ) : providers.length === 0 ? (
        <EmptyState label="Você ainda não favoritou profissionais." />
      ) : (
        <View style={styles.stackSm}>
          {providers.map((provider) => (
            <View key={provider.id} style={styles.stackXs}>
              <Pressable onPress={() => navigation.navigate("ProviderDetail", { providerId: provider.id })}>
                <AppCard
                  title={provider.displayName}
                  description={`${formatCurrency(provider.priceCents)} | Nota ${providerRating(provider).toFixed(1)}`}
                />
              </Pressable>
              <AppButton label="Remover" variant="ghost" onPress={() => removeFavorite(provider.id)} />
            </View>
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

export function CustomerProfileScreen({ navigation }: NavProps) {
  const { user, signOut } = useAppState();
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Perfil do cliente</Text>
      <AppCard
        title={user?.name ?? "Usuario"}
        description={`${user?.email ?? "-"}${user?.phone ? ` | ${user.phone}` : ""}`}
      />
      <View style={styles.stackSm}>
        <AppButton label="Configurações" onPress={() => navigation.navigate("CustomerSettings")} />
        <AppButton
          label="Método de pagamento"
          variant="secondary"
          onPress={() => navigation.navigate("CustomerPaymentMethod")}
        />
        <AppButton label="Notificações" variant="secondary" onPress={() => navigation.navigate("Notifications")} />
        <AppButton label="Ajuda e suporte" variant="secondary" onPress={() => navigation.navigate("Support")} />
        <AppButton label="Sair" variant="danger" onPress={signOut} />
      </View>
    </ScreenContainer>
  );
}

export function CustomerPaymentMethodScreen({ navigation }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const [status, setStatus] = useState<CustomerPaymentStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const response = await runWithAuth((token) => paymentsApi.customerStatus(token));
      setStatus(response);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao consultar método de pagamento.",
        navigation
      });
    } finally {
      setLoadingStatus(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const configured = status?.configured ?? false;

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Método de pagamento</Text>
      <Text style={styles.pageSubtitle}>
        O agendamento exige método de pagamento digital configurado para pré-autorização.
      </Text>

      {loadingStatus ? (
        <FullScreenLoader label="Consultando status..." />
      ) : (
        <View style={styles.stackSm}>
          <StateBlock
            title={configured ? "Pagamento configurado" : "Pagamento pendente"}
            description={
              configured
                ? "Sua conta está pronta para criar agendamentos."
                : "Configure um cartão para liberar novos agendamentos."
            }
            tone={configured ? "success" : "default"}
          />
          <View style={styles.rowWrap}>
            <AppBadge
              label={status?.hasCustomer ? "Cliente MP OK" : "Cliente MP pendente"}
              tone={status?.hasCustomer ? "success" : "warning"}
            />
            <AppBadge
              label={status?.hasDefaultPaymentMethod ? "Cartão padrão OK" : "Cartão pendente"}
              tone={status?.hasDefaultPaymentMethod ? "success" : "warning"}
            />
          </View>
        </View>
      )}

      <View style={styles.stackMd}>
        <AppButton label="Atualizar status" variant="secondary" onPress={loadStatus} disabled={loadingStatus} />
        {configured ? (
          <AppButton
            label="Continuar para agendamentos"
            variant="secondary"
            onPress={() => navigation.navigate("CustomerBookings")}
          />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

export function CustomerSettingsScreen({ navigation }: NavProps) {
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Configurações</Text>
      <StateBlock
        title="Sessão e segurança"
        description="Tela pronta para preferência de notificação, privacidade e senha."
      />
      <View style={styles.stackSm}>
        <AppButton
          label="Método de pagamento"
          variant="secondary"
          onPress={() => navigation.navigate("CustomerPaymentMethod")}
        />
        <AppButton label="Simular sessão expirada" variant="secondary" onPress={() => navigation.navigate("SessionExpired")} />
      </View>
    </ScreenContainer>
  );
}

export function ProviderHomeScreen({ navigation }: NavProps) {
  const { runWithAuth, user, showToast } = useAppState();
  const [nextBookings, setNextBookings] = useState<BookingLike[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    runWithAuth((token) => bookingsApi.me(token))
      .then((result) => {
        if (!alive) return;
        const mine = (result as BookingLike[])
          .filter((item) => item.provider?.user?.id === user?.id)
          .slice(0, 5);
        setNextBookings(mine);
      })
      .catch((error) => {
        if (!alive) return;
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Falha ao carregar agenda.",
          navigation
        });
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [navigation, runWithAuth, showToast, user?.id]);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Home profissional</Text>
      <Text style={styles.pageSubtitle}>Gerencie agenda, disponibilidade e recebimentos.</Text>
      <View style={styles.stackSm}>
        <AppButton label="Conectar conta de recebimento" onPress={() => navigation.navigate("ConnectPayoutAccount")} />
        <AppButton label="Ver status de recebimento" variant="secondary" onPress={() => navigation.navigate("PayoutStatus")} />
      </View>
      <SectionTitle label="Próximos agendamentos" />
      {loading ? (
        <FullScreenLoader label="Carregando..." />
      ) : (
        <BookingList
          bookings={nextBookings}
          onPress={(bookingId) => navigation.navigate("ProviderBookingDetail", { bookingId })}
        />
      )}
    </ScreenContainer>
  );
}

export function ProviderProfileEditScreen({ navigation }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [experienceYears, setExperienceYears] = useState("1");
  const [priceCents, setPriceCents] = useState("10000");
  const [serviceRadiusKm, setServiceRadiusKm] = useState("10");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    categoriesApi
      .list()
      .then((result) => {
        if (!alive) return;
        setCategories(result);
      })
      .catch((error) => {
        if (!alive) return;
        handleScreenError({
          error,
          showToast,
          fallbackMessage: "Falha ao carregar categorias.",
          navigation
        });
      });
    return () => {
      alive = false;
    };
  }, [navigation, showToast]);

  function toggleCategory(categoryId: string) {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId]
    );
  }

  async function submitProfile() {
    if (selectedCategoryIds.length === 0) {
      showToast("Selecione ao menos uma categoria.", "error");
      return;
    }

    try {
      setLoading(true);
      await runWithAuth((token) =>
        providersApi.createProfile(token, {
          displayName: displayName.trim(),
          bio: bio.trim(),
          experienceYears: Number(experienceYears),
          priceCents: Number(priceCents),
          serviceRadiusKm: Number(serviceRadiusKm),
          categoryIds: selectedCategoryIds
        })
      );
      showToast("Perfil profissional salvo.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao salvar perfil.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Perfil profissional</Text>
      <Text style={styles.pageSubtitle}>Preço definido e obrigatório para publicar perfil.</Text>
      <View style={styles.stackMd}>
        <AppInput
          label="Nome de exibicao"
          placeholder="Ex: Carlos Trainer"
          value={displayName}
          onChangeText={setDisplayName}
        />
        <AppInput label="Bio" placeholder="Conte sua experiência" value={bio} onChangeText={setBio} />
        <AppInput
          label="Anos de experiência"
          placeholder="1"
          value={experienceYears}
          onChangeText={setExperienceYears}
        />
        <AppInput
          label="Preço (centavos)"
          placeholder="10000"
          value={priceCents}
          onChangeText={setPriceCents}
        />
        <AppInput
          label="Raio de atendimento (km)"
          placeholder="10"
          value={serviceRadiusKm}
          onChangeText={setServiceRadiusKm}
        />
      </View>
      <SectionTitle label="Categorias atendidas" />
      <View style={styles.rowWrap}>
        {categories.map((category) => (
          <Pressable key={category.id} onPress={() => toggleCategory(category.id)} style={styles.chipPress}>
            <View
              style={[
                styles.inlineChip,
                selectedCategoryIds.includes(category.id) ? styles.inlineChipActive : null
              ]}
            >
              <Text
                style={[
                  styles.inlineChipText,
                  selectedCategoryIds.includes(category.id) ? styles.inlineChipTextActive : null
                ]}
              >
                {category.name}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <AppButton label={loading ? "Salvando..." : "Salvar perfil"} onPress={submitProfile} disabled={loading} />
    </ScreenContainer>
  );
}

export function ConnectPayoutAccountScreen({ navigation }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loading, setLoading] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [onboardingUrl, setOnboardingUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<{
    hasAccount: boolean;
    accountId?: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null>(null);

  const callbackUrls = useMemo(() => resolveMpCallbackUrls(), []);

  const loadStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const response = await runWithAuth((token) => paymentsApi.providerStatus(token));
      setStatus(response);
      if (response.accountId) {
        setAccountId(response.accountId);
      }
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao consultar conta de recebimento.",
        navigation
      });
    } finally {
      setLoadingStatus(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function connect() {
    try {
      setCreatingAccount(true);
      setLoading(true);
      const result = await runWithAuth((token) =>
        paymentsApi.createProviderAccount(token, callbackUrls)
      );
      setOnboardingUrl(result.onboardingUrl);
      setAccountId(result.accountId);
      showToast("Conta de recebimento criada.", "success");
      await loadStatus();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao criar conta de recebimento.",
        navigation
      });
    } finally {
      setLoading(false);
      setCreatingAccount(false);
    }
  }

  async function refreshOnboardingLink() {
    try {
      setLoading(true);
      const result = await runWithAuth((token) =>
        paymentsApi.createOnboardingLink(token, callbackUrls)
      );
      setOnboardingUrl(result.onboardingUrl);
      setAccountId(result.accountId);
      showToast("Novo link de onboarding gerado.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao gerar novo onboarding.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  const ready = Boolean(status?.chargesEnabled && status?.payoutsEnabled);
  const hasAccount = Boolean(status?.hasAccount);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Conectar recebimentos</Text>
      <Text style={styles.pageSubtitle}>
        Mercado Pago: comissão da plataforma e repasse ao profissional.
      </Text>

      {loadingStatus ? (
        <FullScreenLoader label="Consultando status..." />
      ) : (
        <View style={styles.stackSm}>
          <StateBlock
            title={ready ? "Conta pronta para receber" : "Onboarding pendente"}
            description={
              ready
                ? "Cobranças e saques estão habilitados."
                : "Conclua o onboarding para habilitar cobranças e saques."
            }
            tone={ready ? "success" : "default"}
          />
          <View style={styles.rowWrap}>
            <AppBadge
              label={status?.chargesEnabled ? "Cobranças OK" : "Cobranças pendentes"}
              tone={status?.chargesEnabled ? "success" : "warning"}
            />
            <AppBadge
              label={status?.payoutsEnabled ? "Saques OK" : "Saques pendentes"}
              tone={status?.payoutsEnabled ? "success" : "warning"}
            />
          </View>
        </View>
      )}

      <AppButton
        label={
          loading
            ? "Processando..."
            : hasAccount
              ? "Gerar link de onboarding"
              : "Criar conta Connect"
        }
        onPress={hasAccount ? refreshOnboardingLink : connect}
        disabled={loading}
      />

      {accountId ? <AppCard title={`Account ID: ${accountId}`} /> : null}
      {onboardingUrl ? (
        <View style={styles.stackSm}>
          <StateBlock
            title="Onboarding pronto"
            description="Abra o link abaixo para concluir validação da conta."
            tone="default"
          />
          <AppButton label="Abrir onboarding" variant="secondary" onPress={() => Linking.openURL(onboardingUrl)} />
          <AppButton label="Revalidar status" variant="secondary" onPress={loadStatus} disabled={loadingStatus} />
        </View>
      ) : null}
      {!onboardingUrl && creatingAccount ? (
        <StateBlock
          title="Aguarde"
          description="Preparando conexão com Mercado Pago..."
          tone="default"
        />
      ) : null}
    </ScreenContainer>
  );
}

export function PayoutStatusScreen({ navigation }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    hasAccount: boolean;
    accountId?: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await runWithAuth((token) => paymentsApi.providerStatus(token));
      setStatus(response);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao consultar status.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Status de recebimento</Text>
      {loading ? (
        <FullScreenLoader label="Consultando status..." />
      ) : !status ? (
        <StateBlock title="Erro" description="Não foi possível consultar status." tone="error" />
      ) : (
        <View style={styles.stackSm}>
          <AppCard title={status.hasAccount ? "Conta conectada" : "Conta não criada"} description={status.accountId ?? "-"} />
          <AppBadge
            label={status.chargesEnabled ? "Cobranças habilitadas" : "Cobranças pendentes"}
            tone={status.chargesEnabled ? "success" : "warning"}
          />
          <AppBadge
            label={status.payoutsEnabled ? "Saques habilitados" : "Saques pendentes"}
            tone={status.payoutsEnabled ? "success" : "warning"}
          />
        </View>
      )}
      <AppButton label="Atualizar" variant="secondary" onPress={load} />
    </ScreenContainer>
  );
}

export function AvailabilityManagerScreen({ navigation }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const [slots, setSlots] = useState<
    Array<{ id: string; weekday: number; startTime: string; endTime: string; isActive: boolean }>
  >([]);
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await runWithAuth((token) => availabilityApi.me(token));
      setSlots(response);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar disponibilidade.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function createSlot() {
    try {
      await runWithAuth((token) =>
        availabilityApi.create(token, {
          weekday: Number(weekday),
          startTime,
          endTime
        })
      );
      showToast("Disponibilidade criada.", "success");
      await load();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao criar disponibilidade.",
        navigation
      });
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Disponibilidade semanal</Text>
      <View style={styles.stackMd}>
        <AppInput label="Dia da semana (0-6)" placeholder="1" value={weekday} onChangeText={setWeekday} />
        <AppInput label="Início (HH:mm)" placeholder="08:00" value={startTime} onChangeText={setStartTime} />
        <AppInput label="Fim (HH:mm)" placeholder="18:00" value={endTime} onChangeText={setEndTime} />
        <AppButton label="Adicionar horário" onPress={createSlot} />
      </View>
      <SectionTitle label="Horários ativos" />
      {loading ? (
        <FullScreenLoader label="Carregando..." />
      ) : slots.length === 0 ? (
        <EmptyState label="Nenhum horário cadastrado." />
      ) : (
        <View style={styles.stackSm}>
          {slots.map((slot) => (
            <AppCard
              key={slot.id}
              title={`${weekdayLabel(slot.weekday)} | ${slot.startTime} - ${slot.endTime}`}
              description={slot.isActive ? "Ativo" : "Inativo"}
            />
          ))}
        </View>
      )}
    </ScreenContainer>
  );
}

export function ProviderAgendaScreen({ navigation }: NavProps) {
  const { runWithAuth, user, showToast } = useAppState();
  const [bookings, setBookings] = useState<BookingLike[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = (await runWithAuth((token) => bookingsApi.me(token))) as BookingLike[];
      const mine = response.filter((item) => item.provider?.user?.id === user?.id);
      setBookings(mine);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar agenda.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Agenda profissional</Text>
      {loading ? (
        <FullScreenLoader label="Carregando agenda..." />
      ) : (
        <BookingList
          bookings={bookings}
          onPress={(bookingId) => navigation.navigate("ProviderBookingDetail", { bookingId })}
        />
      )}
      <AppButton label="Atualizar" variant="secondary" onPress={load} />
    </ScreenContainer>
  );
}

export function ProviderBookingDetailScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route?.params?.bookingId as string;
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const { booking, loading, reload } = useSingleBooking({ bookingId, showToast, runWithAuth });

  async function updateStatus(status: "CONFIRMED" | "CANCELLED" | "COMPLETED") {
    try {
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, status));
      showToast("Status atualizado.", "success");
      setCancelModalVisible(false);
      await reload();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao atualizar status.",
        navigation
      });
    }
  }

  if (loading) return <FullScreenLoader label="Carregando..." />;
  if (!booking) {
    return (
      <ScreenContainer>
        <StateBlock title="Não encontrado" description="Agendamento não localizado." tone="error" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Detalhe do agendamento</Text>
      <AppCard
        title={formatDateTime(booking.scheduledAt)}
        description={booking.notes ?? "Sem observações"}
        rightElement={<AppBadge label={bookingStatusLabels[booking.status]} tone={bookingStatusTone(booking.status)} />}
      />
      <View style={styles.stackSm}>
        {booking.status === "PENDING" ? (
          <AppButton label="Confirmar agendamento" onPress={() => updateStatus("CONFIRMED")} />
        ) : null}
        {(booking.status === "PENDING" || booking.status === "CONFIRMED") ? (
          <AppButton label="Cancelar agendamento" variant="danger" onPress={() => setCancelModalVisible(true)} />
        ) : null}
        {booking.status === "CONFIRMED" ? (
          <AppButton
            label="Confirmar conclusão"
            variant="secondary"
            onPress={() => navigation.navigate("ProviderCompleteConfirm", { bookingId })}
          />
        ) : null}
        <AppButton
          label="Status do pagamento"
          variant="secondary"
          onPress={() => navigation.navigate("PaymentStatus", { bookingId })}
        />
      </View>
      <AppModal
        visible={cancelModalVisible}
        title="Cancelar agendamento"
        message="Deseja cancelar este agendamento?"
        confirmLabel="Sim, cancelar"
        onConfirm={() => updateStatus("CANCELLED")}
        onCancel={() => setCancelModalVisible(false)}
      />
    </ScreenContainer>
  );
}

export function ProviderCompleteConfirmScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route?.params?.bookingId as string;
  const [loading, setLoading] = useState(false);

  async function onConfirm() {
    try {
      setLoading(true);
      await runWithAuth((token) => bookingsApi.updateStatus(token, bookingId, "COMPLETED"));
      showToast("Confirmação registrada.", "success");
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao confirmar conclusão.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Confirmar conclusão</Text>
      <StateBlock
        title="Conclusão parcial"
        description="Se apenas um lado confirmar, captura automatica pode ocorrer pela regra do backend."
      />
      <AppButton label={loading ? "Confirmando..." : "Confirmar conclusão"} onPress={onConfirm} disabled={loading} />
    </ScreenContainer>
  );
}

export function PaymentStatusScreen({ navigation, route }: NavProps) {
  const { runWithAuth, showToast } = useAppState();
  const bookingId = route?.params?.bookingId as string | undefined;
  const [payment, setPayment] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!bookingId) return;
    try {
      setLoading(true);
      const response = await runWithAuth((token) => paymentsApi.bookingPayment(token, bookingId));
      setPayment(response);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao consultar pagamento.",
        navigation
      });
    } finally {
      setLoading(false);
    }
  }, [bookingId, navigation, runWithAuth, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!bookingId) {
    return (
      <ScreenContainer>
        <StateBlock title="Sem contexto" description="Abra está tela a partir de um agendamento." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Status do pagamento</Text>
      {loading ? <FullScreenLoader label="Consultando..." /> : null}
      {payment ? (
        <View style={styles.stackSm}>
          <AppCard title={`Booking: ${payment.bookingId}`} description={formatCurrency(payment.amountCents)} />
          <AppBadge label={paymentStatusLabel(payment.status)} tone={paymentStatusTone(payment.status)} />
        </View>
      ) : (
        <EmptyState label="Pagamento ainda não carregado." />
      )}
      <AppButton label="Atualizar" variant="secondary" onPress={load} />
    </ScreenContainer>
  );
}

export function OfflineRequiredScreen({
  onRetry,
  retrying = false
}: {
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <ScreenContainer scroll={false}>
      <Text style={styles.pageTitle}>Sem conexão com a internet</Text>
      <StateBlock
        title="Conexão obrigatória"
        description="Para acessar o MuviFy, conecte-se via Wi-Fi ou dados móveis e tente novamente."
        tone="offline"
      />
      <Text style={styles.pageSubtitle}>
        O app libera automaticamente assim que a conexão for restabelecida.
      </Text>
      <View style={styles.stackSm}>
        <AppButton
          label={retrying ? "Verificando..." : "Tentar novamente"}
          variant="secondary"
          onPress={() => onRetry?.()}
          disabled={retrying}
        />
      </View>
    </ScreenContainer>
  );
}

export function NotificationsScreen() {
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Notificações</Text>
      <StateBlock
        title="Nenhuma notificação nova"
        description="Quando houver atualizações de agendamentos e pagamentos, elas aparecerão aqui."
      />
    </ScreenContainer>
  );
}

export function SupportScreen() {
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Ajuda e suporte</Text>
      <StateBlock
        title="Suporte"
        description="Em caso de duvidas, entre em contato com o suporte oficial do app."
      />
    </ScreenContainer>
  );
}

export function SessionExpiredScreen() {
  const { signOut } = useAppState();
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Sessão expirada</Text>
      <StateBlock
        title="Reautenticacao obrigatória"
        description="Sua sessão expirou. Entre novamente para continuar."
        tone="offline"
      />
      <View style={styles.stackSm}>
        <AppButton
          label="Fazer login novamente"
          onPress={async () => {
            await signOut();
          }}
        />
      </View>
    </ScreenContainer>
  );
}

export function GenericErrorScreen({ navigation }: NavProps) {
  return (
    <ScreenContainer>
      <Text style={styles.pageTitle}>Algo deu errado</Text>
      <StateBlock
        title="Erro temporario"
        description="Tente novamente em alguns instantes."
        tone="error"
      />
      <AppButton label="Tentar novamente" onPress={() => navigation.goBack()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md
  },
  splashWrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg
  },
  brandWordmark: {
    flexDirection: "row",
    alignItems: "center"
  },
  brandTitleMuvi: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0.2
  },
  brandTitleFy: {
    color: colors.primary,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0.2
  },
  brandSubtitle: {
    color: colors.textMuted,
    marginTop: spacing.xs
  },
  onboardingWrap: {
    flex: 1,
    backgroundColor: colors.bg
  },
  onboardingImage: {
    flex: 1
  },
  onboardingHeaderRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end"
  },
  onboardingTitle: {
    color: colors.text,
    fontWeight: "900",
    fontSize: typography.h1,
    marginTop: spacing.md
  },
  onboardingSubtitle: {
    color: colors.text,
    fontSize: typography.body,
    marginTop: spacing.sm,
    lineHeight: 24
  },
  onboardingActions: {
    marginTop: spacing.md
  },
  dotsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.md
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.35)"
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.primary
  },
  pageTitle: {
    color: colors.text,
    fontSize: typography.h2,
    fontWeight: "800"
  },
  pageSubtitle: {
    color: colors.textMuted,
    lineHeight: 22
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.h3,
    fontWeight: "800"
  },
  bodyText: {
    color: colors.textMuted
  },
  linkText: {
    color: colors.primary,
    fontWeight: "700"
  },
  stackXs: {
    gap: spacing.xs
  },
  stackSm: {
    gap: spacing.sm
  },
  stackMd: {
    gap: spacing.md
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chipPress: {
    borderRadius: radius.pill
  },
  inlineChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  inlineChipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(25,180,80,0.22)"
  },
  inlineChipText: {
    color: colors.textMuted,
    fontWeight: "600"
  },
  inlineChipTextActive: {
    color: colors.text
  },
  roleTag: {
    backgroundColor: "rgba(25,180,80,0.22)",
    borderWidth: 1,
    borderColor: colors.primaryDark,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  roleTagText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: typography.caption
  }
});




