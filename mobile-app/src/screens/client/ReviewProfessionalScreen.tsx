import React, { useState } from "react";
import { Pressable, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { reviewsApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvInput, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ReviewProfessional">;

export function ReviewProfessionalScreen({ navigation, route }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    try {
      setLoading(true);
      await runWithAuth((token) =>
        reviewsApi.create(token, {
          bookingId: route.params.bookingId,
          rating,
          comment: comment.trim() || undefined,
        })
      );
      showToast("Avaliação enviada com sucesso.", "success");
      navigation.navigate("ClientTabs", { screen: "ClientBookings" });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Não foi possível enviar avaliação.", navigation });
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">Avaliar profissional</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 20 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body4" color="secondary">
          Sua avaliação só fica disponível após a conclusão do atendimento.
        </MvText>

        <View style={{ alignItems: "center", gap: 12 }}>
          <MvText variant="semi2">Sua nota</MvText>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable key={value} onPress={() => setRating(value)} style={{ padding: 4 }}>
                <MvText variant="h3" style={{ color: value <= rating ? theme.textGreen : theme.border }}>
                  ★
                </MvText>
              </Pressable>
            ))}
          </View>
          <MvText variant="semi3" style={{ color: theme.textGreen }}>{rating} de 5</MvText>
        </View>

        <MvInput
          multiline
          numberOfLines={5}
          placeholder="Conte como foi sua experiência..."
          value={comment}
          onChangeText={setComment}
          maxLength={500}
        />

        <MvButton
          label="Enviar avaliação"
          loading={loading}
          onPress={() => void handleSubmit()}
        />
      </ScrollView>
    </View>
  );
}
