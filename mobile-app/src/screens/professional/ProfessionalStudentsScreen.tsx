import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthMutation, useAuthQuery } from "../../hooks/useAuthQuery";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../lib/queryKeys";
import * as Haptics from "expo-haptics";
import { Alert, FlatList, ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffectSkippingFirst } from "../../hooks/useFocusEffectSkippingFirst";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { consultancyApi, ExternalCheckIn, ProviderStudent, ProviderStudentServiceKind, providersApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvEmptyState, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { SkeletonStudentCard } from "../../components/polish/SkeletonCard";
import { formatCurrencyBRL, formatRelativeActivityLabel } from "../../utils/formatters";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalStudents">;
type ServiceFilter = "ALL" | ProviderStudentServiceKind | "INACTIVE";

const SERVICE_KIND_ORDER: ProviderStudentServiceKind[] = [
  "PRESENTIAL",
  "ONLINE_CONSULTANCY",
  "ONLINE_CONSULTANCY_SPECIALIZED",
  "COMBO",
];

function isProfileMissingError(err: Error | null): boolean {
  if (!err) return false;
  const message = err.message.toLowerCase();
  return (
    (err as unknown as { status?: number }).status === 404 ||
    message.includes("perfil profissional") ||
    message.includes("provider profile")
  );
}

export function ProfessionalStudentsScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const studentsQuery = useAuthQuery(
    queryKeys.providers.dashboardStudents(),
    (token) => providersApi.dashboardStudents(token),
    { retry: false },
  );

  // Bloco 2 (aluno externo): convites que o profissional gerou e ainda estão
  // aguardando o aluno confirmar — não aparecem em "Meus alunos" até serem
  // confirmados (só existe contrato de verdade depois do claim).
  const queryClient = useQueryClient();
  const invitesQuery = useAuthQuery(
    queryKeys.consultancy.externalStudentInvites(),
    (token) => consultancyApi.listExternalStudentInvites(token),
    { retry: false },
  );
  const cancelInvite = useAuthMutation(
    (token, inviteId: string) => consultancyApi.cancelExternalStudentInvite(token, inviteId),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.consultancy.externalStudentInvites() });
      },
      onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao cancelar o convite." })
    }
  );

  function confirmCancelInvite(inviteId: string, studentName: string) {
    Alert.alert(
      "Cancelar convite",
      `Cancelar o convite de ${studentName}? Ele não vai mais conseguir confirmar o vínculo por esse link.`,
      [
        { text: "Manter", style: "cancel" },
        { text: "Cancelar convite", style: "destructive", onPress: () => cancelInvite.mutate(inviteId) }
      ]
    );
  }

  // Bloco 4 (aluno externo): check-in periódico trimestral (90 dias,
  // realinhado com o Will em 2026-08-25 — era mensal/30 dias) — "ainda é seu
  // aluno?" pros vínculos externos vencidos. "Encerrar" reaproveita o mesmo
  // cancelContract usado em qualquer consultoria (contrato externo nunca
  // teve pagamento real, então a rota de estorno nem entra em ação).
  const checkInsQuery = useAuthQuery(
    queryKeys.consultancy.externalCheckIns(),
    (token) => consultancyApi.listExternalCheckIns(token),
    { retry: false },
  );
  const confirmCheckIn = useAuthMutation(
    (token, contractId: string) => consultancyApi.confirmExternalCheckIn(token, contractId),
    {
      onSuccess: () => {
        showToast("Vínculo confirmado por mais 90 dias.", "success");
        void queryClient.invalidateQueries({ queryKey: queryKeys.consultancy.externalCheckIns() });
      },
      onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao confirmar o check-in." })
    }
  );
  const endCheckInContract = useAuthMutation(
    (token, contractId: string) => consultancyApi.cancelContract(token, contractId),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.consultancy.externalCheckIns() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.providers.dashboardStudents() });
      },
      onError: (error) => handleScreenError({ error, showToast, fallbackMessage: "Falha ao encerrar o vínculo." })
    }
  );

  function confirmEndCheckIn(checkIn: ExternalCheckIn) {
    Alert.alert(
      "Encerrar vínculo",
      `Encerrar o vínculo com ${checkIn.studentName}? Ele sai da sua lista de alunos.`,
      [
        { text: "Manter", style: "cancel" },
        { text: "Encerrar vínculo", style: "destructive", onPress: () => endCheckInContract.mutate(checkIn.contractId) }
      ]
    );
  }

  const data = studentsQuery.data ?? null;
  const loading = studentsQuery.isLoading;
  const refreshing = studentsQuery.isRefetching;
  const needsProfileSetup = studentsQuery.isError && isProfileMissingError(studentsQuery.error);

  useFocusEffectSkippingFirst(useCallback(() => { void studentsQuery.refetch(); }, [studentsQuery.refetch]));

  const onRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void studentsQuery.refetch();
  }, [studentsQuery.refetch]);

  useEffect(() => {
    if (studentsQuery.error && !isProfileMissingError(studentsQuery.error)) {
      handleScreenError({ error: studentsQuery.error, showToast, fallbackMessage: "Falha ao carregar alunos.", navigation });
    }
  }, [studentsQuery.error, showToast, navigation]);

  const [activeServiceFilter, setActiveServiceFilter] = useState<ServiceFilter>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  // Frente 11 (engenharia mobile), Lote 5: filtro é 100% local (a lista
  // inteira já veio do backend, com teto de 2000 alunos) — não existe
  // chamada de rede por tecla aqui, mas recalcular filteredStudents sobre
  // até 2000 itens a cada tecla, síncrono, ainda pesa. searchTerm continua
  // refletindo a tecla imediatamente (input responsivo); só o valor usado
  // pra filtrar de fato espera o usuário pausar de digitar.
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const students = useMemo(() => data?.students ?? [], [data?.students]);
  const totalStudents = data?.totalStudents ?? 0;

  const activeStudentsCount = useMemo(
    () => students.filter((student) => student.active).length,
    [students]
  );
  const inactiveStudentsCount = totalStudents - activeStudentsCount;

  const activeServiceKindsCount = useMemo(() => {
    const counts = data?.serviceCounts;
    if (!counts) return 0;
    return SERVICE_KIND_ORDER.filter((kind) => counts[kind] > 0).length;
  }, [data?.serviceCounts]);

  const averageValueCents = useMemo(() => {
    const values = students.map((student) => student.totalValueCents).filter((value) => value > 0);
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [students]);

  const filterItems: Array<{ key: ServiceFilter; label: string; count: number }> = useMemo(() => {
    const counts = data?.serviceCounts;
    const items: Array<{ key: ServiceFilter; label: string; count: number }> = [
      { key: "ALL", label: "Todos", count: totalStudents },
    ];
    if (counts?.PRESENTIAL) items.push({ key: "PRESENTIAL", label: "Presencial", count: counts.PRESENTIAL });
    if (counts?.ONLINE_CONSULTANCY) items.push({ key: "ONLINE_CONSULTANCY", label: "Consultoria online", count: counts.ONLINE_CONSULTANCY });
    if (counts?.ONLINE_CONSULTANCY_SPECIALIZED) items.push({ key: "ONLINE_CONSULTANCY_SPECIALIZED", label: "Consultoria personalizada", count: counts.ONLINE_CONSULTANCY_SPECIALIZED });
    if (counts?.COMBO) items.push({ key: "COMBO", label: "Combo", count: counts.COMBO });
    if (inactiveStudentsCount > 0) items.push({ key: "INACTIVE", label: "Inativos", count: inactiveStudentsCount });
    return items;
  }, [data?.serviceCounts, totalStudents, inactiveStudentsCount]);

  const filteredStudents = useMemo(() => {
    let rows = students;
    if (activeServiceFilter === "INACTIVE") {
      rows = rows.filter((student) => !student.active);
    } else if (activeServiceFilter !== "ALL") {
      rows = rows.filter((student) => student.services.some((service) => service.serviceKind === activeServiceFilter));
    }
    const normalize = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const query = normalize(debouncedSearchTerm);
    if (!query) return rows;
    return rows.filter((student) => {
      const name = normalize(student.name ?? "");
      const email = normalize(student.email ?? "");
      return name.includes(query) || email.includes(query);
    });
  }, [activeServiceFilter, debouncedSearchTerm, students]);

  // Frente 11 (engenharia mobile), Lote 5: callbacks estáveis repassados ao
  // StudentRow memoizado — antes eram funções inline recriadas por linha a
  // cada render do ScrollView pai (busca, troca de filtro...), o que
  // invalidava o React.memo do row.
  const handleOpenStudent = useCallback(
    (clientId: string) => {
      navigation.navigate("ProfessionalStudentDetail", { clientId });
    },
    [navigation]
  );
  const handleOpenAnamnesis = useCallback(
    (clientId: string, clientName: string) => {
      navigation.navigate("ProfessionalStudentAnamnesis", { clientId, clientName });
    },
    [navigation]
  );

  const renderProfileSetupState = () => (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.students">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <PressableScale
          scale={0.92}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.backBtn, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text1} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Gestão de Alunos</MvText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flex: 1, justifyContent: "center" }}>
        <View style={{ paddingVertical: 40, alignItems: "center", gap: 14 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.primarySubtle, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="people-outline" size={30} color={theme.textGreen} />
          </View>
          <MvText variant="semi1" style={{ textAlign: "center" }}>Finalize seu perfil</MvText>
          <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
            Assim que seu perfil profissional estiver salvo, os dados dos alunos serão exibidos aqui.
          </MvText>
          <PressableScale
            scale={0.96}
            onPress={() => navigation.navigate("ProfessionalTabs", { screen: "ProfessionalProfileEditor" })}
            style={{ marginTop: 4, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 16, backgroundColor: theme.textGreen }}
          >
            <MvText variant="semi2" style={{ color: "#fff" }}>Ir para meu perfil</MvText>
          </PressableScale>
        </View>
      </ScrollView>

      <ProfessionalBottomNav
        activeKey="alunos"
        onPress={(key) => {
          if (key === "home") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
            return;
          }
          if (key === "agenda") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
            return;
          }
          if (key === "consultoria") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalConsultancyCenter" } as never);
            return;
          }
          if (key === "financeiro") {
            navigation.navigate("PayoutStatus" as never);
          }
        }}
      />
    </View>
  );

  if (needsProfileSetup) {
    return renderProfileSetupState();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.professional.students">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* ── Header ── */}
      <View
        style={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <PressableScale
          scale={0.92}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Voltar"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.backBtn, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text1} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Gestão de Alunos</MvText>
        </View>
        <PressableScale
          scale={0.96}
          onPress={() => navigation.navigate("AddExternalStudent" as never)}
          accessibilityLabel="Adicionar aluno de fora do app"
          testID="button.professional-students.add-external"
          style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder }}
        >
          <Ionicons name="person-add-outline" size={16} color={theme.textGreen} />
          <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textGreen }}>Aluno externo</MvText>
        </PressableScale>
        <PressableScale
          scale={0.92}
          onPress={() => navigation.navigate("ProfessionalConsultancyCenter" as never)}
          accessibilityLabel="Central de consultoria"
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="briefcase-outline" size={16} color={theme.text2} />
        </PressableScale>
      </View>

      <ScreenEntrance>
      {/* Frente 11 (engenharia mobile), Lote 5: virou FlatList (virtualização
          real — antes era ScrollView + filteredStudents.map() sem limite,
          com o backend permitindo até 2000 alunos por profissional). Métricas
          + busca + filtros viram cabeçalho da lista, sem scroll aninhado. */}
      <FlatList
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        data={loading ? [] : filteredStudents}
        keyExtractor={(student) => student.clientId}
        renderItem={({ item: student }) => (
          <StudentRow
            student={student}
            onPress={handleOpenStudent}
            onPressAnamnesis={handleOpenAnamnesis}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={{ gap: 12 }}>
              <SkeletonStudentCard />
              <SkeletonStudentCard />
              <SkeletonStudentCard />
            </View>
          ) : studentsQuery.error && !needsProfileSetup ? (
            <View style={{ alignItems: "center", padding: 32, gap: 14 }}>
              <Ionicons name="alert-circle-outline" size={40} color={theme.text3} />
              <View style={{ alignItems: "center", gap: 6 }}>
                <MvText variant="h3" style={{ letterSpacing: -1, textAlign: "center" }}>
                  Não foi possível carregar seus alunos
                </MvText>
                <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                  Verifique sua conexão e tente novamente.
                </MvText>
              </View>
              <PressableScale
                scale={0.96}
                onPress={() => void studentsQuery.refetch()}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 6,
                  paddingHorizontal: 20, paddingVertical: 12,
                  borderRadius: 99,
                  backgroundColor: theme.textGreen,
                }}
              >
                <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
                  Tentar de novo
                </MvText>
              </PressableScale>
            </View>
          ) : (
            <MvEmptyState
              icon="people-outline"
              tone="green"
              title={searchTerm.trim() ? "Nenhum aluno encontrado" : "Seu primeiro aluno está chegando"}
              description={
                searchTerm.trim()
                  ? "Tente buscar por um nome ou email diferente."
                  : "Ative suas ofertas, compartilhe seu perfil e comece a transformar vidas."
              }
              ctaLabel={!searchTerm.trim() ? "Configurar ofertas" : undefined}
              ctaIcon={!searchTerm.trim() ? "add" : undefined}
              onCtaPress={
                !searchTerm.trim()
                  ? () => navigation.navigate("ProfessionalConsultancyCenter", { initialTab: "offers" })
                  : undefined
              }
            />
          )
        }
        ListHeaderComponent={
        <View style={{ gap: 12 }}>
        {/* ── Métricas ── */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border, alignItems: "center" }}>
            <AnimatedNumber value={activeStudentsCount} style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, fontWeight: "800", letterSpacing: -0.2, lineHeight: 28, color: theme.textGreen, textAlign: "center" }} />
            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ marginTop: 2, fontSize: 11, textAlign: "center" }}>Alunos ativos</MvText>
          </View>
          <View style={{ flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border, alignItems: "center" }}>
            <AnimatedNumber value={activeServiceKindsCount} style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, fontWeight: "800", letterSpacing: -0.2, lineHeight: 28, color: theme.text1, textAlign: "center" }} />
            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ marginTop: 2, fontSize: 11, textAlign: "center" }}>Serviços ativos</MvText>
          </View>
          <View style={{ flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 10, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border, alignItems: "center" }}>
            <MvText variant="semi2" style={{ color: theme.textGreen, fontSize: 14, textAlign: "center" }} numberOfLines={1}>
              {averageValueCents ? formatCurrencyBRL(averageValueCents / 100) : "—"}
            </MvText>
            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ marginTop: 2, fontSize: 11, textAlign: "center" }}>Ticket médio</MvText>
          </View>
        </View>

        {/* ── Convites de aluno externo pendentes ── */}
        {invitesQuery.data && invitesQuery.data.length > 0 ? (
          <View style={{ gap: 8 }}>
            <MvText variant="caption" style={{ color: theme.text3 }}>
              CONVITES PENDENTES ({invitesQuery.data.length})
            </MvText>
            {invitesQuery.data.map((invite) => (
              <View
                key={invite.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.warningSubtleBorder,
                  backgroundColor: theme.warningSubtle,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                }}
              >
                <Ionicons name="time-outline" size={16} color={theme.warning} />
                <View style={{ flex: 1 }}>
                  <MvText variant="semi3" numberOfLines={1}>{invite.studentName}</MvText>
                  <MvText variant="caption" style={{ color: theme.text3, marginTop: 1 }}>
                    {invite.channel === "WHATSAPP" ? "WhatsApp" : "E-mail"} · aguardando confirmação
                  </MvText>
                </View>
                <PressableScale
                  scale={0.9}
                  onPress={() => confirmCancelInvite(invite.id, invite.studentName)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={`Cancelar convite de ${invite.studentName}`}
                  testID={`button.professional-students.cancel-invite-${invite.id}`}
                >
                  <Ionicons name="close-circle-outline" size={20} color={theme.text3} />
                </PressableScale>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Bloco 4 (aluno externo): check-in periódico trimestral (90 dias) ── */}
        {checkInsQuery.data && checkInsQuery.data.length > 0 ? (
          <View style={{ gap: 8 }}>
            <MvText variant="caption" style={{ color: theme.text3 }}>
              CHECK-IN PENDENTE ({checkInsQuery.data.length})
            </MvText>
            {checkInsQuery.data.map((checkIn) => (
              <View
                key={checkIn.contractId}
                style={{
                  gap: 10,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.warningSubtleBorder,
                  backgroundColor: theme.warningSubtle,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="help-circle-outline" size={16} color={theme.warning} />
                  <View style={{ flex: 1 }}>
                    <MvText variant="semi3" numberOfLines={1}>{checkIn.studentName}</MvText>
                    <MvText variant="caption" style={{ color: theme.text3, marginTop: 1 }}>
                      Ainda é seu aluno?
                    </MvText>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(() => {
                    // Raio-X pós-épico (achado baixo): sem isso, dava pra
                    // tocar duas vezes seguidas antes da resposta da API —
                    // diferente do padrão já usado em outros botões do
                    // próprio épico (ex: AddExternalStudentScreen).
                    const confirmingThis = confirmCheckIn.isPending && confirmCheckIn.variables === checkIn.contractId;
                    const endingThis = endCheckInContract.isPending && endCheckInContract.variables === checkIn.contractId;
                    return (
                      <>
                        <PressableScale
                          scale={0.97}
                          onPress={() => confirmCheckIn.mutate(checkIn.contractId)}
                          disabled={confirmingThis || endingThis}
                          style={{ flex: 1, height: 38, borderRadius: 10, backgroundColor: theme.textGreen, alignItems: "center", justifyContent: "center", opacity: confirmingThis || endingThis ? 0.6 : 1 }}
                          testID={`button.professional-students.confirm-checkin-${checkIn.contractId}`}
                        >
                          <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 12.5, color: theme.textOnPrimary }}>
                            {confirmingThis ? "Confirmando..." : "Sim, continua"}
                          </MvText>
                        </PressableScale>
                        <PressableScale
                          scale={0.97}
                          onPress={() => confirmEndCheckIn(checkIn)}
                          disabled={confirmingThis || endingThis}
                          style={{ flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: theme.cardBg, alignItems: "center", justifyContent: "center", opacity: confirmingThis || endingThis ? 0.6 : 1 }}
                          testID={`button.professional-students.end-checkin-${checkIn.contractId}`}
                        >
                          <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 12.5, color: theme.text1 }}>
                            {endingThis ? "Encerrando..." : "Encerrar"}
                          </MvText>
                        </PressableScale>
                      </>
                    );
                  })()}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Busca ── */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.inputBg,
          paddingHorizontal: 14,
          gap: 10,
          height: 48,
        }}>
          <Ionicons name="search-outline" size={18} color={theme.text3} />
          <MvInput
            placeholder="Buscar aluno por nome ou email"
            value={searchTerm}
            onChangeText={setSearchTerm}
            style={{ flex: 1, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, height: 44 }}
          />
        </View>

        {/* ── Filtros ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: "row" }}>
          {filterItems.map((item) => {
            const selected = item.key === activeServiceFilter;
            return (
              <PressableScale
                key={item.key}
                scale={0.95}
                onPress={() => setActiveServiceFilter(item.key)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: selected ? "rgba(34,197,94,0.35)" : theme.border,
                  backgroundColor: selected ? theme.primarySubtle : theme.inputBg,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <MvText variant="semi3" style={{ color: selected ? theme.textGreen : theme.text2, fontSize: 13 }}>
                  {item.label}
                </MvText>
                <View style={{
                  minWidth: 18, height: 18, borderRadius: 9,
                  backgroundColor: selected ? theme.primarySubtleBorder : theme.backBtn,
                  alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
                }}>
                  <MvText variant="caption" style={{ color: selected ? theme.textGreen : theme.text3, fontSize: 10 }}>
                    {item.count}
                  </MvText>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
        </View>
        }
      />
      </ScreenEntrance>

      <ProfessionalBottomNav
        activeKey="alunos"
        onPress={(key) => {
          if (key === "home") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalHome" } as never);
            return;
          }
          if (key === "agenda") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalAgenda" } as never);
            return;
          }
          if (key === "consultoria") {
            navigation.navigate("ProfessionalTabs", { screen: "ProfessionalConsultancyCenter" } as never);
            return;
          }
          if (key === "financeiro") {
            navigation.navigate("PayoutStatus" as never);
          }
        }}
      />
    </View>
  );
}

// Frente 11 (engenharia mobile), Lote 5: React.memo — a lista pode ter até
// 2000 linhas (teto do backend); sem memo, digitar na busca ou trocar de
// filtro re-renderizava toda linha visível mesmo quando o dado dela não
// mudou. onPress/onPressAnamnesis recebem o id (e não vêm fechados sobre o
// student) pra poderem ser funções estáveis (useCallback) no pai — ver
// handleOpenStudent/handleOpenAnamnesis.
const StudentRow = React.memo(function StudentRow({
  student,
  onPress,
  onPressAnamnesis,
}: {
  student: ProviderStudent;
  onPress: (clientId: string) => void;
  onPressAnamnesis: (clientId: string, clientName: string) => void;
}) {
  const { theme } = useMvTheme();
  const handlePress = useCallback(() => onPress(student.clientId), [onPress, student.clientId]);
  const handlePressAnamnesis = useCallback(
    () => onPressAnamnesis(student.clientId, student.name),
    [onPressAnamnesis, student.clientId, student.name]
  );

  const initials = student.name
    .split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase();

  const badgeLabel = student.services.map((service) => service.serviceLabel).join(" + ") || "Sem serviço ativo";

  const presentialService = student.services.find((service) => service.serviceKind === "PRESENTIAL");
  const scheduleLine = presentialService
    ? presentialService.nextSessionAt
      ? `Próxima sessão: ${new Date(presentialService.nextSessionAt).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "America/Sao_Paulo",
        })}`
      : "Sem sessão marcada"
    : null;

  return (
    <PressableScale scale={0.97} onPress={handlePress}>
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.cardBg,
        paddingHorizontal: 14,
        paddingVertical: 13,
        opacity: student.active ? 1 : 0.55,
      }}>
        <MvAvatar
          initials={initials}
          photoUri={student.profilePhotoUrl}
          size={46}
          borderRadius={23}
          color="green"
        />
        <View style={{ flex: 1, gap: 2 }}>
          <MvText variant="semi2" numberOfLines={1}>{student.name}</MvText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <MvText variant="body4" color="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {badgeLabel}
            </MvText>
            {scheduleLine ? (
              <>
                <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: theme.text3 }} />
                <MvText variant="body4" color="secondary" numberOfLines={1}>{scheduleLine}</MvText>
              </>
            ) : null}
          </View>
          <MvText variant="caption" color="secondary" numberOfLines={1} style={{ fontSize: 11 }}>
            {formatRelativeActivityLabel(student.lastActivityAt)}
          </MvText>
        </View>
        <View style={{ alignItems: "flex-end", gap: 8 }}>
          <MvText variant="semi2" style={{ fontSize: 13 }}>
            {student.totalValueCents > 0 ? formatCurrencyBRL(student.totalValueCents / 100) : "—"}
          </MvText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {student.anamnesisPending ? (
              <PressableScale
                scale={0.85}
                onPress={handlePressAnamnesis}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID={`student-row-anamnesis-${student.clientId}`}
                accessibilityLabel={`Anamnese pendente de ${student.name}`}
                style={{
                  width: 22, height: 22, borderRadius: 6,
                  backgroundColor: "rgba(245,158,11,0.14)",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="clipboard-outline" size={13} color="#F59E0B" />
              </PressableScale>
            ) : null}
            {/* Frente 4 (segunda camada), Lote 4: os 3 selos tinham a mesma
                aparência clicável, mas só o de anamnese realmente levava a
                algum lugar — tocar nos outros dois não fazia nada. Agora os
                3 levam pro perfil do aluno, onde dá pra resolver a
                pendência (criar treino / entregar renovação). */}
            {student.trainingPlanPending ? (
              <PressableScale
                scale={0.85}
                onPress={handlePress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Ficha de treino pendente de ${student.name}`}
                style={{
                  width: 22, height: 22, borderRadius: 6,
                  backgroundColor: "rgba(245,158,11,0.14)",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="barbell-outline" size={13} color="#F59E0B" />
              </PressableScale>
            ) : null}
            {student.fichaRenewalPending ? (
              <PressableScale
                scale={0.85}
                onPress={handlePress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={`Renovação de ficha pendente de ${student.name}`}
                style={{
                  width: 22, height: 22, borderRadius: 6,
                  backgroundColor: theme.dangerSubtle,
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="refresh-outline" size={13} color="#EF4444" />
              </PressableScale>
            ) : null}
            <View style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              backgroundColor: student.paymentPastDue
                ? theme.dangerSubtle
                : student.active ? theme.primarySubtle : "rgba(107,114,128,0.10)",
              borderWidth: 1,
              borderColor: student.paymentPastDue
                ? "rgba(239,68,68,0.30)"
                : student.active ? theme.primarySubtleBorder : "rgba(107,114,128,0.20)",
            }}>
              <MvText
                variant="body4"
                style={{
                  color: student.paymentPastDue ? "#EF4444" : student.active ? theme.textGreen : theme.text3,
                  fontSize: 11,
                }}
              >
                {student.paymentPastDue ? "Cobrança pendente" : student.active ? "Ativo" : "Inativo"}
              </MvText>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={14} color={theme.text3} />
      </View>
    </PressableScale>
  );
});
