import React, { useState } from "react";
import { Linking, ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppState } from "../../state/AppState";
import { userApi } from "../../services/api/client";
import { MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { useMvTheme } from "../../theme/MvThemeContext";

const SUPPORT_EMAIL = "suporte@muvify.com.br";
const SUPPORT_WHATSAPP = "5511999999999"; // substituir pelo número real quando disponível

export function SupportScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submitTicket() {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      showToast("Descreva o problema para enviar suporte.", "error");
      return;
    }
    try {
      setSending(true);
      await runWithAuth((token) =>
        userApi.sendSupportMessage(token, {
          subject: subject.trim() || undefined,
          message: normalizedMessage,
        })
      );
      setSubject("");
      setMessage("");
      setSent(true);
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
      <ProfessionalScreenHeader
        title="Ajuda e suporte"
        onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined}
      />

      <ScreenEntrance>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom + 24, 80),
          gap: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Canais rápidos de contato */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <PressableScale
            scale={0.96}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
              borderRadius: 14, borderWidth: 1,
              borderColor: theme.border, backgroundColor: theme.cardBg,
              paddingHorizontal: 14, paddingVertical: 14,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="mail-outline" size={18} color={theme.textGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3">E-mail</MvText>
              <MvText variant="body4" color="secondary" numberOfLines={1}>Resposta em até 2 dias</MvText>
            </View>
          </PressableScale>

          <PressableScale
            scale={0.96}
            onPress={() => Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}`)}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
              borderRadius: 14, borderWidth: 1,
              borderColor: theme.border, backgroundColor: theme.cardBg,
              paddingHorizontal: 14, paddingVertical: 14,
            }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="logo-whatsapp" size={18} color={theme.textGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3">WhatsApp</MvText>
              <MvText variant="body4" color="secondary" numberOfLines={1}>Resposta mais rápida</MvText>
            </View>
          </PressableScale>
        </View>

        {/* Separador */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
          <MvText variant="body4" color="secondary">ou envie uma mensagem</MvText>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
        </View>

        {/* Estado de confirmação pós-envio */}
        {sent ? (
          <View style={{
            borderRadius: 16, borderWidth: 1,
            borderColor: "rgba(34,197,94,0.25)",
            backgroundColor: theme.mode === "dark" ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.05)",
            padding: 24, alignItems: "center", gap: 12,
          }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(34,197,94,0.15)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="checkmark-circle" size={32} color={theme.textGreen} />
            </View>
            <MvText variant="semi1" style={{ textAlign: "center" }}>Mensagem enviada!</MvText>
            <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
              Nossa equipe vai analisar sua solicitação e responder em até 2 dias úteis pelo e-mail da sua conta.
            </MvText>
            <MvButton
              variant="outline"
              label="Enviar outra mensagem"
              onPress={() => setSent(false)}
              style={{ marginTop: 4 }}
            />
          </View>
        ) : (
          <MvCard style={{ gap: 12 }}>
            <View style={{ gap: 6 }}>
              <MvText variant="label" color="secondary">Assunto (opcional)</MvText>
              <MvInput
                value={subject}
                onChangeText={setSubject}
                placeholder="Ex.: erro ao salvar perfil"
              />
            </View>
            <View style={{ gap: 6 }}>
              <MvText variant="label" color="secondary">Descreva o problema</MvText>
              <MvInput
                value={message}
                onChangeText={setMessage}
                placeholder="Ex.: ao tentar concluir o cadastro, recebo erro no servidor..."
                multiline
                numberOfLines={7}
                style={{ height: 140 }}
              />
            </View>
            <MvButton
              label={sending ? "Enviando..." : "Enviar solicitação"}
              disabled={sending}
              loading={sending}
              onPress={() => void submitTicket()}
            />
          </MvCard>
        )}
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
