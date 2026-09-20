import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
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
  // Frente 4 (segunda camada), Lote 7: "Circunferência geral" não dizia o
  // que media em relação aos 5 campos específicos acima (cintura, quadril,
  // peito, braço, coxa) — rótulo mais claro pra indicar que é uma medida
  // livre, pra qualquer parte do corpo que não tenha campo próprio.
  { key: "circumferences", label: "Outra circunferência", unit: "cm" },
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

// Pedido do teste manual QA: as ações de cada contrato/pacote ("Criar
// treino", "Cancelar", "Chat") eram links de texto colorido empilhados,
// sem nenhum tratamento de botão — davam a impressão de "jogado". Um
// chip compacto (ícone + rótulo, com cor por intenção) deixa claro que
// são ações de verdade, sem competir em peso visual com o MvButton
// principal da tela (que é full-width, pesado demais pra várias ações
// lado a lado dentro de um cartão de lista).
function ActionChip({
  icon,
  label,
  tone = "neutral",
  onPress,
  disabled,
  loading,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: "primary" | "danger" | "neutral";
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { theme } = useMvTheme();
  const palette =
    tone === "primary"
      ? { bg: theme.primarySubtle, border: theme.primarySubtleBorder, fg: theme.textGreen }
      : tone === "danger"
        ? { bg: "transparent", border: theme.mode === "dark" ? "rgba(239,68,68,0.30)" : "rgba(220,38,38,0.25)", fg: theme.danger }
        : { bg: theme.inputBg, border: theme.border, fg: theme.text2 };
  return (
    <TouchableOpacity
      disabled={disabled || loading}
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.bg,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? <ActivityIndicator size="small" color={palette.fg} /> : <Ionicons name={icon} size={14} color={palette.fg} />}
      <MvText variant="caption" style={{ color: palette.fg, fontWeight: "600" }}>
        {label}
      </MvText>
    </TouchableOpacity>
  );
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

  useFocusEffectSkippingFirst(useCallback(() => { void studentDetailQuery.refetch(); }, [studentDetailQuery.refetch]));

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

  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  function confirmDeleteTrainingPlan(planId: string, planTitle: string) {
    Alert.alert(
      "Remover treino?",
      `"${planTitle}" será removido e o aluno não verá mais essa opção pra treinar. Os outros treinos do pacote continuam normais.`,
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Remover treino",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingPlanId(planId);
              await runWithAuth((token) => consultancyApi.deleteProviderPlan(token, planId));
              showToast("Treino removido.", "success");
              void studentDetailQuery.refetch();
            } catch (error) {
              handleScreenError({ error, showToast, fallbackMessage: "Falha ao remover o treino." });
            } finally {
              setDeletingPlanId(null);
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
  // Frente 4 (segunda camada), Lote 1: vínculo com este aluno é anterior à
  // janela de retenção de dados de saúde (365 dias) — o backend já manda os
  // campos vazios por segurança, mas antes a tela mostrava esses campos
  // vazios como se fossem editáveis normalmente. Se o profissional digitasse
  // algo, o auto-save reenviava o formulário inteiro e apagava o histórico
  // real que ainda existia por trás.
  const healthDataAccessRestricted = Boolean(
    detail?.anamnesis?.healthDataAccessRestricted || physicalAssessment?.healthDataAccessRestricted
  );

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

  // Frente 4 (segunda camada), Lote 4: o auto-save só disparava depois de
  // 600ms sem digitar — sair da tela (botão voltar) antes disso descartava
  // a edição em silêncio, mesmo a etiqueta ao lado dizendo "Salvamento
  // automático". assessmentFormRef sempre reflete o valor mais recente do
  // formulário, e pendingSaveRef marca se existe uma edição ainda não
  // confirmada como salva.
  const assessmentFormRef = useRef<AssessmentForm>(emptyAssessment);
  const pendingSaveRef = useRef(false);

  const saveAssessment = useCallback(async (form: AssessmentForm) => {
    try {
      setAutoSaving(true);
      await runWithAuth((token) => providersApi.upsertStudentPhysicalAssessment(token, clientId, form));
      pendingSaveRef.current = false;
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar avaliação física.", navigation });
    } finally {
      setAutoSaving(false);
    }
  }, [clientId, navigation, runWithAuth, showToast]);

  useEffect(() => {
    // Frente 4 (segunda camada), Lote 1: nunca tenta salvar quando o acesso
    // a dado de saúde está restrito — o formulário nem é exibido nesse
    // caso, mas essa checagem é a rede de segurança contra reenviar campos
    // vazios por cima de um histórico que ainda existe (o backend também
    // bloqueia isso, ver upsertStudentPhysicalAssessment).
    if (hydratedClientIdRef.current !== clientId || changeCounterRef.current === 0 || healthDataAccessRestricted) return;
    const timer = setTimeout(() => { void saveAssessment(assessmentForm); }, 600);
    return () => clearTimeout(timer);
  }, [assessmentForm, saveAssessment, clientId, healthDataAccessRestricted]);

  useEffect(() => {
    assessmentFormRef.current = assessmentForm;
  }, [assessmentForm]);

  // Frente 4 (segunda camada), Lote 4: dispara o salvamento imediatamente
  // (sem esperar os 600ms de pausa) assim que a tela começa a ser
  // removida, se ainda houver uma edição pendente.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", () => {
      if (pendingSaveRef.current && !healthDataAccessRestricted) {
        void saveAssessment(assessmentFormRef.current);
      }
    });
    return unsubscribe;
  }, [navigation, saveAssessment, healthDataAccessRestricted]);

  const updateAssessmentField = (key: keyof AssessmentForm, value: string) => {
    changeCounterRef.current += 1;
    pendingSaveRef.current = true;
    setAssessmentForm((current) => ({ ...current, [key]: value.slice(0, 6) }));
  };

  const parqFlags = useMemo(() => {
    const parq = answers?.parq;
    if (!parq || typeof parq !== "object") return [];
    return Object.entries(parq as Record<string, unknown>).filter(([, value]) => value === true);
  }, [answers?.parq]);

  const needsAttention = !isAnamnesisComplete || parqFlags.length > 0;
  // Frente 4 (segunda camada), Lote 1: com o acesso restrito, parqFlags
  // sempre vem vazio (não porque não há risco sinalizado, mas porque os
  // dados estão escondidos) — "Sem alerta de saúde" seria uma afirmação
  // falsa exatamente no cenário onde pode haver mais risco.
  const healthBadge = healthDataAccessRestricted
    ? { label: "Dados de saúde indisponíveis", variant: "gray" as const }
    : needsAttention
      ? { label: "Revisão recomendada", variant: "orange" as const }
      : { label: "Sem alerta de saúde", variant: "green" as const };

  const goToAnamnesis = () => {
    if (!detail?.student?.id) return;
    // Frente 4 (segunda camada): a tela de anamnese oferece um atalho pra
    // "solicitar via chat" quando o aluno ainda não preencheu — precisa de
    // uma conversa pra abrir. Prioriza um contrato de consultoria ativo
    // (mesmo padrão já usado no botão "Chat com o aluno" logo abaixo), com
    // fallback pro agendamento presencial mais recente.
    const activeContract = detail.consultancyContracts.find(
      (contract) => contract.status === "ACTIVE" || contract.status === "DELIVERED"
    );
    navigation.navigate("ProfessionalStudentAnamnesis", {
      clientId: detail.student.id,
      clientName: detail.student.name,
      openContractId: activeContract?.id,
      openBookingId: activeContract ? undefined : studentBookings[0]?.id,
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
            <MvText variant="semi2">
              {/* Frente 4 (segunda camada), Lote 2: "Aluno não encontrado" era
                  mostrado tanto pra um 404 de verdade quanto pra uma falha
                  passageira de rede — os dois casos precisam de reação
                  diferente do profissional (um é definitivo, o outro só
                  precisa tentar de novo). */}
              {studentDetailQuery.error ? "Não foi possível carregar este aluno" : "Aluno não encontrado"}
            </MvText>
            <MvText variant="body4" color="secondary" style={{ marginTop: 4 }}>
              {studentDetailQuery.error
                ? "Verifique sua conexão e tente novamente."
                : "Não foi possivel carregar os dados deste aluno agora."}
            </MvText>
            {studentDetailQuery.error ? (
              <MvButton
                style={{ marginTop: 10 }}
                variant="outline"
                label="Tentar de novo"
                onPress={() => void studentDetailQuery.refetch()}
              />
            ) : null}
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
                <MvBadge label={healthBadge.label} variant={healthBadge.variant} />
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <MvButton variant="outline" label="Abrir anamnese completa" onPress={goToAnamnesis} />
                </View>
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
                {!healthDataAccessRestricted ? (
                  <MvText variant="caption" color="secondary">
                    {autoSaving ? "Salvando..." : "Salvamento automático"}
                  </MvText>
                ) : null}
              </View>
              {healthDataAccessRestricted ? (
                <MvText variant="body4" color="secondary">
                  Dados de saúde não disponíveis: o vínculo com este aluno é anterior a 1 ano. O histórico continua guardado, mas fica inacessível até um novo atendimento reativar o vínculo.
                </MvText>
              ) : (
                assessmentFields.map((field) => (
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
                ))
              )}
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

            {/* Frente 9 (segunda camada), Lote 17: diferente de booking
                avulso (que tem BookingDetailProfessionalScreen dedicada),
                pacote presencial e consultoria não têm tela de detalhe
                própria pro profissional - tudo vive inline aqui, resumido
                (sem histórico completo de cobrança por ciclo, sem detalhe
                de disputa). Gap aceito por ora: escopo de feature nova
                (2 telas dedicadas + navegação), não um bug - documentado
                em vez de construído nesta frente. */}
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
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <MvText variant="caption" color="secondary" style={{ flex: 1 }}>
                            Contratado em {formatDate(contract.createdAt)}
                            {contract.validUntil ? ` · válido até ${formatDate(contract.validUntil)}` : ""}
                          </MvText>
                          <MvText variant="semi3" style={{ color: theme.textGreen, flexShrink: 0 }}>
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
                                  accessibilityLabel={`Editar ${plan.title}`}
                                  onPress={() =>
                                    navigation.navigate("TrainingCreation", {
                                      contractId: contract.id,
                                      clientId: detail.student.id,
                                      editPlanId: plan.id,
                                      contractValidUntil: contract.validUntil ?? undefined,
                                    })
                                  }
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 9,
                                    backgroundColor: theme.primarySubtle,
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <Ionicons name="pencil-outline" size={14} color={theme.textGreen} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  accessibilityLabel={`Remover ${plan.title}`}
                                  disabled={deletingPlanId === plan.id}
                                  onPress={() => confirmDeleteTrainingPlan(plan.id, plan.title)}
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 9,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    opacity: deletingPlanId === plan.id ? 0.5 : 1,
                                  }}
                                >
                                  {deletingPlanId === plan.id ? (
                                    <ActivityIndicator size="small" color={theme.danger} />
                                  ) : (
                                    <Ionicons name="trash-outline" size={14} color={theme.danger} />
                                  )}
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                          {contract.isVigente ? (
                            <ActionChip
                              icon="add-circle-outline"
                              label="Criar novo treino"
                              tone="primary"
                              onPress={() =>
                                // Cobrança de ficha por calendário fixo: entregar um treino
                                // (novo ou adicional) nunca cobra na hora, então não há mais
                                // aviso de "isso vai gerar cobrança" aqui — a cobrança, quando
                                // houver, acontece depois sozinha, na data agendada.
                                navigation.navigate("TrainingCreation", {
                                  contractId: contract.id,
                                  clientId: detail.student.id,
                                  contractValidUntil: contract.validUntil ?? undefined,
                                })
                              }
                            />
                          ) : null}

                          {/* Frente 9 (segunda camada), Lote 13: BookingDetailProfessional
                              já tem um botão de chat visível (openBookingId) -
                              consultoria não tinha nenhum equivalente aqui. */}
                          <ActionChip
                            icon="chatbubble-ellipses-outline"
                            label="Chat com o aluno"
                            tone="neutral"
                            onPress={() => navigation.navigate("ProfessionalChatList", { openContractId: contract.id })}
                          />

                          {contract.status === "ACTIVE" || contract.status === "DELIVERED" ? (
                            <ActionChip
                              icon="close-circle-outline"
                              label="Cancelar consultoria"
                              tone="danger"
                              loading={cancellingContractId === contract.id}
                              onPress={() => confirmCancelContract(contract.id)}
                            />
                          ) : null}
                        </View>
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
                        <View style={{ flexDirection: "row", marginTop: 4 }}>
                          <ActionChip
                            icon="close-circle-outline"
                            label="Cancelar pacote"
                            tone="danger"
                            loading={cancellingPackageId === pkg.id}
                            onPress={() => confirmCancelPackage(pkg.id)}
                          />
                        </View>
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
