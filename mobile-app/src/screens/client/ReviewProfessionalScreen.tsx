import React, { useState } from "react";
import { ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { PressableScale } from "../../components/polish/PressableScale";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { reviewsApi, ApiError } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { handleScreenError } from "../shared/api-helpers";
import { hapticCta } from "../../utils/haptics";

type Props = NativeStackScreenProps<ClientStackParamList, "ReviewProfessional">;

const REVIEW_TAGS = ["Didático", "Pontual", "Motivador", "Atencioso", "Técnico"];

export function ReviewProfessionalScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  // Frente 5 (Descoberta, agendamento e agenda), Lote 12: nota vinha
  // pré-selecionada em 5 estrelas — cliente que só queria deixar um
  // comentário podia acabar enviando 5 estrelas sem ter escolhido de
  // verdade. Agora exige toque explícito numa estrela antes de habilitar o envio.
  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    try {
      setLoading(true);
      hapticCta();
      await runWithAuth((token) =>
        reviewsApi.create(
          token,
          route.params.contractId
            ? { contractId: route.params.contractId, rating, comment: selectedTags.join(", ") || undefined }
            : { bookingId: route.params.bookingId!, rating, comment: selectedTags.join(", ") || undefined }
        )
      );
      showToast("Avaliação enviada com sucesso.", "success");
      if (route.params.contractId) {
        navigation.navigate("ClientTabs", { screen: "MyTraining" });
      } else {
        navigation.navigate("ClientTabs", { screen: "ClientBookings" });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        showToast("Esta aula já foi avaliada.", "info");
        if (route.params.contractId) {
          navigation.navigate("ClientTabs", { screen: "MyTraining" });
        } else {
          navigation.navigate("ClientTabs", { screen: "ClientBookings" });
        }
      } else {
        handleScreenError({ error, showToast, fallbackMessage: "Não foi possível enviar avaliação.", navigation });
      }
    } finally { setLoading(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Avaliar profissional</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>sua opinião ajuda outros alunos</Text>
        </View>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 120, gap: 16, paddingTop: 20 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, lineHeight: 20 }}>
          Sua avaliação só fica disponível após a conclusão do atendimento.
        </Text>

        {/* Estrelas */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: C.amberBorder, backgroundColor: "rgba(245,166,35,0.08)", padding: 20, gap: 14, alignItems: "center" }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1 }}>Sua nota</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <PressableScale
                key={value}
                onPress={() => setRating(value)}
                accessibilityLabel={`${value} ${value === 1 ? "estrela" : "estrelas"}`}
                style={{ padding: 4, minWidth: S.touchMin, alignItems: "center" }}
              >
                <Text style={{ fontSize: 30, color: value <= rating ? C.amber : theme.labelColor }}>★</Text>
              </PressableScale>
            ))}
          </View>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: C.amber }}>
            {rating === 0 ? "Toque para avaliar" : `${rating} de 5`}
          </Text>
        </View>

        {/* Chips de qualificação V2 */}
        <View style={{ gap: 10 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.text1 }}>Como foi o atendimento?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {REVIEW_TAGS.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  onPress={() => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
                  style={{ height: 40, paddingHorizontal: 16, borderRadius: S.chipR, backgroundColor: active ? C.amber : "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: active ? C.amberBorder : theme.border, justifyContent: "center" }}
                >
                  <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: active ? theme.textOnPrimary : theme.text2 }}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Botão fixo com safe area */}
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: S.px, paddingBottom: Math.max(16, insets.bottom + 12), paddingTop: 12, backgroundColor: `${theme.bg}f0`, borderTopWidth: 1, borderTopColor: theme.border }}>
        <TouchableOpacity
          disabled={loading || rating === 0}
          onPress={() => void handleSubmit()}
          accessibilityRole="button"
          style={{ height: S.btnH, borderRadius: S.btnR, backgroundColor: loading || rating === 0 ? theme.primaryDisabled : theme.primary, alignItems: "center", justifyContent: "center", shadowColor: theme.primary, shadowOpacity: 0.28, shadowRadius: 10, elevation: 4 }}
        >
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: theme.textOnPrimary }}>
            {loading ? "Enviando..." : "Enviar avaliação"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
