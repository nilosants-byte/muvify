import React, { useState } from "react";
import { Linking, ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppState } from "../../state/AppState";
import { userApi } from "../../services/api/client";
import { useAuthMutation, useAuthQuery } from "../../hooks/useAuthQuery";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { useMvTheme } from "../../theme/MvThemeContext";
import { queryKeys } from "../../lib/queryKeys";
import { formatBRDateTime } from "../../utils/formatters";
import { handleScreenError } from "./api-helpers";

const SUPPORT_EMAIL = "suporte@muvify.com.br";
// Épico de Frentes, Frente 10, Lote 7 (decisão do usuário): card de
// WhatsApp removido - o número anterior (5511999999999) era um
// placeholder que nunca existiu de verdade. Reintroduzir quando houver
// um número oficial de WhatsApp de suporte.

export function SupportScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const supportMutation = useAuthMutation(
    (token, vars: { subject?: string; message: string }) =>
      userApi.sendSupportMessage(token, vars),
    {
      onSuccess: () => { setSubject(""); setMessage(""); setSent(true); },
      onError: (error) => {
        handleScreenError({ error, showToast, fallbackMessage: "Falha ao enviar suporte. Tente novamente em instantes.", navigation });
      },
    }
  );
  const sending = supportMutation.isPending;

  // Épico de Frentes, Frente 10, Lote 2: não existia nenhum jeito de ler a
  // resposta do suporte dentro do app - só push (truncado em 300
  // caracteres) ou e-mail (condicional a SMTP configurado). Esta é a
  // mesma tela pra onde o deep-link SUPPORT_REPLY já navega.
  const myTicketsQuery = useAuthQuery(
    queryKeys.user.mySupportTickets(),
    (token) => userApi.listMySupportTickets(token)
  );
  const myTickets = myTicketsQuery.data ?? [];

  function submitTicket() {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
      showToast("Descreva o problema para enviar suporte.", "error");
      return;
    }
    supportMutation.mutate(
      { subject: subject.trim() || undefined, message: normalizedMessage },
      { onSuccess: () => void myTicketsQuery.refetch() }
    );
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
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="mail-outline" size={18} color={theme.textGreen} />
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3">E-mail</MvText>
              <MvText variant="body4" color="secondary" numberOfLines={1}>Resposta em até 2 dias úteis</MvText>
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
            borderColor: theme.primarySubtleBorder,
            backgroundColor: theme.mode === "dark" ? theme.primarySubtle : theme.primarySubtle,
            padding: 24, alignItems: "center", gap: 12,
          }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}>
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
              onPress={submitTicket}
            />
          </MvCard>
        )}

        {myTickets.length > 0 ? (
          <View style={{ gap: 10 }}>
            <MvText variant="semi2">Meus chamados</MvText>
            {myTickets.map((ticket) => (
              <MvCard key={ticket.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <MvText variant="semi3" style={{ flex: 1 }}>
                    {ticket.subject?.trim() || "Solicitação sem assunto"}
                  </MvText>
                  <MvBadge
                    label={ticket.status === "ANSWERED" ? "Respondido" : "Em análise"}
                    variant={ticket.status === "ANSWERED" ? "green" : "orange"}
                  />
                </View>
                <MvText variant="body4" color="secondary" numberOfLines={3}>{ticket.message}</MvText>
                <MvText variant="caption" color="secondary">Enviado em {formatBRDateTime(ticket.createdAt)}</MvText>
                {ticket.adminResponse ? (
                  <View style={{
                    marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
                    backgroundColor: theme.mode === "dark" ? theme.primarySubtle : theme.primarySubtle,
                    padding: 10, gap: 4,
                  }}>
                    <MvText variant="caption" color="secondary">Resposta do suporte</MvText>
                    <MvText variant="body4">{ticket.adminResponse}</MvText>
                  </View>
                ) : null}
              </MvCard>
            ))}
          </View>
        ) : null}
      </ScrollView>
      </ScreenEntrance>
    </View>
  );
}
