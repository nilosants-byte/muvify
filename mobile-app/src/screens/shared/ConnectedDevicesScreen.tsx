import React from "react";
import { Alert, FlatList, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvText } from "../../components/mv";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { useAppState } from "../../state/AppState";
import { userApi, type ConnectedSession } from "../../services/api/client";
import { useAuthQuery, useAuthMutation } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { formatRelativeActivityLabel } from "../../utils/formatters";

// Épico de Frentes, "4 temas pendentes" (05/08/2026), Tema 3: mostra os
// aparelhos com login ativo na conta e deixa desconectar qualquer um à
// distância. O único aparelho não pode se autodesconectar por aqui (evita
// travar o próprio acesso por engano) — pra recuperar a conta se o único
// aparelho for roubado, o caminho é "esqueci minha senha", que já derruba
// tudo automaticamente.

function deviceIconFor(userAgent: string | null): keyof typeof Ionicons.glyphMap {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet-portrait-outline";
  if (ua.includes("android") || ua.includes("iphone") || ua.includes("mobile")) return "phone-portrait-outline";
  if (!userAgent) return "help-circle-outline";
  return "desktop-outline";
}

export function ConnectedDevicesScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const queryClient = useQueryClient();

  const sessionsQuery = useAuthQuery(queryKeys.user.sessions(), (t) => userApi.listMySessions(t));

  const revokeMutation = useAuthMutation(
    (token, sessionId: string) => userApi.revokeMySession(token, sessionId),
    {
      onSuccess: (_data, sessionId) => {
        queryClient.setQueryData<ConnectedSession[]>(queryKeys.user.sessions(), (prev) =>
          (prev ?? []).filter((s) => s.id !== sessionId)
        );
        showToast("Aparelho desconectado.", "success");
      },
      onError: (error) => {
        showToast(error instanceof Error ? error.message : "Falha ao desconectar aparelho.", "error");
      },
    }
  );

  function confirmRevoke(session: ConnectedSession) {
    Alert.alert(
      "Desconectar aparelho?",
      "Esse aparelho vai precisar entrar de novo com e-mail e senha para continuar usando o Muvify.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Desconectar", style: "destructive", onPress: () => revokeMutation.mutate(session.id) },
      ]
    );
  }

  const sessions = sessionsQuery.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ProfessionalScreenHeader title="Aparelhos conectados" onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined} />

      <ScreenEntrance>
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 12 }}
          showsVerticalScrollIndicator={false}
          refreshing={sessionsQuery.isFetching}
          onRefresh={() => void sessionsQuery.refetch()}
          ListHeaderComponent={
            <MvText variant="body4" color="tertiary" style={{ marginBottom: 4 }}>
              Aparelhos com sessão ativa na sua conta. Não reconhece algum? Desconecte na hora.
            </MvText>
          }
          ListEmptyComponent={
            sessionsQuery.isLoading ? (
              <MvText variant="body3" color="secondary" style={{ textAlign: "center", marginTop: 24 }}>
                Carregando...
              </MvText>
            ) : null
          }
          renderItem={({ item }) => (
            <MvCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  backgroundColor: `${theme.textGreen}18`,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Ionicons name={deviceIconFor(item.userAgent)} size={18} color={theme.textGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3" numberOfLines={2}>
                    {item.userAgent ?? "Aparelho desconhecido"}
                  </MvText>
                  <MvText variant="body4" color="secondary">
                    {formatRelativeActivityLabel(item.lastActiveAt)}
                  </MvText>
                </View>
                {item.isCurrent ? (
                  <MvBadge label="Este aparelho" variant="green" />
                ) : (
                  <MvButton
                    variant="outline"
                    label="Desconectar"
                    loading={revokeMutation.isPending && revokeMutation.variables === item.id}
                    onPress={() => confirmRevoke(item)}
                  />
                )}
              </View>
            </MvCard>
          )}
        />
      </ScreenEntrance>
    </View>
  );
}
