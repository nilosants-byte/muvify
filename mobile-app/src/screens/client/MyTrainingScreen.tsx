import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, StatusBar, TouchableOpacity, View } from "react-native";
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientTabParamList } from "../../navigation/route-types";
import {
  consultancyApi,
  ConsultancyPaymentMethod,
  ConsultancyRequest,
  MyTrainingResponse,
  TrainingPlanExercise,
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import {
  MvBadge,
  MvBottomNav,
  MvButton,
  MvCard,
  MvMediaPreviewButton,
  MvMediaViewer,
  MvText,
} from "../../components/mv";
import { formatDateLabel } from "../../utils/formatters";
import { handleScreenError } from "../shared/api-helpers";

type Props = BottomTabScreenProps<ClientTabParamList, "MyTraining">;
type TrainingFilter = "all" | "active" | "delivered";

function contractStatusLabel(status: string) {
  if (status === "PENDING_PAYMENT") return "Pagamento pendente";
  if (status === "ACTIVE") return "Ativo";
  if (status === "DELIVERED") return "Entregue";
  if (status === "REFUNDED_EXPIRED") return "Expirado/Estornado";
  if (status === "ARCHIVED") return "Arquivado";
  return status;
}

function contractStatusVariant(status: string): "green" | "blue" | "orange" | "red" | "gray" {
  if (status === "ACTIVE") return "blue";
  if (status === "PENDING_PAYMENT") return "orange";
  if (status === "DELIVERED") return "green";
  if (status === "REFUNDED_EXPIRED") return "red";
  return "gray";
}

function parseRestSeconds(input?: string | null) {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  const mmssMatch = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
  if (mmssMatch) {
    const minutes = Number(mmssMatch[1]);
    const seconds = Number(mmssMatch[2]);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) return minutes * 60 + seconds;
  }

  const minuteMatch = normalized.match(/(\d+)\s*(min|m)\b/);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes)) return minutes * 60;
  }

  const numberMatch = normalized.match(/(\d+)/);
  if (!numberMatch) return null;
  const value = Number(numberMatch[1]);
  if (!Number.isFinite(value)) return null;
  return value;
}

function formatTimer(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PaymentChip({
  label,
  selected,
  onPress,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: selected ? "rgba(76,175,80,0.12)" : theme.chipBg,
        borderWidth: 1,
        borderColor: selected ? "rgba(76,175,80,0.30)" : theme.border,
      }}
    >
      <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.chipText }}>
        {label}
      </MvText>
    </TouchableOpacity>
  );
}

