import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import * as Haptics from "expo-haptics";
import { Modal, Pressable, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { ProviderDashboardStudentsResponse, ProviderStudent, providersApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvBadge, MvButton, MvCard, MvInput, MvRefreshControl, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AnimatedNumber } from "../../components/polish/AnimatedNumber";
import { SkeletonStudentCard } from "../../components/polish/SkeletonCard";
import { formatCurrencyBRL } from "../../utils/formatters";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalStudents">;
type ServiceFilter = "ALL" | "PRESENTIAL" | "ONLINE_CONSULTANCY" | "ONLINE_CONSULTANCY_SPECIALIZED" | "COMBO";

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

type StudentRow = {
  serviceKind: ServiceFilter;
  serviceLabel: string;
  student: ProviderStudent;
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

const assessmentSections: Array<{
  title: string;
  fields: Array<{ key: keyof AssessmentForm; label: string; unit: string }>;
}> = [
  {
    title: "Dados básicos",
    fields: [
      { key: "weight", label: "Peso", unit: "kg" },
      { key: "height", label: "Altura", unit: "cm" },
      { key: "imc", label: "IMC", unit: "kg/m2" },
    ],
  },
  {
    title: "Composição corporal",
    fields: [
      { key: "bodyFatPercent", label: "% de gordura", unit: "%" },
      { key: "muscleMass", label: "Massa muscular", unit: "kg" },
    ],
  },
  {
    title: "Circunferências",
    fields: [
      { key: "waist", label: "Cintura", unit: "cm" },
      { key: "hip", label: "Quadril", unit: "cm" },
      { key: "chest", label: "Peito", unit: "cm" },
      { key: "arm", label: "Braço", unit: "cm" },
      { key: "thigh", label: "Coxa", unit: "cm" },
      { key: "circumferences", label: "Circunferência geral", unit: "cm" },
    ],
  },
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
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const iconColor = theme.mode === "dark" ? "#D8E0D8" : "#394239";

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

  const [modalVisible, setModalVisible] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<ProviderStudent | null>(null);
  const [assessmentForm, setAssessmentForm] = useState<AssessmentForm>(emptyAssessment);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const changeCounterRef = useRef(0);
  const hydratedRef = useRef(false);


  const saveAssessment = useCallback(async () => {
    if (!selectedStudent) return;
    try {
      setAutoSaving(true);
      await runWithAuth((token) =>
        providersApi.upsertStudentPhysicalAssessment(token, selectedStudent.clientId, assessmentForm)
      );
    } catch (error) {
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao salvar avaliação física.",
        navigation,
      });
    } finally {
      setAutoSaving(false);
    }
  }, [assessmentForm, navigation, runWithAuth, selectedStudent, showToast]);

  useEffect(() => {
    if (!modalVisible || !selectedStudent || !hydratedRef.current) return;
    const timer = setTimeout(() => {
      if (changeCounterRef.current > 0) void saveAssessment();
    }, 600);
    return () => clearTimeout(timer);
  }, [assessmentForm, modalVisible, saveAssessment, selectedStudent]);

  const openAssessment = async (student: ProviderStudent) => {
    try {
      setSelectedStudent(student);
      setModalVisible(true);
      setAssessmentLoading(true);
      hydratedRef.current = false;
      changeCounterRef.current = 0;
      const payload = await runWithAuth((token) =>
        providersApi.dashboardStudentPhysicalAssessment(token, student.clientId)
      );
      setAssessmentForm(toAssessmentForm(payload as unknown as Record<string, unknown>));
      hydratedRef.current = true;
    } catch (error) {
      setModalVisible(false);
      setSelectedStudent(null);
      handleScreenError({
        error,
        showToast,
        fallbackMessage: "Falha ao abrir avaliação física.",
        navigation,
      });
    } finally {
      setAssessmentLoading(false);
    }
  };

  const updateField = (key: keyof AssessmentForm, value: string) => {
    changeCounterRef.current += 1;
    setAssessmentForm((current) => ({ ...current, [key]: value.slice(0, 6) }));
  };

  const closeModal = () => {
    if (autoSaving) {
      showToast("Aguarde o salvamento terminar.", "info");
      return;
    }
    setModalVisible(false);
    setSelectedStudent(null);
    setAssessmentForm(emptyAssessment);
    hydratedRef.current = false;
    changeCounterRef.current = 0;
  };

  const services = useMemo(() => data?.services ?? [], [data?.services]);
  const totalStudents = useMemo(
    () => services.reduce((total, service) => total + service.totalStudents, 0),
    [services]
  );
  const activeServicesCount = useMemo(
    () => services.filter((service) => service.totalStudents > 0).length,
    [services]
  );

  const averageContractValueCents = useMemo(() => {
    const values = services.flatMap((service) =>
      service.students
        .map((student) => student.contractedValueCents)
        .filter((value): value is number => typeof value === "number")
    );
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }, [services]);

  const studentRows = useMemo(() => {
    const rows: StudentRow[] = [];
    services.forEach((service) => {
      if (activeServiceFilter !== "ALL" && service.serviceKind !== activeServiceFilter) return;
      service.students.forEach((student) => {
        rows.push({
          serviceKind: service.serviceKind as ServiceFilter,
          serviceLabel: service.serviceLabel,
          student,
        });
      });
    });
    return rows;
  }, [activeServiceFilter, services]);

  const filteredRows = useMemo(() => {
    const normalize = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const query = normalize(searchTerm);
    if (!query) return studentRows;
    return studentRows.filter((row) => {
      const name = normalize(row.student.name ?? "");
      const email = normalize(row.student.email ?? "");
      return name.includes(query) || email.includes(query);
    });
  }, [searchTerm, studentRows]);

  const serviceFilterItems: Array<{ key: ServiceFilter; label: string; count: number }> = useMemo(() => {
    const items: Array<{ key: ServiceFilter; label: string; count: number }> = [
      { key: "ALL", label: "Todos", count: totalStudents },
    ];
    services.forEach((service) => {
      items.push({
        key: service.serviceKind as ServiceFilter,
        label: service.serviceLabel,
        count: service.totalStudents,
      });
    });
    return items;
  }, [services, totalStudents]);

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
    <>
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
          {/* ── Grid de métricas ── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border }}>
              <AnimatedNumber value={totalStudents} style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, fontWeight: "800", letterSpacing: -0.2, lineHeight: 28, color: theme.textGreen }} />
              <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>Alunos ativos</MvText>
            </View>
            <View style={{ flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border }}>
              <AnimatedNumber value={activeServicesCount} style={{ fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 22, fontWeight: "800", letterSpacing: -0.2, lineHeight: 28, color: theme.text1 }} />
              <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>Serviços ativos</MvText>
            </View>
            <View style={{ flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, backgroundColor: theme.cardBg, borderColor: theme.border }}>
              <MvText variant="semi2" style={{ color: theme.textGreen, fontSize: 14 }} numberOfLines={1}>
                {averageContractValueCents ? formatCurrencyBRL(averageContractValueCents / 100) : "—"}
              </MvText>
              <MvText variant="body4" color="secondary" style={{ marginTop: 2 }}>Ticket médio</MvText>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: "row" }}>
              {serviceFilterItems.map((item) => {
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
            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.inputBg, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <Ionicons name="options-outline" size={18} color={theme.text2} />
            </TouchableOpacity>
          </View>

          {/* ── Lista de alunos ── */}
          {loading ? (
            <>
              <SkeletonStudentCard />
              <SkeletonStudentCard />
              <SkeletonStudentCard />
            </>
          ) : filteredRows.map((row) => {
            const recentMs = row.student.lastActivityAt
              ? Date.now() - new Date(row.student.lastActivityAt).getTime()
              : Infinity;
            const isActive = recentMs < 60 * 24 * 60 * 60 * 1000; // ativo se actividade < 60 dias
            const engagementDot =
              recentMs < 3 * 24 * 60 * 60 * 1000
                ? theme.primary
                : recentMs < 7 * 24 * 60 * 60 * 1000
                ? "#F5A623"
                : theme.danger;
            const initials = row.student.name
              .split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase();
            return (
              <PressableScale
                key={`${row.serviceKind}-${row.student.clientId}`}
                scale={0.97}
                onPress={() => navigation.navigate("ProfessionalStudentDetail", { clientId: row.student.clientId })}
              >
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
                }}>
                  <View style={{ position: "relative" }}>
                    <MvAvatar
                      initials={initials}
                      photoUri={row.student.profilePhotoUrl}
                      size={46}
                      borderRadius={23}
                      color="green"
                    />
                    <View style={{
                      position: "absolute",
                      bottom: 1,
                      right: 1,
                      width: 11,
                      height: 11,
                      borderRadius: 6,
                      backgroundColor: engagementDot,
                      borderWidth: 2,
                      borderColor: theme.cardBg,
                    }} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <MvText variant="semi2" numberOfLines={1}>{row.student.name}</MvText>
                    <MvText variant="body4" color="secondary" numberOfLines={1}>{row.student.email}</MvText>
                    <MvText variant="body4" color="secondary">{row.serviceLabel}</MvText>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 8 }}>
                    <View style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 20,
                      backgroundColor: isActive ? "rgba(34,197,94,0.12)" : "rgba(107,114,128,0.10)",
                      borderWidth: 1,
                      borderColor: isActive ? "rgba(34,197,94,0.25)" : "rgba(107,114,128,0.20)",
                    }}>
                      <MvText variant="body4" style={{ color: isActive ? theme.textGreen : theme.text3, fontSize: 11 }}>
                        {isActive ? "Ativo" : "Inativo"}
                      </MvText>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={theme.text3} />
                  </View>
                </View>
              </PressableScale>
            );
          })}

          {!loading && filteredRows.length === 0 ? (
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

      <Modal animationType="fade" transparent visible={modalVisible} onRequestClose={closeModal}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={closeModal}
          />

          <View
            style={{
              width: "92%",
              maxHeight: "78%",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.cardBg,
              padding: 20,
              gap: 10,
            }}
          >
            <MvText variant="semi1">Avaliação física do aluno</MvText>
            <MvText variant="body4" color="secondary">
              {selectedStudent?.name ?? "Aluno"} {autoSaving ? "- Salvando..." : "- salvamento automatico ativo"}
            </MvText>

            {assessmentLoading ? (
              <MvText variant="body4" color="secondary" style={{ textAlign: "center", marginVertical: 16 }}>
                Carregando dados...
              </MvText>
            ) : (
              <ScrollView contentContainerStyle={{ gap: 4 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {assessmentSections.map((section) => (
                  <View key={section.title} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 4 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                      <MvText variant="caption" color="secondary" style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                        {section.title}
                      </MvText>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
                    </View>
                    {section.fields.map((field) => (
                      <View key={field.key} style={{ marginBottom: 8 }}>
                        <MvText variant="body4" color="secondary" style={{ marginBottom: 4 }}>
                          {field.label}{" "}
                          <MvText variant="body4" color="tertiary">
                            ({field.unit})
                          </MvText>
                        </MvText>
                        <MvInput
                          keyboardType="number-pad"
                          placeholder="0"
                          maxLength={6}
                          value={assessmentForm[field.key]}
                          onChangeText={(value) => updateField(field.key, value)}
                        />
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <MvText variant="body4" color="secondary">
                {autoSaving ? "Salvando..." : "Auto-save ativo"}
              </MvText>
              <PressableScale
                scale={0.95}
                onPress={closeModal}
                style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.backBtn }}
              >
                <MvText variant="semi3">Fechar</MvText>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
