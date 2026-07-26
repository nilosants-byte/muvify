import React, { useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import { ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ConsultancyRequest, consultancyApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { SkeletonCard } from "../../components/polish/SkeletonCard";
import { formatBRDate, formatCurrencyBRL } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";
import { useConsultancyCenterData, offerEffectivePriceCents } from "../../hooks/useConsultancyCenterData";

type CenterNavigation = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalConsultancyCenter">["navigation"];

// Painel embutido na aba "Pedidos" de ProfessionalConsultancyCenterScreen —
// não é mais uma tela/rota própria (ver Etapa 7: unificação das 3 abas numa
// única tela, sem navegação/transição entre elas).
type Props = { navigation: CenterNavigation; onSwitchToOffers: () => void };

function requestStatusLabel(status: ConsultancyRequest["status"]) {
  const map: Record<string, string> = {
    OPEN: "Aberto",
    RESPONDED: "Respondido",
    ACCEPTED: "Aceito",
    REFUSED: "Recusado",
    EXPIRED_REFUNDED: "Expirado/Estornado",
    ARCHIVED: "Arquivado",
  };
  return map[status] ?? status;
}

function requestStatusVariant(status: ConsultancyRequest["status"]): "green" | "blue" | "orange" | "red" | "gray" {
  if (status === "ACCEPTED") return "green";
  if (status === "RESPONDED") return "blue";
  if (status === "OPEN") return "orange";
  if (status === "REFUSED" || status === "EXPIRED_REFUNDED") return "red";
  return "gray";
}

export function ProfessionalConsultancyRequestsScreen({ navigation, onSwitchToOffers }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();

  const {
    centerQuery,
    loading,
    activeRequests,
    onlineOffers,
    selectedOfferByRequest,
    setSelectedOfferByRequest,
  } = useConsultancyCenterData();

  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [responseTextByRequest, setResponseTextByRequest] = useState<Record<string, string>>({});

  useEffect(() => {
    if (centerQuery.error) {
      handleScreenError({ error: centerQuery.error, showToast, fallbackMessage: "Falha ao carregar solicitações.", navigation });
    }
  }, [centerQuery.error, showToast, navigation]);

  useEffect(() => {
    setResponseTextByRequest((current) => {
      const next = { ...current };
      activeRequests.forEach((item) => { if (!next[item.id]) next[item.id] = ""; });
      return next;
    });
  }, [activeRequests]);

  async function respondRequest(requestId: string) {
    const text = responseTextByRequest[requestId]?.trim();
    if (!text) {
      showToast("Escreva uma resposta para o aluno.", "error");
      return;
    }
    if (!onlineOffers.length) {
      showToast("Cadastre uma oferta online para responder.", "error");
      return;
    }

    const selectedOfferId = selectedOfferByRequest[requestId] ?? onlineOffers[0]?.id;
    if (!selectedOfferId) {
      showToast("Selecione uma oferta para enviar ao aluno.", "error");
      return;
    }

    try {
      setRespondingRequestId(requestId);
      await runWithAuth((token) =>
        consultancyApi.respondRequest(token, requestId, {
          providerResponseText: text,
          quotedOfferId: selectedOfferId,
        })
      );
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast("Resposta enviada ao aluno.", "success");
      setResponseTextByRequest((current) => ({ ...current, [requestId]: "" }));
      void centerQuery.refetch();
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao responder solicitação.", navigation });
    } finally {
      setRespondingRequestId(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.consultancy.requests">
      <ScrollView
        style={{ flex: 1 }}
        automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={centerQuery.isRefetching} onRefresh={() => void centerQuery.refetch()} />
        }
      >
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
        <>
        <MvCard style={{ gap: 10 }}>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <MvText variant="semi2">Solicitações ativas</MvText>
              <MvBadge label={`${activeRequests.length} em andamento`} variant={activeRequests.length ? "blue" : "gray"} />
            </View>

            {activeRequests.length === 0 && !loading ? (
              <View style={{
                alignItems: "center", padding: 24, gap: 12,
                backgroundColor: theme.inputBg,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: theme.border,
              }}>
                <Ionicons name="chatbubbles-outline" size={36} color={theme.text3} />
                <MvText variant="h3">Nenhuma solicitação</MvText>
                <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
                  Suas ofertas online precisam estar ativas para receber novos alunos.
                </MvText>
                <PressableScale
                  scale={0.96}
                  onPress={onSwitchToOffers}
                  style={{ backgroundColor: theme.primarySubtle, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: theme.primarySubtleBorder }}
                >
                  <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.primary }}>
                    Ver minha vitrine
                  </MvText>
                </PressableScale>
              </View>
            ) : null}

            <View style={{ gap: 10 }}>
              {activeRequests.map((request) => {
                const selectedOfferId = selectedOfferByRequest[request.id] ?? onlineOffers[0]?.id ?? "";
                return (
                  <View
                    key={request.id}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      padding: 10,
                      backgroundColor: theme.inputBg,
                      gap: 6,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <MvText variant="semi3">{request.client?.name ?? "Aluno"}</MvText>
                        <MvText variant="caption" color="secondary">
                          Entrada em {formatBRDate(request.createdAt)}
                        </MvText>
                      </View>
                      <MvBadge label={requestStatusLabel(request.status)} variant={requestStatusVariant(request.status)} />
                    </View>
                    <MvText variant="body4" color="secondary">
                      Necessidade: {request.trainingNeedText || "Não informado"}
                    </MvText>
                    <MvText variant="body4" color="secondary">
                      Limitações: {request.limitationText || "Não informado"}
                    </MvText>
                    {request.extraInfoText ? (
                      <MvText variant="body4" color="secondary">
                        Observações: {request.extraInfoText}
                      </MvText>
                    ) : null}

                    {request.status === "OPEN" ? (
                      <>
                        {onlineOffers.length ? (
                          <View style={{ gap: 6 }}>
                            <MvText variant="caption" color="secondary">
                              Oferta que será enviada junto da sua resposta
                            </MvText>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                              {onlineOffers.map((offer) => {
                                const selected = selectedOfferId === offer.id;
                                return (
                                  <PressableScale
                                    key={offer.id}
                                    scale={0.95}
                                    onPress={() => setSelectedOfferByRequest((current) => ({ ...current, [request.id]: offer.id }))}
                                    style={{
                                      borderWidth: 1,
                                      borderColor: selected ? theme.primarySubtleBorder : theme.border,
                                      backgroundColor: selected ? theme.primarySubtle : theme.cardBg,
                                      borderRadius: 18,
                                      paddingVertical: 6,
                                      paddingHorizontal: 10,
                                      maxWidth: "100%",
                                    }}
                                  >
                                    <MvText variant="caption" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                                      {offer.title} - {formatCurrencyBRL(offerEffectivePriceCents(offer) / 100)}
                                    </MvText>
                                  </PressableScale>
                                );
                              })}
                            </View>
                          </View>
                        ) : (
                          <MvText variant="body4" color="warning">
                            Cadastre uma oferta online para poder responder esta solicitação.
                          </MvText>
                        )}

                        <MvInput
                          placeholder="Resposta ao aluno: explique como você pode ajudar e o que será entregue."
                          multiline
                          numberOfLines={3}
                          value={responseTextByRequest[request.id] ?? ""}
                          onChangeText={(value) => setResponseTextByRequest((current) => ({ ...current, [request.id]: value }))}
                        />
                        <MvText variant="caption" color="secondary">
                          Se o aluno aceitar, você terá até 48h para entregar a primeira ficha de treino.
                        </MvText>
                        <MvButton
                          label="Enviar proposta"
                          disabled={!onlineOffers.length}
                          loading={respondingRequestId === request.id}
                          onPress={() => void respondRequest(request.id)}
                        />
                      </>
                    ) : null}

                    {request.providerResponseText && request.status !== "OPEN" ? (
                      <View
                        style={{
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: 8,
                          padding: 8,
                          backgroundColor: theme.mode === "dark" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.8)",
                        }}
                      >
                        <MvText variant="caption" color="secondary">
                          Sua ultima resposta
                        </MvText>
                        <MvText variant="body4">{request.providerResponseText}</MvText>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        </MvCard>
        </>
        )}
      </ScrollView>
    </View>
  );
}
