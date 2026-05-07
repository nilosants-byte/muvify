import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import {
  consultancyApi,
  favoritesApi,
  ProviderConsultancyCatalog,
  ProviderServiceOffer,
  ProviderSummary,
  providersApi,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { averageToFive, formatPriceFromCents, handleScreenError } from "../shared/api-helpers";
import { formatCurrencyBRL } from "../../utils/formatters";

type Props = NativeStackScreenProps<ClientStackParamList, "ProfessionalDetail">;
type ProviderDetail = ProviderSummary & {
  categoryLinks?: Array<{ category?: { name: string } }>;
  reviews?: Array<{ id: string; rating: number; comment?: string | null; user?: { name?: string } }>;
};

export function ProfessionalDetailScreen({ route, navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const providerId = route.params.professionalId;

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [consultancyCatalog, setConsultancyCatalog] = useState<ProviderConsultancyCatalog | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const detail = (await providersApi.detail(providerId)) as ProviderDetail;
      const catalog = await consultancyApi.providerCatalog(providerId).catch(() => null);
      const currentFavorites = await runWithAuth((token) => favoritesApi.list(token));
      setProvider(detail);
      setConsultancyCatalog(catalog);
      setFavorite(currentFavorites.some((item) => item.providerId === providerId));
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar detalhes do profissional.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, providerId, runWithAuth, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const categoryLabel = useMemo(() => {
    const names = provider?.categoryLinks?.map((item) => item.category?.name).filter(Boolean) as
      | string[]
      | undefined;
    if (!names || names.length === 0) return "Categoria não informada";
    return names.join(", ");
  }, [provider?.categoryLinks]);

  const promotionOffers = useMemo(
    () => (consultancyCatalog?.offers ?? []).filter((offer) => offer.isActive && offer.isPromotionActive),
    [consultancyCatalog?.offers]
  );

  async function toggleFavorite() {
    try {
      setSavingFavorite(true);
      if (favorite) {
        await runWithAuth((token) => favoritesApi.remove(token, providerId));
        setFavorite(false);
        showToast("Profissional removido dos favoritos.", "success");
      } else {
        await runWithAuth((token) => favoritesApi.add(token, providerId));
        setFavorite(true);
        showToast("Profissional adicionado aos favoritos.", "success");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.toLowerCase().includes("disponivel") || msg.toLowerCase().includes("disponível")) {
        showToast("Este profissional não está disponível, pois seu CREF ainda não foi aprovado.", "info");
        return;
      }
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Não foi possível atualizar favoritos.",
        navigation,
      });
    } finally {
      setSavingFavorite(false);
    }
  }

  function goToBookingWithOffer(offer: ProviderServiceOffer) {
    navigation.navigate("CreateBooking", {
      professionalId: providerId,
      offerId: offer.id,
      offerTitle: offer.title,
      offerPriceCents: offer.effectivePriceCents ?? offer.priceCents,
      offerKind: offer.kind,
      isPromotionalOffer: Boolean(offer.isPromotionActive),
    });
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">
          Carregando profissional...
        </MvText>
      </View>
    );
  }

  if (!provider) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <MvText variant="body3" color="secondary">
          Profissional nao encontrado.
        </MvText>
      </View>
    );
  }

  const rating = averageToFive(provider.avgRating ?? provider.averageRating);
  const initials = provider.displayName.slice(0, 2).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4" numberOfLines={1} style={{ flex: 1 }}>
          {provider.displayName}
        </MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 }}>
          <MvAvatar
            initials={initials}
            size={56}
            borderRadius={16}
            color="green"
            photoUri={provider.photoUrl ?? null}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <MvText variant="semi1">{provider.displayName}</MvText>
            <MvText variant="body4" color="secondary">
              {categoryLabel}
            </MvText>
            <MvText variant="semi3" style={{ color: theme.textGreen }}>
              {`★ ${rating.toFixed(1)} · ${formatCurrencyBRL(formatPriceFromCents(provider.priceCents))}/sessão`}
            </MvText>
          </View>
        </View>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 6 }}>
            Sobre
          </MvText>
          <MvText variant="body3" color="secondary">
            {provider.bio || "Sem descrição cadastrada."}
          </MvText>
        </MvCard>

        <MvCard>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
          >
            <MvText variant="semi2">Valor por sessão</MvText>
            <MvBadge label="Pagamento seguro" variant="green" />
          </View>
          <MvText variant="h3" style={{ color: theme.textGreen }}>
            {formatCurrencyBRL(formatPriceFromCents(provider.priceCents))}
          </MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
            Pré-autorizado antes do horário e capturado após conclusão.
          </MvText>
        </MvCard>

        {promotionOffers.length > 0 ? (
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 8 }}>
              Ofertas em promocao
            </MvText>
            <View style={{ gap: 10 }}>
              {promotionOffers.map((offer) => (
                <View
                  key={offer.id}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    backgroundColor: theme.inputBg,
                    padding: 10,
                    gap: 4,
                  }}
                >
                  <MvText variant="semi3">{offer.title}</MvText>
                  <MvText variant="body4" color="secondary">
                    {offer.kindDescription ?? offer.kind}
                  </MvText>
                  <MvText variant="semi3" style={{ color: theme.textGreen }}>
                    {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                  </MvText>
                  {(offer.effectivePriceCents ?? offer.priceCents) < offer.priceCents ? (
                    <MvText variant="body4" color="tertiary" style={{ textDecorationLine: "line-through" }}>
                      de {formatCurrencyBRL(offer.priceCents / 100)}
                    </MvText>
                  ) : null}
                  <MvButton
                    variant="outline"
                    label="Escolher dias"
                    onPress={() => goToBookingWithOffer(offer)}
                    style={{ marginTop: 4 }}
                  />
                </View>
              ))}
            </View>
          </MvCard>
        ) : null}

        <MvCard>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}
          >
            <MvText variant="semi2">Consultoria online</MvText>
            <MvBadge
              label={consultancyCatalog?.onlineConsultancyEnabled ? "Disponivel" : "Indisponivel"}
              variant={consultancyCatalog?.onlineConsultancyEnabled ? "green" : "orange"}
            />
          </View>
          <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>
            Planos mensais, trimestrais, semestrais ou anuais.
          </MvText>
          {consultancyCatalog?.offers
            .filter((item) => item.kind !== "PRESENTIAL")
            .slice(0, 2)
            .map((offer) => (
              <View key={offer.id} style={{ marginBottom: 6 }}>
                <MvText variant="semi3">{offer.title}</MvText>
                <MvText variant="body4" color="secondary">
                  {offer.kindDescription ?? offer.billingCycle} |{" "}
                  {formatCurrencyBRL((offer.effectivePriceCents ?? offer.priceCents) / 100)}
                </MvText>
              </View>
            ))}
          <MvButton
            variant="outline"
            label="Solicitar consultoria online"
            onPress={() => navigation.navigate("ConsultancyRequest", { professionalId: providerId })}
            style={{ marginTop: 4 }}
          />
        </MvCard>

        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 8 }}>
            Avaliacoes recentes
          </MvText>
          {provider.reviews && provider.reviews.length > 0 ? (
            provider.reviews.slice(0, 2).map((review) => (
              <View key={review.id} style={{ marginBottom: 8 }}>
                <MvText variant="semi3">
                  {`${review.user?.name ?? "Cliente"} — ${review.rating.toFixed(1)}`}
                </MvText>
                {review.comment ? (
                  <MvText variant="body4" color="secondary">
                    {review.comment}
                  </MvText>
                ) : null}
              </View>
            ))
          ) : (
            <MvText variant="body4" color="secondary">
              Ainda sem avaliacoes registradas.
            </MvText>
          )}
        </MvCard>

        <View style={{ gap: 10 }}>
          <MvButton
            label="Criar agendamento"
            onPress={() => navigation.navigate("CreateBooking", { professionalId: providerId })}
          />
          <MvButton
            variant="outline"
            label={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            loading={savingFavorite}
            onPress={toggleFavorite}
          />
        </View>
      </ScrollView>
    </View>
  );
}
