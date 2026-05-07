import React, { useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { useAppState } from "../../state/AppState";
import { userApi } from "../../services/api/client";

export function SupportScreen({ navigation }: { navigation?: any }) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submitTicket() {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      showToast("Descreva o problema para enviar suporte.", "error");
      return;
    }

    try {
      setSending(true);
      const result = await runWithAuth((token) => userApi.sendSupportMessage(token, {
        subject: subject.trim() || undefined,
        message: normalizedMessage,
      }));
      setSubject("");
      setMessage("");
      showToast(
        result.delivered
          ? "Solicitação enviada ao suporte muvify."
          : "Solicitação registrada. O envio automático por e-mail será ativado quando o suporte estiver configurado.",
        "success"
      );
    } catch (error) {
      const fallback = "Falha ao enviar suporte. Tente novamente em instantes.";
      showToast(error instanceof Error ? error.message : fallback, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        {navigation?.canGoBack?.() ? (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text2} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Ajuda e suporte</MvText>
          <MvText variant="body4" color="secondary">Nossa equipe responde em breve</MvText>
        </View>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80, gap: 14 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body3" color="secondary">
          Envie os detalhes para nossa equipe de suporte muvify analisar com prioridade.
        </MvText>

        <MvCard>
          <View style={{ gap: 12 }}>
            <MvInput
              label="Assunto (opcional)"
              placeholder="Ex.: erro ao salvar perfil"
              value={subject}
              onChangeText={setSubject}
            />
            <MvInput
              label="Descreva o problema"
              multiline
              numberOfLines={7}
              placeholder="Ex.: ao tentar concluir o cadastro, recebo erro no servidor..."
              value={message}
              onChangeText={setMessage}
              style={{ textAlignVertical: "top" } as any}
            />
            <MvButton label="Enviar solicitação" loading={sending} onPress={() => void submitTicket()} />
          </View>
        </MvCard>
      </ScrollView>
    </View>
  );
}
