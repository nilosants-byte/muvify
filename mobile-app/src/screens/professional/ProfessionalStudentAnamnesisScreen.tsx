import React, { useEffect } from "react";
import { ActivityIndicator, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { StudentAnamnesisResponse, providersApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvCard, MvText } from "../../components/mv";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { handleScreenError } from "../shared/api-helpers";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalStudentAnamnesis">;

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "Não informado";
  if (typeof value === "string") return value.trim() || "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "Não informado";
  if (typeof value === "number") return String(value);
  return "Não informado";
}

const SECTION_LABELS: Record<string, string> = {
  personalData: "Dados Pessoais",
  objectives: "Objetivos",
  healthHistory: "Histórico de Saúde",
  medicationAndSupplements: "Medicamentos e Suplementos",
  familyHistory: "Histórico Familiar",
  activityHistory: "Histórico de Atividade",
  lifestyle: "Estilo de Vida",
  nutrition: "Nutrição",
  limitations: "Limitações",
  behavior: "Comportamento",
  imageAuthorization: "Autorização de Imagem",
  parq: "PAR-Q",
};

const FIELD_LABELS: Record<string, string> = {
  // personalData
  fullName: "Nome completo",
  birthDate: "Data de nascimento",
  age: "Idade",
  sex: "Sexo",
  weightKg: "Peso",
  heightM: "Altura",
  phone: "Telefone/WhatsApp",
  email: "E-mail",
  fullAddress: "Endereço completo",
  emergencyContact: "Contato de emergência",
  // objectives
  mainObjective: "Objetivo principal",
  targetTimeframe: "Prazo para atingir o objetivo",
  selected: "Objetivos selecionados",
  goals: "Objetivos selecionados",
  // healthHistory
  hasDiagnosedDisease: "Possui doença diagnosticada?",
  diagnosedDiseaseDetails: "Quais doenças?",
  hadSurgery: "Já teve cirurgia?",
  surgeryDetails: "Quais cirurgias?",
  hasInjuries: "Lesões articulares ou musculares?",
  injuriesDetails: "Quais lesões?",
  hasCurrentPain: "Sente dores atualmente?",
  currentPainDetails: "Onde dói?",
  hasCardiacProblems: "Problemas cardíacos?",
  hasHypertension: "Hipertensão?",
  hasDiabetes: "Diabetes?",
  hasRespiratoryProblems: "Problemas respiratórios?",
  // medicationAndSupplements
  usesMedication: "Faz uso de medicamentos?",
  medicationDetails: "Quais medicamentos?",
  usesSupplements: "Faz uso de suplementos?",
  supplementsDetails: "Quais suplementos?",
  usedHormones: "Já usou hormônios/anabolizantes?",
  hormonesDetails: "Quais hormônios?",
  // familyHistory
  hasCardiacDisease: "Doença cardíaca na família?",
  hasObesity: "Obesidade na família?",
  hasOrthopedicProblems: "Problemas ortopédicos na família?",
  // activityHistory
  hasTrainedBefore: "Já treinou antes?",
  hadProfessionalSupport: "Já teve acompanhamento profissional?",
  trainingDuration: "Há quanto tempo treina?",
  weeklyFrequency: "Frequência semanal",
  practicedModalities: "Modalidades praticadas",
  stopReason: "Motivo de ter parado",
  // lifestyle
  smokes: "Fuma?",
  sleepHours: "Horas de sono por noite",
  sleepQuality: "Qualidade do sono",
  stressLevel: "Nível de estresse",
  alcoholConsumption: "Consumo de álcool",
  workRoutine: "Rotina de trabalho",
  // nutrition
  followsDiet: "Segue alguma dieta?",
  dietDetails: "Qual dieta?",
  hasBingeEating: "Tem compulsão alimentar?",
  mealsPerDay: "Refeições por dia",
  waterIntake: "Consumo de água por dia",
  avoidedFoods: "Alimentos evitados ou não gosta",
  // limitations
  physicalLimitations: "Limitações físicas",
  restrictedExercises: "Exercícios restritos",
  // behavior
  trainingMotivation: "Motivação para treinar",
  biggestConsistencyDifficulty: "Maior dificuldade de consistência",
  quitBeforeReason: "Motivo de desistência anterior",
  // imageAuthorization
  allowImageUse: "Autoriza uso de imagens?",
  imageDetails: "Detalhes sobre autorização",
  // parq
  hasHeartCondition: "Condição cardíaca?",
  chestPainDuringExercise: "Dor no peito durante exercício?",
  chestPainAtRestLastMonth: "Dor no peito em repouso (último mês)?",
  dizzinessOrFainting: "Tontura ou desmaio?",
  jointProblemsWithExercise: "Problemas articulares com exercício?",
  usesCardiacMedication: "Usa medicação cardíaca?",
  hasOtherExerciseRestriction: "Outras restrições para exercício?",
};

