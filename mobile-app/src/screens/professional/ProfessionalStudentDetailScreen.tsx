import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { Booking, bookingsApi, ProviderStudentManagementDetail, providersApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvButton, MvCard, MvRefreshControl, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalStudentDetail">;

function bookingBadge(status: Booking["status"]): { label: string; variant: "green" | "orange" | "red" | "gray" } {
  if (status === "COMPLETED") return { label: "Concluído", variant: "green" };
  if (status === "CANCELLED") return { label: "Cancelado", variant: "red" };
  if (status === "CONFIRMED") return { label: "Confirmado", variant: "green" };
  return { label: "Pendente", variant: "orange" };
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
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

  const [detail, setDetail] = useState<ProviderStudentManagementDetail | null>(null);
  const [studentBookings, setStudentBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [payload, allBookings] = await Promise.all([
        runWithAuth((token) => providersApi.dashboardStudentDetail(token, route.params.clientId)),
        runWithAuth((token) => bookingsApi.me(token)).catch(() => [] as Booking[]),
      ]);
      setDetail(payload);
      const filtered = allBookings
        .filter((booking) => (booking as any).clientId === route.params.clientId || booking.client?.id === route.params.clientId)
        .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
        .slice(0, 6);
      setStudentBookings(filtered);
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao carregar o perfil do aluno.",
        navigation,
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, route.params.clientId, runWithAuth, showToast]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const answers = detail?.anamnesis?.answers;
  const isAnamnesisComplete = detail?.anamnesis?.status === "COMPLETED";
  const physicalAssessment = detail?.physicalAssessment;
  const summary = detail?.serviceSummary;

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
          <MvRefreshControl refreshing={loading} onRefresh={() => void load()} />
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

            <MvCard>
              <MvText variant="semi2" style={{ marginBottom: 8 }}>
                Avaliação física atual
              </MvText>
              <AssessmentRow label="Peso" value={physicalAssessment?.weight} unit="kg" />
              <AssessmentRow label="Altura" value={physicalAssessment?.height} unit="cm" />
              <AssessmentRow label="IMC" value={physicalAssessment?.imc} unit="kg/m2" />
              <AssessmentRow label="% Gordura" value={physicalAssessment?.bodyFatPercent} unit="%" />
              <AssessmentRow label="Massa muscular" value={physicalAssessment?.muscleMass} unit="kg" />
              <AssessmentRow label="Cintura" value={physicalAssessment?.waist} unit="cm" />
              <AssessmentRow label="Quadril" value={physicalAssessment?.hip} unit="cm" />
              <AssessmentRow label="Peito" value={physicalAssessment?.chest} unit="cm" />
              <AssessmentRow label="Braço" value={physicalAssessment?.arm} unit="cm" />
              <AssessmentRow label="Coxa" value={physicalAssessment?.thigh} unit="cm" />
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
