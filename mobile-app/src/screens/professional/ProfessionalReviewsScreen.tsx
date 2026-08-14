import React, { useState } from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { favoritesApi, ProviderReview, reviewsApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

const PAGE_SIZE = 20;

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalReviews">;

function Stars({ rating, color }: { rating: number; color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= rating ? "star" : "star-outline"} size={14} color={color} />
      ))}
    </View>
  );
}

export function ProfessionalReviewsScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();

  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Frente 5 (Descoberta, agendamento e agenda), Lote 10: a tela reusava o
  // endpoint de detalhe público do provider (take: 10 fixo, pensado pra
  // vitrine do cliente) — o profissional nunca via nem respondia
  // avaliações além das 10 mais recentes. Agora usa /reviews/mine,
  // paginado de verdade.
  const [page, setPage] = useState(0);

  const reviewsQuery = useAuthQuery(
    queryKeys.reviews.mine({ page }),
    (token) => reviewsApi.mine(token, { skip: page * PAGE_SIZE, take: PAGE_SIZE })
  );

  const favoritedByQuery = useAuthQuery(
    queryKeys.favorites.countByMe(),
    (token) => favoritesApi.countFavoritedByMe(token)
  );

  useFocusEffectSkippingFirst(useCallback(() => {
    void reviewsQuery.refetch();
    void favoritedByQuery.refetch();
  }, [reviewsQuery.refetch, favoritedByQuery.refetch]));

  if (reviewsQuery.error) {
    handleScreenError({ error: reviewsQuery.error, showToast, fallbackMessage: "Falha ao carregar avaliações.", navigation });
  }

  const reviews: ProviderReview[] = reviewsQuery.data?.reviews ?? [];
  const total = reviewsQuery.data?.total ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;
  const favoritedByCount = favoritedByQuery.data?.count ?? 0;
  // Frente 18 (segunda camada, polimento visual): sem isso, a tela "piscava"
  // por um instante "Nenhum aluno te favoritou" e "Você ainda não recebeu
  // avaliações" antes dos dados reais chegarem — as telas irmãs do mesmo
  // padrão (ex.: ProviderDebtsScreen, FinancialHistoryScreen) já guardam o
  // estado vazio atrás de isLoading.
  const isLoading = reviewsQuery.isLoading || favoritedByQuery.isLoading;

  async function submitResponse(reviewId: string) {
    const text = responseText.trim();
    if (!text) return;
    try {
      setSubmitting(true);
      await runWithAuth((token) => reviewsApi.respond(token, reviewId, text));
      showToast("Resposta enviada.", "success");
      setRespondingTo(null);
      setResponseText("");
      void reviewsQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível enviar a resposta." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Minhas avaliações" onBack={() => navigation.goBack()} />
      <ScreenEntrance>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
          <MvCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="heart" size={18} color={theme.danger} />
              <MvText variant="body4" color="secondary">
                {favoritedByCount === 0
                  ? "Nenhum aluno te favoritou ainda."
                  : `${favoritedByCount} aluno${favoritedByCount === 1 ? "" : "s"} ${favoritedByCount === 1 ? "te favoritou" : "te favoritaram"}.`}
              </MvText>
            </View>
          </MvCard>

          {reviews.length === 0 ? (
            <MvText variant="body4" color="secondary">Você ainda não recebeu avaliações.</MvText>
          ) : (
            reviews.map((review) => (
              <MvCard key={review.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <MvText variant="semi3">{review.user?.name ?? "Aluno"}</MvText>
                  <Stars rating={review.rating} color={theme.primary} />
                </View>
                {review.comment ? (
                  <MvText variant="body4" color="secondary" style={{ marginBottom: 8 }}>{review.comment}</MvText>
                ) : null}

                {review.providerResponse ? (
                  <View style={{ backgroundColor: theme.chipBg, borderRadius: 10, padding: 10, marginTop: 4 }}>
                    <MvText variant="body4" style={{ fontSize: 11, color: theme.text3, marginBottom: 2 }}>Sua resposta</MvText>
                    <MvText variant="body4">{review.providerResponse}</MvText>
                  </View>
                ) : respondingTo === review.id ? (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    <MvInput
                      placeholder="Escreva sua resposta pública"
                      value={responseText}
                      onChangeText={setResponseText}
                    />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <MvButton variant="ghost" label="Cancelar" onPress={() => { setRespondingTo(null); setResponseText(""); }} style={{ flex: 1 }} />
                      <MvButton
                        label="Enviar"
                        loading={submitting}
                        disabled={!responseText.trim()}
                        onPress={() => void submitResponse(review.id)}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ) : (
                  <MvButton
                    variant="outline"
                    label="Responder"
                    onPress={() => { setRespondingTo(review.id); setResponseText(""); }}
                    style={{ marginTop: 6, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14 }}
                  />
                )}
              </MvCard>
            ))
          )}

          {page > 0 || hasMore ? (
            <View style={{ flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 4 }}>
              <MvButton
                variant="outline"
                label="Anterior"
                disabled={page === 0}
                onPress={() => setPage((p) => Math.max(0, p - 1))}
              />
              <MvButton
                variant="outline"
                label="Próxima"
                disabled={!hasMore}
                onPress={() => setPage((p) => p + 1)}
              />
            </View>
          ) : null}
            </>
          )}
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
