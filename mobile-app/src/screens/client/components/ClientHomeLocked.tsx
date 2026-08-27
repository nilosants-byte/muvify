import React, { useCallback, useState } from "react";
import { RefreshControl, ScrollView, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppState } from "../../../state/AppState";
import { useAuthQuery } from "../../../hooks/useAuthQuery";
import { queryKeys } from "../../../lib/queryKeys";
import { chatApi, communityApi, consultancyApi, consultancyChatApi } from "../../../services/api/client";
import { MvAvatar, MvText } from "../../../components/mv";
import { PressableScale } from "../../../components/polish/PressableScale";
import { ClientBottomNavV2, ClientV2Tab } from "../../../components/navigation/ClientBottomNavV2";
import { useMvTheme } from "../../../theme/MvThemeContext";
import { hapticCta } from "../../../utils/haptics";

// Bloco 3 (exclusividade de marketplace): mostrada no lugar do mapa/busca/
// categorias enquanto o cliente tem um vínculo ativo — nenhuma navegação
// pra descoberta de outros profissionais existe aqui de propósito (mockup
// aprovado "Muvify - Vínculo Ativo"). Resumos (ranking, chat) puxam de telas
// que já existem, não duplicam o conteúdo inteiro.
export function ClientHomeLocked() {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { activeEngagement } = useAppState();

  function onNavigate(tab: ClientV2Tab) {
    if (tab === "home") return;
    if (tab === "meuPersonal") navigation.navigate("ClientBookings");
    if (tab === "trainings") navigation.navigate("MyTraining");
    if (tab === "community") navigation.navigate("Community");
    if (tab === "profile") navigation.navigate("ClientProfile");
  }

  const rankingQuery = useAuthQuery(queryKeys.community.ranking("WEEKLY", 1), (token) =>
    communityApi.getRanking(token, "WEEKLY", 1, 50)
  );

  const isOnline =
    activeEngagement?.hasActive &&
    (activeEngagement.kind === "ONLINE_CONSULTANCY" ||
      activeEngagement.kind === "ONLINE_CONSULTANCY_SPECIALIZED" ||
      activeEngagement.kind === "COMBO");

  const myTrainingQuery = useAuthQuery(
    queryKeys.consultancy.myTraining(),
    (token) => consultancyApi.myTraining(token),
    { enabled: Boolean(isOnline) }
  );

  type ChatPreviewEntry = {
    providerId: string;
    bookingId?: string;
    unreadCount: number;
    lastMessage: { content: string; createdAt: string; isMine: boolean; isSystem: boolean };
  };

  const chatQuery = useAuthQuery<ChatPreviewEntry[]>(
    isOnline ? queryKeys.consultancyChat.myChats() : queryKeys.chat.myChats(),
    (token) => (isOnline ? consultancyChatApi.myChats(token) : chatApi.myChats(token))
  );

  // Raio-X pós-épico (achado baixo): a Home normal (ClientHomeScreen) já tem
  // pull-to-refresh — a versão travada não tinha, cliente com vínculo ativo
  // perdia a forma padrão de forçar atualização que o resto do app oferece
  // (e vira o principal escape hatch se alguma das 3 seções acima falhar
  // silenciosamente em vez de mostrar erro dedicado).
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([rankingQuery.refetch(), myTrainingQuery.refetch(), chatQuery.refetch()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingQuery.refetch, myTrainingQuery.refetch, chatQuery.refetch]);

  if (!activeEngagement?.hasActive) return null;

  const providerInitials = activeEngagement.providerName.trim().slice(0, 2).toUpperCase();
  const latestPlan = myTrainingQuery.data?.contracts
    .flatMap((c) => c.trainingPlans ?? [])
    .find((p) => p.isActive);
  const myChat = chatQuery.data?.find((c: any) => c.providerId === activeEngagement.providerId);

  const kindLabel =
    activeEngagement.kind === "PRESENTIAL"
      ? "Presencial"
      : activeEngagement.kind === "COMBO"
        ? "Combo"
        : "Consultoria online";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.home-locked">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 20, paddingBottom: 140, gap: 14 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {/* Ranking de amigos — resumo, tela cheia continua na Comunidade */}
        {rankingQuery.data && rankingQuery.data.total > 1 && rankingQuery.data.viewerPosition ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate("Community")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.cardBg,
              padding: 13
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: "rgba(245,158,11,0.12)",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Ionicons name="trophy" size={18} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3">Você está em {rankingQuery.data.viewerPosition}º lugar essa semana</MvText>
              <MvText variant="caption" color="secondary" style={{ marginTop: 1 }}>
                entre {rankingQuery.data.total} amigos no ranking da Comunidade
              </MvText>
            </View>
          </TouchableOpacity>
        ) : null}

        {/* Faixa do personal */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate("ClientBookings")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.cardBg,
            padding: 12
          }}
        >
          <MvAvatar initials={providerInitials} photoUri={activeEngagement.providerPhotoUrl} size="md" tone="green" />
          <View style={{ flex: 1 }}>
            <MvText variant="semi3">{activeEngagement.providerName}</MvText>
            <MvText variant="caption" color="secondary" style={{ marginTop: 1 }}>{kindLabel}</MvText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.text3} />
        </TouchableOpacity>

        {/* Próximo treino (só quando o vínculo tem ficha, isto é, tem parte online) */}
        {isOnline ? (
          <View
            style={{ borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 14 }}
          >
            <MvText variant="caption" style={{ color: theme.text3, letterSpacing: 0.4 }}>PRÓXIMO TREINO</MvText>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: theme.primarySubtle,
                  borderWidth: 1,
                  borderColor: theme.primarySubtleBorder,
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <Ionicons name="barbell-outline" size={20} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <MvText variant="semi3" numberOfLines={1}>{latestPlan?.title ?? "Sua ficha de treino"}</MvText>
                <MvText variant="caption" color="secondary" style={{ marginTop: 1 }}>
                  {latestPlan ? `${latestPlan.exercises.length} exercícios` : "Aguardando entrega do seu personal"}
                </MvText>
              </View>
            </View>
            <PressableScale
              scale={0.98}
              onPress={() => {
                hapticCta();
                navigation.navigate("MyTraining");
              }}
              style={{
                height: 52,
                borderRadius: 18,
                backgroundColor: theme.primary,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: theme.primary,
                shadowOpacity: 0.28,
                shadowRadius: 10,
                elevation: 4
              }}
            >
              <MvText variant="semi2" style={{ color: theme.textOnPrimary }}>Iniciar treino</MvText>
            </PressableScale>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate("ClientBookings")}
            style={{ borderRadius: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 6 }}
          >
            <MvText variant="semi3">Suas sessões marcadas</MvText>
            <MvText variant="caption" color="secondary">Ver dias e horários em Meu Personal</MvText>
          </TouchableOpacity>
        )}

        {/* Prévia da última mensagem */}
        {myChat ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() =>
              navigation.navigate("ClientChatList", {
                openContractId: isOnline ? activeEngagement.contractId ?? undefined : undefined,
                openBookingId: !isOnline ? myChat.bookingId : undefined
              })
            }
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 11,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.cardBg,
              padding: 12
            }}
          >
            <View>
              <MvAvatar initials={providerInitials} photoUri={activeEngagement.providerPhotoUrl} size="sm" tone="green" />
              {myChat.unreadCount > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: theme.primary,
                    borderWidth: 2,
                    borderColor: theme.bg
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <MvText variant="semi3">{activeEngagement.providerName}</MvText>
              <MvText variant="caption" color="secondary" numberOfLines={1} style={{ marginTop: 1 }}>
                {myChat.lastMessage ? myChat.lastMessage.content : "Diga olá pro seu personal"}
              </MvText>
            </View>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <ClientBottomNavV2 activeTab="home" onNavigate={onNavigate} />
    </View>
  );
}