const SECTION_FIELD_LABELS: Record<string, Record<string, string>> = {
  objectives: {
    other: "Outro objetivo",
  },
  familyHistory: {
    other: "Outros casos relevantes na família",
  },
};

function AnamnesisSection({ sectionKey, data }: { sectionKey: string; data: Record<string, unknown> }) {
  const { theme } = useMvTheme();
  const label = SECTION_LABELS[sectionKey] ?? sectionKey;
  const getFieldLabel = (key: string) =>
    SECTION_FIELD_LABELS[sectionKey]?.[key] ?? FIELD_LABELS[key] ?? key;
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <MvCard style={{ marginBottom: 12 }}>
      <MvText variant="semi3" style={{ marginBottom: 8, color: theme.primary }}>{label}</MvText>
      {entries.map(([key, value]) => (
        <View key={key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, gap: 8 }}>
          <MvText variant="body4" color="secondary" style={{ flex: 1 }}>{getFieldLabel(key)}</MvText>
          <MvText variant="body4" style={{ flex: 1.5, textAlign: "right", color: theme.text1 }}>
            {renderValue(value)}
          </MvText>
        </View>
      ))}
    </MvCard>
  );
}

export function ProfessionalStudentAnamnesisScreen({ navigation, route }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { clientId, clientName } = route.params;

  const anamnesisQuery = useAuthQuery(
    queryKeys.providers.studentAnamnesis(clientId),
    (t) => providersApi.getStudentAnamnesis(t, clientId),
  );
  const anamnesis = anamnesisQuery.data ?? null;
  const loading = anamnesisQuery.isLoading;

  useEffect(() => {
    if (anamnesisQuery.error) {
      handleScreenError({ error: anamnesisQuery.error, showToast, fallbackMessage: "Não foi possível carregar a ficha do aluno." });
    }
  }, [anamnesisQuery.error, showToast]);

  const statusBadge = () => {
    if (!anamnesis || anamnesis.status === "NONE") return <MvBadge label="Sem ficha" variant="gray" />;
    if (anamnesis.status === "DRAFT") return <MvBadge label="Incompleta" variant="orange" />;
    return <MvBadge label="Completa" variant="green" />;
  };

  const sections = anamnesis?.answers && typeof anamnesis.answers === "object"
    ? Object.entries(anamnesis.answers as Record<string, unknown>).filter(
        ([, v]) => v && typeof v === "object" && !Array.isArray(v)
      )
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <ProfessionalScreenHeader
        title="Ficha de Anamnese"
        subtitle={clientName}
        onBack={() => navigation.goBack()}
      />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      ) : !anamnesis || anamnesis.status === "NONE" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
          <Ionicons name="document-outline" size={52} color={theme.text3} />
          <MvText variant="semi3" style={{ textAlign: "center", color: theme.text2 }}>
            Ficha não preenchida
          </MvText>
          <MvText variant="body3" color="secondary" style={{ textAlign: "center" }}>
            {clientName} ainda não preencheu a anamnese. Você pode solicitar via chat para se preparar melhor para a aula.
          </MvText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {anamnesis.status === "DRAFT" && (
            <View style={{
              backgroundColor: "rgba(255,152,0,0.12)",
              borderRadius: 10,
              padding: 12,
              marginBottom: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}>
              <Ionicons name="alert-circle-outline" size={18} color="#FF9800" />
              <MvText variant="body4" style={{ color: "#FF9800", flex: 1 }}>
                Ficha incompleta — algumas informações podem estar faltando.
              </MvText>
            </View>
          )}

          {sections.length === 0 && (
            <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
              <Ionicons name="document-text-outline" size={40} color={theme.text3} />
              <MvText variant="body3" color="secondary">Sem dados detalhados disponíveis.</MvText>
            </View>
          )}

          {sections.map(([key, value]) => (
            <AnamnesisSection
              key={key}
              sectionKey={key}
              data={value as Record<string, unknown>}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