export function MyTrainingScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const [data, setData] = useState<MyTrainingResponse | null>(null);
  const [requests, setRequests] = useState<ConsultancyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);
  const [paymentByRequestId, setPaymentByRequestId] = useState<Record<string, ConsultancyPaymentMethod>>({});
  const [activeFilter, setActiveFilter] = useState<TrainingFilter>("all");

  const [restTimerVisible, setRestTimerVisible] = useState(false);
  const [restTimerExerciseName, setRestTimerExerciseName] = useState("");
  const [restTimerInitial, setRestTimerInitial] = useState(0);
  const [restTimerRemaining, setRestTimerRemaining] = useState(0);
  const [restTimerBlinkOn, setRestTimerBlinkOn] = useState(true);
  const [expandedMediaId, setExpandedMediaId] = useState<string | null>(null);

  useEffect(() => {
    if (!restTimerVisible) return;
    if (restTimerRemaining > 0) {
      const countdown = setInterval(() => {
        setRestTimerRemaining((current) => (current > 0 ? current - 1 : 0));
      }, 1000);
      return () => clearInterval(countdown);
    }
    const blink = setInterval(() => {
      setRestTimerBlinkOn((current) => !current);
    }, 450);
    return () => clearInterval(blink);
  }, [restTimerVisible, restTimerRemaining]);

  const openRestTimer = (exerciseName: string, seconds: number) => {
    setRestTimerExerciseName(exerciseName);
    setRestTimerInitial(seconds);
    setRestTimerRemaining(seconds);
    setRestTimerBlinkOn(true);
    setRestTimerVisible(true);
  };

  const closeRestTimer = () => {
    setRestTimerVisible(false);
    setRestTimerRemaining(0);
    setRestTimerInitial(0);
    setRestTimerExerciseName("");
    setRestTimerBlinkOn(true);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [trainingResult, requestsResult] = await Promise.all([
        runWithAuth((token) => consultancyApi.myTraining(token)),
        runWithAuth((token) => consultancyApi.myRequests(token)),
      ]);
      setData(trainingResult);
      setRequests(requestsResult);
      setPaymentByRequestId((current) => {
        const next = { ...current };
        requestsResult.forEach((request) => {
          if (!next[request.id]) next[request.id] = "CREDIT_CARD";
        });
        return next;
      });
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar Seu Treino.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const goToSearch = () => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("SearchProfessionals");
  };

  const goToArchived = () => {
    const parent = navigation.getParent<any>();
    if (parent) parent.navigate("ArchivedRequests");
  };

  async function decideRequest(
    requestId: string,
    decision: "ACCEPT" | "REFUSE",
    paymentMethod?: ConsultancyPaymentMethod
  ) {
    try {
      setDecidingRequestId(requestId);
      await runWithAuth((token) =>
        consultancyApi.decideRequest(token, requestId, { decision, paymentMethod })
      );
      showToast(
        decision === "ACCEPT"
          ? "Proposta aceita com sucesso. Pagamento processado."
          : "Proposta recusada e movida para o historico.",
        "success"
      );
      await load();
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao registrar decisão da proposta.",
        navigation,
      });
    } finally {
      setDecidingRequestId(null);
    }
  }

  const contracts = data?.contracts ?? [];
  const respondedRequests = useMemo(
    () => requests.filter((request) => request.status === "RESPONDED"),
    [requests]
  );
  const waitingDelivery = data?.waitingDelivery ?? [];
  const waitingCount = waitingDelivery.length;
  const activeContractsCount = useMemo(
    () => contracts.filter((item) => item.status === "ACTIVE" || item.status === "PENDING_PAYMENT").length,
    [contracts]
  );
  const deliveredContractsCount = useMemo(
    () => contracts.filter((item) => item.status === "DELIVERED").length,
    [contracts]
  );
  const totalPlansCount = useMemo(
    () => contracts.reduce((sum, contract) => sum + (contract.trainingPlans?.length ?? 0), 0),
    [contracts]
  );
  const totalExercisesCount = useMemo(
    () =>
      contracts.reduce(
        (sum, contract) =>
          sum +
          (contract.trainingPlans?.reduce((planSum, plan) => planSum + plan.exercises.length, 0) ?? 0),
        0
      ),
    [contracts]
  );

  const filteredContracts = useMemo(() => {
    if (activeFilter === "active") {
      return contracts.filter((item) => item.status === "ACTIVE" || item.status === "PENDING_PAYMENT");
    }
    if (activeFilter === "delivered") {
      return contracts.filter((item) => item.status === "DELIVERED");
    }
    return contracts;
  }, [activeFilter, contracts]);

  const filterItems: Array<{ key: TrainingFilter; label: string; count: number }> = useMemo(
    () => [
      { key: "all", label: "Todos", count: contracts.length },
      { key: "active", label: "Ativos", count: activeContractsCount },
      { key: "delivered", label: "Entregues", count: deliveredContractsCount },
    ],
    [activeContractsCount, contracts.length, deliveredContractsCount]
  );

  const renderExercise = (item: TrainingPlanExercise, index: number) => {
    const restSeconds = item.restSeconds ?? parseRestSeconds(item.restLabel);
    const restLabel = restSeconds
      ? restSeconds >= 60
        ? `${Math.floor(restSeconds / 60)}min${restSeconds % 60 ? ` ${restSeconds % 60}s` : ""}`
        : `${restSeconds}s`
      : item.restLabel ?? null;

    const mediaUrl = item.exercise?.mediaUrl ?? item.demoVideoUrl ?? null;
    const mediaType = item.exercise?.mediaType ?? (item.demoVideoUrl ? "YOUTUBE" : null);
    const hasMedia = Boolean(mediaUrl && mediaType);
    const isExpanded = expandedMediaId === item.id;

    const description = item.exercise?.description ?? null;
    const category = item.exercise?.category ?? null;

    return (
      <View
        key={item.id}
        style={{
          backgroundColor: theme.inputBg,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.border,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", padding: 12, gap: 10 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: "rgba(76,175,80,0.14)",
              borderWidth: 1,
              borderColor: "rgba(76,175,80,0.28)",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <MvText variant="semi3" style={{ color: theme.textGreen, fontSize: 12 }}>
              {index + 1}
            </MvText>
          </View>

          <View style={{ flex: 1, gap: 2 }}>
            <MvText variant="semi2">{item.name}</MvText>
            {category ? (
              <MvText variant="body4" color="secondary" style={{ fontSize: 11 }}>
                {category}
              </MvText>
            ) : null}
          </View>

          {hasMedia ? (
            <MvMediaPreviewButton
              mediaUrl={mediaUrl!}
              mediaType={mediaType!}
              expanded={isExpanded}
              onToggle={() => setExpandedMediaId(isExpanded ? null : item.id)}
            />
          ) : null}
        </View>

        <View
          style={{
            flexDirection: "row",
            gap: 6,
            paddingHorizontal: 12,
            paddingBottom: 10,
            flexWrap: "wrap",
          }}
        >
          {[
            { icon: "barbell-outline", label: item.repetitionsSets },
            { icon: "fitness-outline", label: item.load || "--" },
            ...(restLabel ? [{ icon: "timer-outline", label: restLabel, tappable: (restSeconds ?? 0) > 0 }] : []),
          ].map((stat, indexItem) => (
            <TouchableOpacity
              key={indexItem}
              disabled={!stat.tappable}
              onPress={stat.tappable ? () => openRestTimer(item.name, restSeconds!) : undefined}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 10,
                backgroundColor: stat.tappable ? "rgba(76,175,80,0.08)" : theme.chipBg,
                borderWidth: 1,
                borderColor: stat.tappable ? "rgba(76,175,80,0.28)" : theme.border,
              }}
            >
              <Ionicons
                name={stat.icon as any}
                size={13}
                color={stat.tappable ? theme.textGreen : theme.text3}
              />
              <MvText
                variant="body4"
                style={{ color: stat.tappable ? theme.textGreen : theme.text2, fontSize: 12 }}
              >
                {stat.label}
              </MvText>
            </TouchableOpacity>
          ))}
        </View>

        {description ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
            <MvText variant="body4" color="secondary" style={{ fontSize: 12 }}>
              {description}
            </MvText>
          </View>
        ) : null}

        {hasMedia && isExpanded ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <MvMediaViewer mediaUrl={mediaUrl!} mediaType={mediaType!} height={200} borderRadius={10} />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.client.training">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 14,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderSub,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate("ClientHome")}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <MvText variant="semi1">Seu Treino</MvText>
          <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>
            Acompanhe propostas, entregas e sua biblioteca de treinos.
          </MvText>
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 90, gap: 12 }}
        data={filteredContracts}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#4CAF50" colors={["#4CAF50"]} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <MvText variant="semi2">Resumo do seu treino</MvText>
                <Ionicons name="barbell-outline" size={16} color={iconColor} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
                  <MvText variant="h3" style={{ color: theme.textGreen }}>
                    {respondedRequests.length}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Propostas
                  </MvText>
                </View>
                <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
                  <MvText variant="h3" style={{ color: theme.textGreen }}>
                    {activeContractsCount}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Ativos
                  </MvText>
                </View>
                <View style={{ flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 8, backgroundColor: theme.inputBg }}>
                  <MvText variant="h3" style={{ color: theme.textGreen }}>
                    {waitingCount}
                  </MvText>
                  <MvText variant="caption" color="secondary">
                    Em entrega
                  </MvText>
                </View>
              </View>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  backgroundColor: theme.inputBg,
                  padding: 10,
                  gap: 3,
                }}
              >
                <MvText variant="body4" color="secondary">
                  Biblioteca atual
                </MvText>
                <MvText variant="semi3">
                  {totalPlansCount} plano(s) com {totalExercisesCount} exercício(s) disponíveis.
                </MvText>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <MvButton variant="outline" style={{ flex: 1 }} label="Ver arquivados" onPress={goToArchived} />
                <MvButton style={{ flex: 1 }} label="Buscar profissional" onPress={goToSearch} />
              </View>
            </MvCard>

            {data?.locked ? (
              <MvCard style={{ gap: 8 }}>
                <MvBadge label="Acesso bloqueado" variant="orange" />
                <MvText variant="body4" color="secondary">
                  Para liberar esta area, aceite uma proposta e conclua o pagamento da consultoria.
                </MvText>
                <MvButton variant="outline" label="Buscar profissional" onPress={goToSearch} />
              </MvCard>
            ) : null}

            {!data?.locked && waitingDelivery.length > 0 ? (
              <MvCard style={{ gap: 8 }}>
                <MvBadge label="Treino em preparo" variant="blue" />
                {waitingDelivery.map((item) => (
                  <View
                    key={item.contractId}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      padding: 9,
                      backgroundColor: theme.inputBg,
                    }}
                  >
                    <MvText variant="semi3">{item.providerName}</MvText>
                    <MvText variant="body4" color="secondary">
                      Entrega ate {formatDateLabel(item.deliveryDeadlineAt)}
                    </MvText>
                  </View>
                ))}
              </MvCard>
            ) : null}

            {respondedRequests.length > 0 ? (
              <MvCard style={{ gap: 8 }}>
                <MvBadge label="Propostas aguardando decisão" variant="blue" />
                {respondedRequests.map((request) => (
                  <View
                    key={request.id}
                    style={{
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      padding: 12,
                      gap: 8,
                      backgroundColor: theme.inputBg,
                    }}
                  >
                    <MvText variant="semi3">{request.provider?.displayName ?? "Profissional"}</MvText>
                    <MvText variant="body4" color="secondary">
                      Resposta: {request.providerResponseText ?? "Sem resposta detalhada."}
                    </MvText>
                    {request.quotedOffer ? (
                      <MvText variant="semi3">
                        Contratar por{" "}
                        {(request.quotedOffer.priceCents / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </MvText>
                    ) : null}

                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      <PaymentChip
                        label="Credito"
                        selected={paymentByRequestId[request.id] === "CREDIT_CARD"}
                        onPress={() =>
                          setPaymentByRequestId((current) => ({ ...current, [request.id]: "CREDIT_CARD" }))
                        }
                        theme={theme}
                      />
                      <PaymentChip
                        label="Debito"
                        selected={paymentByRequestId[request.id] === "DEBIT_CARD"}
                        onPress={() =>
                          setPaymentByRequestId((current) => ({ ...current, [request.id]: "DEBIT_CARD" }))
                        }
                        theme={theme}
                      />
                      <PaymentChip
                        label="PIX"
                        selected={paymentByRequestId[request.id] === "PIX"}
                        onPress={() => setPaymentByRequestId((current) => ({ ...current, [request.id]: "PIX" }))}
                        theme={theme}
                      />
                    </View>

                    <MvButton
                      label="Aceitar e contratar"
                      loading={decidingRequestId === request.id}
                      onPress={() =>
                        void decideRequest(
                          request.id,
                          "ACCEPT",
                          paymentByRequestId[request.id] ?? "CREDIT_CARD"
                        )
                      }
                    />
                    <MvButton
                      variant="outline"
                      label="Recusar oferta"
                      loading={decidingRequestId === request.id}
                      onPress={() => void decideRequest(request.id, "REFUSE")}
                    />
                  </View>
                ))}
              </MvCard>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {filterItems.map((item) => {
                const selected = item.key === activeFilter;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setActiveFilter(item.key)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: selected ? "rgba(76,175,80,0.35)" : theme.border,
                      backgroundColor: selected ? "rgba(76,175,80,0.12)" : theme.inputBg,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                    }}
                  >
                    <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                      {item.label}
                    </MvText>
                    <View
                      style={{
                        minWidth: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: selected ? "rgba(76,175,80,0.22)" : theme.backBtn,
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 4,
                      }}
                    >
                      <MvText variant="caption" style={{ color: selected ? theme.textGreen : theme.text2 }}>
                        {item.count}
                      </MvText>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <MvCard>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <MvText variant="semi2">{item.offer?.title ?? "Consultoria contratada"}</MvText>
                <MvText variant="body4" color="secondary">
                  Profissional: {item.provider?.displayName ?? "Personal"}
                </MvText>
                <MvText variant="caption" color="secondary">
                  Prazo: {item.deliveryDeadlineAt ? formatDateLabel(item.deliveryDeadlineAt) : "Não informado"}
                </MvText>
              </View>
              <MvBadge label={contractStatusLabel(item.status)} variant={contractStatusVariant(item.status)} />
            </View>

            {item.trainingPlans?.map((plan) => (
              <View key={plan.id} style={{ marginTop: 8, gap: 6 }}>
                <MvText variant="semi3">{plan.title}</MvText>
                {plan.description ? <MvText variant="body4" color="secondary">{plan.description}</MvText> : null}
                <View style={{ gap: 6, marginTop: 4 }}>
                  {plan.exercises.map((exercise, index) => renderExercise(exercise, index))}
                </View>
              </View>
            ))}
          </MvCard>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={{ paddingTop: 40, alignItems: "center", gap: 8 }}>
              <MvText variant="body3" color="secondary">
                Nenhum treino disponivel neste filtro no momento.
              </MvText>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />

      <MvBottomNav
        items={[
          { key: "home", icon: "compass-outline", label: "Início" },
          { key: "bookings", icon: "calendar-clear-outline", label: "Agenda" },
          { key: "promotions", icon: "flash-outline", label: "Promoções" },
          { key: "training", icon: "barbell-outline", label: "Treino" },
          { key: "profile", icon: "person-circle-outline", label: "Perfil" },
        ]}
        activeKey="training"
        onPress={(key) => {
          if (key === "home") navigation.navigate("ClientHome");
          if (key === "bookings") navigation.navigate("ClientBookings");
          if (key === "promotions") navigation.navigate("Promotions");
          if (key === "profile") navigation.navigate("ClientProfile");
        }}
      />

      <Modal animationType="fade" transparent visible={restTimerVisible} onRequestClose={closeRestTimer}>
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
          onPress={closeRestTimer}
        >
          <Pressable
            style={{
              width: "90%",
              maxWidth: 340,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.cardBg,
              padding: 24,
              gap: 8,
              alignItems: "center",
            }}
            onPress={(event) => event.stopPropagation()}
          >
            <MvText variant="semi1" style={{ textAlign: "center" }}>
              Descanso
            </MvText>
            <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
              {restTimerExerciseName || "Exercicio"}
            </MvText>
            <MvText
              variant="h1"
              style={{
                fontSize: 48,
                lineHeight: 56,
                color: restTimerRemaining === 0 ? (restTimerBlinkOn ? "#f44336" : theme.text2) : theme.textGreen,
              }}
            >
              {formatTimer(restTimerRemaining)}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
              {restTimerRemaining === 0 ? "Tempo finalizado." : `Tempo inicial: ${formatTimer(restTimerInitial)}`}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
              Toque fora para fechar e resetar.
            </MvText>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
