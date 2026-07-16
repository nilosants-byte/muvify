import React, { useState } from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { providersApi, reviewsApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

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
  const { user, runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const providerId = user?.providerProfile?.id;

  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reviewsQuery = useAuthQuery(
    queryKeys.providers.detail(providerId ?? "me"),
    () => providersApi.detail(providerId!),
    { enabled: Boolean(providerId) }
  );

  useFocusEffect(useCallback(() => { void reviewsQuery.refetch(); }, [reviewsQuery.refetch]));

  if (reviewsQuery.error) {
    handleScreenError({ error: reviewsQuery.error, showToast, fallbackMessage: "Falha ao carregar avaliações.", navigation });
  }

  const reviews = reviewsQuery.data?.reviews ?? [];

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
        </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
