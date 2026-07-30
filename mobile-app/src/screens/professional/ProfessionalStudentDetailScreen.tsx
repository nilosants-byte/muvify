import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import {
  Booking,
  bookingsApi,
  consultancyApi,
  presentialPackagesApi,
  ProviderStudentManagementDetail,
  providersApi
} from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvButton, MvCard, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { formatCurrencyBRL } from "../../utils/formatters";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalStudentDetail">;

type AssessmentForm = {
  weight: string;
  height: string;
  imc: string;
  bodyFatPercent: string;
  muscleMass: string;
  circumferences: string;
  waist: string;
  hip: string;
  chest: string;
  arm: string;
  thigh: string;
};

const emptyAssessment: AssessmentForm = {
  weight: "",
  height: "",
  imc: "",
  bodyFatPercent: "",
  muscleMass: "",
  circumferences: "",
  waist: "",
  hip: "",
  chest: "",
  arm: "",
  thigh: "",
};

const assessmentFields: Array<{ key: keyof AssessmentForm; label: string; unit: string }> = [
  { key: "weight", label: "Peso", unit: "kg" },
  { key: "height", label: "Altura", unit: "cm" },
  { key: "imc", label: "IMC", unit: "kg/m2" },
  { key: "bodyFatPercent", label: "% de gordura", unit: "%" },
  { key: "muscleMass", label: "Massa muscular", unit: "kg" },
  { key: "waist", label: "Cintura", unit: "cm" },
  { key: "hip", label: "Quadril", unit: "cm" },
  { key: "chest", label: "Peito", unit: "cm" },
  { key: "arm", label: "Braço", unit: "cm" },
  { key: "thigh", label: "Coxa", unit: "cm" },
  { key: "circumferences", label: "Circunferência geral", unit: "cm" },
];

function toAssessmentForm(input: Record<string, unknown> | null | undefined): AssessmentForm {
  return {
    weight: String(input?.weight ?? ""),
    height: String(input?.height ?? ""),
    imc: String(input?.imc ?? ""),
    bodyFatPercent: String(input?.bodyFatPercent ?? ""),
    muscleMass: String(input?.muscleMass ?? ""),
    circumferences: String(input?.circumferences ?? ""),
    waist: String(input?.waist ?? ""),
    hip: String(input?.hip ?? ""),
    chest: String(input?.chest ?? ""),
    arm: String(input?.arm ?? ""),
    thigh: String(input?.thigh ?? ""),
  };
}

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" };
  return { label: "Pendente", variant: "orange" };
}

