import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import * as Haptics from "expo-haptics";
import { ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ProviderStudent, ProviderStudentServiceKind, providersApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { SkeletonStudentCard } from "../../components/polish/SkeletonCard";
import { formatCurrencyBRL } from "../../utils/formatters";
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

  const data = studentsQuery.data ?? null;
  const loading = studentsQuery.isLoading;
  const refreshing = studentsQuery.isRefetching;
  const needsProfileSetup = studentsQuery.isError && isProfileMissingError(studentsQuery.error);

  useFocusEffect(useCallback(() => { void studentsQuery.refetch(); }, [studentsQuery.refetch]));

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
    const query = normalize(searchTerm);
    if (!query) return rows;
    return rows.filter((student) => {
      const name = normalize(student.name ?? "");
      const email = normalize(student.email ?? "");
      return name.includes(query) || email.includes(query);
    });
  }, [activeServiceFilter, searchTerm, students]);

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
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Gestão de Alunos</MvText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flex: 1, justifyContent: "center" }}>
        <View style={{ paddingVertical: 40, alignItems: "center", gap: 14 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
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
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <MvText style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Gestão de Alunos</MvText>
        </View>
        <PressableScale
          scale={0.92}
          onPress={() => navigation.navigate("ProfessionalConsultancyCenter" as never)}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1, borderColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="person-add-outline" size={18} color={theme.textGreen} />
        </PressableScale>
      </View>

      <ScreenEntrance>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MvRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
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
                  backgroundColor: selected ? "rgba(34,197,94,0.12)" : theme.inputBg,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <MvText variant="semi3" style={{ color: selected ? theme.textGreen : theme.text2, fontSize: 13 }}>
                  {item.label}
                </MvText>
                <View style={{
                  minWidth: 18, height: 18, borderRadius: 9,
                  backgroundColor: selected ? "rgba(34,197,94,0.22)" : theme.backBtn,
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

        {/* ── Lista de alunos ── */}
        {loading ? (
          <>
            <SkeletonStudentCard />
            <SkeletonStudentCard />
            <SkeletonStudentCard />
          </>
        ) : filteredStudents.map((student) => (
          <StudentRow
            key={student.clientId}
            student={student}
            onPress={() => navigation.navigate("ProfessionalStudentDetail", { clientId: student.clientId })}
            onPressAnamnesis={() =>
              navigation.navigate("ProfessionalStudentAnamnesis", {
                clientId: student.clientId,
                clientName: student.name,
              })
            }
          />
        ))}

        {!loading && filteredStudents.length === 0 ? (
          <View style={{ alignItems: "center", padding: 32, gap: 14 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: "rgba(34,197,94,0.10)",
              alignItems: "center", justifyContent: "center",
              borderWidth: 1, borderColor: "rgba(34,197,94,0.20)",
            }}>
              <Ionicons name="people-outline" size={34} color={theme.textGreen} />
            </View>
            <View style={{ alignItems: "center", gap: 6 }}>
              <MvText variant="h3" style={{ letterSpacing: -1, textAlign: "center" }}>
                {searchTerm.trim() ? "Nenhum aluno encontrado" : "Seu primeiro aluno está chegando"}
              </MvText>
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", lineHeight: 20 }}>
                {searchTerm.trim()
                  ? "Tente buscar por um nome ou email diferente."
                  : "Ative suas ofertas, compartilhe seu perfil e comece a transformar vidas."}
              </MvText>
            </View>
            {!searchTerm.trim() ? (
              <PressableScale
                scale={0.96}
                onPress={() => navigation.navigate("ProfessionalConsultancyCenter", { initialTab: "offers" })}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 6,
                  paddingHorizontal: 20, paddingVertical: 12,
                  borderRadius: 99,
                  backgroundColor: theme.textGreen,
                }}
              >
                <Ionicons name="add" size={16} color={theme.textOnPrimary} />
                <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: theme.textOnPrimary }}>
                  Configurar ofertas
                </MvText>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
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

function StudentRow({
  student,
  onPress,
  onPressAnamnesis,
}: {
  student: ProviderStudent;
  onPress: () => void;
  onPressAnamnesis: () => void;
}) {
  const { theme } = useMvTheme();

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
    <PressableScale scale={0.97} onPress={onPress}>
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
        </View>
        <View style={{ alignItems: "flex-end", gap: 8 }}>
          <MvText variant="semi2" style={{ fontSize: 13 }}>
            {student.totalValueCents > 0 ? formatCurrencyBRL(student.totalValueCents / 100) : "—"}
          </MvText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {student.anamnesisPending ? (
              <PressableScale
                scale={0.85}
                onPress={onPressAnamnesis}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{
                  width: 22, height: 22, borderRadius: 6,
                  backgroundColor: "rgba(245,158,11,0.14)",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <Ionicons name="clipboard-outline" size={13} color="#F59E0B" />
              </PressableScale>
            ) : null}
            {student.trainingPlanPending ? (
              <View style={{
                width: 22, height: 22, borderRadius: 6,
                backgroundColor: "rgba(245,158,11,0.14)",
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons name="barbell-outline" size={13} color="#F59E0B" />
              </View>
            ) : null}
            {student.fichaRenewalPending ? (
              <View style={{
                width: 22, height: 22, borderRadius: 6,
                backgroundColor: "rgba(239,68,68,0.14)",
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons name="refresh-outline" size={13} color="#EF4444" />
              </View>
            ) : null}
            <View style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              backgroundColor: student.active ? "rgba(34,197,94,0.12)" : "rgba(107,114,128,0.10)",
              borderWidth: 1,
              borderColor: student.active ? "rgba(34,197,94,0.25)" : "rgba(107,114,128,0.20)",
            }}>
              <MvText variant="body4" style={{ color: student.active ? theme.textGreen : theme.text3, fontSize: 11 }}>
                {student.active ? "Ativo" : "Inativo"}
              </MvText>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={14} color={theme.text3} />
      </View>
    </PressableScale>
  );
}