function contractStatusBadge(
  contract: ProviderStudentManagementDetail["consultancyContracts"][number]
): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (contract.status === "REFUNDED_EXPIRED") return { label: "Reembolsado", variant: "red" };
  if (contract.status === "ARCHIVED") return { label: "Arquivado", variant: "gray" };
  if (contract.status === "PENDING_PAYMENT") return { label: "Aguardando pagamento", variant: "orange" };
  return contract.isVigente ? { label: "Vigente", variant: "green" } : { label: "Vencido", variant: "gray" };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function renderValue(value: unknown): string {
  if (typeof value === "string") {
    const next = value.trim();
    return next || "Não informado";
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Não informado";
  return "Não informado";
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? (parts[0]?.slice(0, 2) ?? "AL").toUpperCase()
    : `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function AssessmentRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: unknown;
  unit?: string;
}) {
  const val = renderValue(value);
  const display = val === "Não informado" ? val : unit ? `${val} ${unit}` : val;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 8 }}>
      <MvText variant="body4" color="secondary" style={{ flex: 1 }}>
        {label}
      </MvText>
      <MvText variant="body4" style={{ flex: 1, textAlign: "right", opacity: val === "Não informado" ? 0.5 : 1 }}>
        {display}
      </MvText>
    </View>
  );
}

export function ProfessionalStudentDetailScreen({ navigation, route }: Props) {
  const { showToast, runWithAuth } = useAppState();
  const { theme } = useMvTheme();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const { clientId } = route.params;

  const [assessmentForm, setAssessmentForm] = useState<AssessmentForm>(emptyAssessment);
  const [autoSaving, setAutoSaving] = useState(false);
  // Frente 4 (Criação/entrega/evolução do treino), Lote 6: era um boolean
  // simples — se a tela fosse reaproveitada pra outro aluno sem desmontar,
  // a hidratação nunca rodava de novo e o formulário do aluno anterior podia
  // acabar sendo salvo por cima do novo. Agora chaveado por clientId.
  const hydratedClientIdRef = useRef<string | null>(null);
  const changeCounterRef = useRef(0);

  const studentDetailQuery = useAuthQuery(
    queryKeys.providers.dashboardStudentDetail(clientId),
    async (token) => {
      const [payload, allBookings] = await Promise.all([
        providersApi.dashboardStudentDetail(token, clientId),
        bookingsApi.me(token).catch(() => [] as Booking[]),
      ]);
      const filteredBookings = allBookings
        .filter((booking) => (booking as any).clientId === clientId || booking.client?.id === clientId)
        .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
        .slice(0, 6);
      return { detail: payload as ProviderStudentManagementDetail, studentBookings: filteredBookings };
    },
  );

  const detail = studentDetailQuery.data?.detail ?? null;
  const studentBookings = studentDetailQuery.data?.studentBookings ?? ([] as Booking[]);
  const loading = studentDetailQuery.isLoading;

  useFocusEffect(useCallback(() => { void studentDetailQuery.refetch(); }, [studentDetailQuery.refetch]));

  useEffect(() => {
    if (studentDetailQuery.error) {
      handleScreenError({
        error: studentDetailQuery.error,
        showToast,
        fallbackMessage: "Falha ao carregar o perfil do aluno.",
        navigation,
      });
    }
  }, [studentDetailQuery.error, showToast, navigation]);

  // Raio-X de pagamentos, Rodada 4, Lote 10: cancelContract/cancelPackage já
  // aceitavam o profissional como parte legítima desde a Rodada 4, Lote 2
  // (isClient || isProvider) — só faltava a UI pra usar isso.
  const [cancellingContractId, setCancellingContractId] = useState<string | null>(null);
  const [cancellingPackageId, setCancellingPackageId] = useState<string | null>(null);

  function confirmCancelContract(contractId: string) {
    Alert.alert(
      "Cancelar consultoria",
      "O aluno será avisado e qualquer valor já cobrado será estornado. Quer continuar?",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Cancelar consultoria",
          style: "destructive",
          onPress: async () => {
            try {
              setCancellingContractId(contractId);
              await runWithAuth((token) => consultancyApi.cancelContract(token, contractId));
              showToast("Consultoria cancelada.", "success");
              void studentDetailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Falha ao cancelar a consultoria." });
            } finally {
              setCancellingContractId(null);
            }
          }
        }
      ]
    );
  }

  function confirmCancelPackage(packageId: string) {
    Alert.alert(
      "Cancelar pacote presencial",
      "O aluno será avisado e as sessões futuras ainda não cobradas serão liberadas. Quer continuar?",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Cancelar pacote",
          style: "destructive",
          onPress: async () => {
            try {
              setCancellingPackageId(packageId);
              await runWithAuth((token) => presentialPackagesApi.cancel(token, packageId));
              showToast("Pacote cancelado.", "success");
              void studentDetailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Falha ao cancelar o pacote." });
            } finally {
              setCancellingPackageId(null);
            }
          }
        }
      ]
    );
  }

  const answers = detail?.anamnesis?.answers;
  const isAnamnesisComplete = detail?.anamnesis?.status === "COMPLETED";
  const physicalAssessment = detail?.physicalAssessment;
  const summary = detail?.serviceSummary;

  useEffect(() => {
    setAssessmentForm(emptyAssessment);
    hydratedClientIdRef.current = null;
    changeCounterRef.current = 0;
  }, [clientId]);

  useEffect(() => {
    if (!physicalAssessment || hydratedClientIdRef.current === clientId) return;
    setAssessmentForm(toAssessmentForm(physicalAssessment as unknown as Record<string, unknown>));
    hydratedClientIdRef.current = clientId;
    changeCounterRef.current = 0;
  }, [physicalAssessment, clientId]);

  const saveAssessment = useCallback(async (form: AssessmentForm) => {
    try {
      setAutoSaving(true);
      await runWithAuth((token) => providersApi.upsertStudentPhysicalAssessment(token, clientId, form));
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar avaliação física.", navigation });
    } finally {
      setAutoSaving(false);
    }
  }, [clientId, navigation, runWithAuth, showToast]);

  useEffect(() => {
    if (hydratedClientIdRef.current !== clientId || changeCounterRef.current === 0) return;
    const timer = setTimeout(() => { void saveAssessment(assessmentForm); }, 600);
    return () => clearTimeout(timer);
  }, [assessmentForm, saveAssessment, clientId]);

  const updateAssessmentField = (key: keyof AssessmentForm, value: string) => {
    changeCounterRef.current += 1;
    setAssessmentForm((current) => ({ ...current, [key]: value.slice(0, 6) }));
  };

  const parqFlags = useMemo(() => {
    const parq = answers?.parq;
    if (!parq || typeof parq !== "object") return [];
    return Object.entries(parq as Record<string, unknown>).filter(([, value]) => value === true);
  }, [answers?.parq]);

  const needsAttention = !isAnamnesisComplete || parqFlags.length > 0;

  const goToAnamnesis = () => {
    if (!detail?.student?.id) return;
    navigation.navigate("ProfessionalStudentAnamnesis", {
      clientId: detail.student.id,
      clientName: detail.student.name,
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader
        title="Perfil do aluno"
        subtitle="Visão consolidada da rotina e evolução do aluno."
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={studentDetailQuery.isRefetching} onRefresh={() => void studentDetailQuery.refetch()} />
        }
      >
        {loading && !detail ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginTop: 32 }}>
            Carregando dados do aluno...
          </MvText>
        ) : null}

        {!loading && !detail ? (
          <MvCard>
            <MvText variant="semi2">Aluno não encontrado</MvText>
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
              Não foi possivel carregar os dados deste aluno agora.
            </MvText>
          </MvCard>
        ) : null}

        {detail ? (
          <>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
                <MvAvatar
                  initials={getInitials(detail.student.name)}
                  size={66}
                  borderRadius={33}
                  color="green"
                  photoUri={detail.student.profilePhotoUrl ?? null}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <MvText variant="h3">{detail.student.name}</MvText>
                  <MvText variant="body4" color="secondary">
                    {detail.student.email}
                  </MvText>
                  {detail.student.phone ? (
                    <MvText variant="body4" color="secondary">
                      {detail.student.phone}
                    </MvText>
                  ) : null}
                  <MvText variant="caption" color="secondary">
                    Membro desde {new Date(detail.student.memberSince).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </MvText>
                </View>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <MvBadge
                  label={isAnamnesisComplete ? "Anamnese completa" : "Anamnese pendente"}
                  variant={isAnamnesisComplete ? "green" : "orange"}
                />
                <MvBadge
                  label={needsAttention ? "Revisão recomendada" : "Sem alerta de saúde"}
                  variant={needsAttention ? "orange" : "green"}
                />
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <MvButton style={{ flex: 1 }} variant="outline" label="Abrir anamnese completa" onPress={goToAnamnesis} />
              </View>
            </MvCard>

            <MvCard style={{ gap: 8 }}>
              <MvText variant="semi2">Resumo de serviços</MvText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  { label: "Presencial", value: summary?.presentialBookings ?? 0 },
                  { label: "Consultoria", value: summary?.onlineConsultancyContracts ?? 0 },
                  { label: "Especializada", value: summary?.specializedConsultancyContracts ?? 0 },
                  { label: "Combo", value: summary?.comboContracts ?? 0 },
                  { label: "Treinos concluídos", value: detail?.trainingCompliance.completionCount ?? 0 },
                ].map((item) => (
                  <View
                    key={item.label}
                    style={{
                      flexBasis: "48%",
                      flexGrow: 1,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 10,
                      padding: 9,
                      backgroundColor: theme.inputBg,
                    }}
                  >
                    <MvText variant="h3" style={{ color: theme.textGreen }}>
                      {item.value}
                    </MvText>
                    <MvText variant="caption" color="secondary">
                      {item.label}
                    </MvText>
                  </View>
                ))}
              </View>
            </MvCard>

            <MvCard>
              <MvText variant="semi2" style={{ marginBottom: 8 }}>
                Direcionadores da anamnese
              </MvText>
              <AssessmentRow label="Objetivo principal" value={answers?.objectives?.mainObjective} />
              <AssessmentRow label="Prazo esperado" value={answers?.objectives?.targetTimeframe} />
              <AssessmentRow label="Modalidades praticadas" value={answers?.activityHistory?.practicedModalities} />
              <AssessmentRow label="Limitacoes fisicas" value={answers?.limitations?.physicalLimitations} />
              <AssessmentRow label="Exercicios restritos" value={answers?.limitations?.restrictedExercises} />
              <AssessmentRow label="Autoriza uso de imagem" value={answers?.imageAuthorization?.allowImageUse} />
            </MvCard>

            <MvCard style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <MvText variant="semi2">Avaliação física</MvText>
                <MvText variant="caption" color="secondary">
                  {autoSaving ? "Salvando..." : "Salvamento automático"}
                </MvText>
              </View>
              {assessmentFields.map((field) => (
                <View key={field.key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 4 }}>
                  <MvText variant="body4" color="secondary" style={{ flex: 1 }}>
                    {field.label} <MvText variant="body4" color="tertiary">({field.unit})</MvText>
                  </MvText>
                  <MvInput
                    keyboardType="number-pad"
                    placeholder="0"
                    maxLength={6}
                    textAlign="right"
                    value={assessmentForm[field.key]}
                    onChangeText={(value) => updateAssessmentField(field.key, value)}
                    style={{ width: 96 }}
                  />
                </View>
              ))}
            </MvCard>

            <MvCard>
              <MvText variant="semi2" style={{ marginBottom: 8 }}>
                PAR-Q e atenção clínica
              </MvText>
              <AssessmentRow label="Risco sinalizado (itens)" value={parqFlags.length} />
              <AssessmentRow label="Problema cardiaco" value={answers?.parq?.hasHeartCondition} />
              <AssessmentRow label="Dor no peito em exercicio" value={answers?.parq?.chestPainDuringExercise} />
              <AssessmentRow label="Dor no peito em repouso (ultimo mes)" value={answers?.parq?.chestPainAtRestLastMonth} />
            </MvCard>

            {detail.consultancyContracts.length > 0 ? (
              <MvCard>
                <MvText variant="semi2" style={{ marginBottom: 8 }}>
                  Histórico de serviços comprados
                </MvText>
                <View style={{ gap: 8 }}>
                  {detail.consultancyContracts.map((contract) => {
                    const badge = contractStatusBadge(contract);
                    return (
                      <View
                        key={contract.id}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: 10,
                          padding: 10,
                          backgroundColor: theme.inputBg,
                          gap: 4,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <MvText variant="body4" style={{ flex: 1 }} numberOfLines={1}>
                            {contract.offer.title}
                          </MvText>
                          <MvBadge label={badge.label} variant={badge.variant} />
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <MvText variant="caption" color="secondary">
                            Contratado em {formatDate(contract.createdAt)}
                            {contract.validUntil ? ` · válido até ${formatDate(contract.validUntil)}` : ""}
                          </MvText>
                          <MvText variant="body4" style={{ color: theme.textGreen }}>
                            {formatCurrencyBRL(contract.paymentAmountCents / 100)}
                          </MvText>
                        </View>
                        {contract.trainingPlans.length === 0 && contract.isVigente ? (
                          <MvText variant="caption" style={{ color: "#F59E0B" }}>
                            Nenhuma ficha de treino liberada ainda
                          </MvText>
                        ) : null}

                        {contract.trainingPlans.length > 0 ? (
                          <View style={{ gap: 6, marginTop: 2 }}>
                            {contract.trainingPlans.map((plan) => (
                              <View
                                key={plan.id}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 8,
                                  borderTopWidth: 1,
                                  borderTopColor: theme.border,
                                  paddingTop: 6,
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <MvText variant="body4" numberOfLines={1} style={{ opacity: plan.isVigente ? 1 : 0.5 }}>
                                    {plan.title}
                                  </MvText>
                                  <MvText variant="caption" color="secondary">
                                    {plan.isVigente
                                      ? plan.validUntil
                                        ? `Válido até ${formatDate(plan.validUntil)}`
                                        : "Vigente"
                                      : "Vencido"}
                                  </MvText>
                                </View>
                                <TouchableOpacity
                                  onPress={() =>
                                    navigation.navigate("TrainingCreation", {
                                      contractId: contract.id,
                                      clientId: detail.student.id,
                                      editPlanId: plan.id,
                                      contractValidUntil: contract.validUntil ?? undefined,
                                    })
                                  }
                                >
                                  <MvText variant="body4" style={{ color: theme.textGreen }}>
                                    Editar
                                  </MvText>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        {contract.isVigente ? (
                          <TouchableOpacity
                            onPress={() => {
                              const goToCreation = () =>
                                navigation.navigate("TrainingCreation", {
                                  contractId: contract.id,
                                  clientId: detail.student.id,
                                  contractValidUntil: contract.validUntil ?? undefined,
                                });
                              // Frente 4 (Criação/entrega/evolução do treino), Lote 6:
                              // entregar uma renovação desativa automaticamente a ficha
                              // atual (Lote 3) - sem aviso, o profissional podia achar
                              // que as duas fichas ficariam vigentes ao mesmo tempo.
                              if (contract.trainingPlans.length > 0) {
                                Alert.alert(
                                  "Substituir ficha atual?",
                                  "Ao entregar um novo treino, a ficha vigente deste aluno será desativada automaticamente.",
                                  [
                                    { text: "Cancelar", style: "cancel" },
                                    { text: "Continuar", onPress: goToCreation },
                                  ]
                                );
                                return;
                              }
                              goToCreation();
                            }}
                            style={{ marginTop: 4 }}
                          >
                            <MvText variant="body4" style={{ color: theme.textGreen }}>
                              + Criar novo treino
                            </MvText>
                          </TouchableOpacity>
                        ) : null}

                        {contract.status === "ACTIVE" || contract.status === "DELIVERED" ? (
                          <TouchableOpacity
                            disabled={cancellingContractId === contract.id}
                            onPress={() => confirmCancelContract(contract.id)}
                            style={{ marginTop: 4 }}
                          >
                            <MvText variant="body4" style={{ color: theme.danger }}>
                              {cancellingContractId === contract.id ? "Cancelando..." : "Cancelar consultoria"}
                            </MvText>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </MvCard>
            ) : null}

            {detail.presentialPackages.length > 0 ? (
              <MvCard>
                <MvText variant="semi2" style={{ marginBottom: 8 }}>
                  Pacotes presenciais
                </MvText>
                <View style={{ gap: 8 }}>
                  {detail.presentialPackages.map((pkg) => (
                    <View
                      key={pkg.id}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 10,
                        padding: 10,
                        backgroundColor: theme.inputBg,
                        gap: 4,
                      }}
                    >
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <MvText variant="body4" style={{ flex: 1 }} numberOfLines={1}>
                          {pkg.offer.title}
                        </MvText>
                        <MvBadge
                          label={pkg.status === "ACTIVE" ? "Ativo" : pkg.status === "PAST_DUE" ? "Pagamento pendente" : pkg.status === "CANCELLED" ? "Cancelado" : pkg.status === "EXPIRED" ? "Expirado" : "Aguardando pagamento"}
                          variant={pkg.status === "ACTIVE" ? "green" : pkg.status === "PAST_DUE" ? "orange" : "gray"}
                        />
                      </View>
                      <MvText variant="caption" color="secondary">
                        Contratado em {formatDate(pkg.createdAt)}
                        {pkg.validUntil ? ` · válido até ${formatDate(pkg.validUntil)}` : ""}
                      </MvText>
                      {pkg.status === "ACTIVE" ? (
                        <TouchableOpacity
                          disabled={cancellingPackageId === pkg.id}
                          onPress={() => confirmCancelPackage(pkg.id)}
                          style={{ marginTop: 2 }}
                        >
                          <MvText variant="body4" style={{ color: theme.danger }}>
                            {cancellingPackageId === pkg.id ? "Cancelando..." : "Cancelar pacote"}
                          </MvText>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                </View>
              </MvCard>
            ) : null}

            {studentBookings.length > 0 ? (
              <MvCard>
                <MvText variant="semi2" style={{ marginBottom: 8 }}>
                  Historico recente de sessoes
                </MvText>
                <View style={{ gap: 8 }}>
                  {studentBookings.map((booking) => {
                    const badge = bookingBadge(booking.status);
                    return (
                      <TouchableOpacity
                        key={booking.id}
                        activeOpacity={0.86}
                        onPress={() => navigation.navigate("BookingDetailProfessional", { bookingId: booking.id })}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: 10,
                          padding: 10,
                          backgroundColor: theme.inputBg,
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <MvText variant="body4">
                            {new Date(booking.scheduledAt).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "America/Sao_Paulo",
                            })}
                          </MvText>
                          {booking.category?.name ? (
                            <MvText variant="caption" color="secondary">
                              {booking.category.name}
                            </MvText>
                          ) : null}
                        </View>
                        <MvBadge label={badge.label} variant={badge.variant} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </MvCard>
            ) : (
              <MvCard>
                <MvText variant="semi3">Sem sessões recentes</MvText>
                <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
                  Quando este aluno tiver novos atendimentos, eles aparecerão aqui.
                </MvText>
              </MvCard>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
