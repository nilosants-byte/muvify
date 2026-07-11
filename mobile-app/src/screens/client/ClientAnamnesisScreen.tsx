import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { AnamnesisAnswers, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { MvButton } from "../../components/mv/MvButton";
import { MvCard } from "../../components/mv/MvCard";
import { MvInput } from "../../components/mv/MvInput";
import { MvText } from "../../components/mv/MvText";
import { handleScreenError } from "../shared/api-helpers";
import { useMvTheme } from "../../theme/MvThemeContext";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";
import { C, S } from "../../theme/v2tokens";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientAnamnesis">;

type TextField = {
  key: string;
  label: string;
  maxLength: number;
  keyboardType?: "default" | "email-address" | "number-pad" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  optional?: boolean;
  multiline?: boolean;
};
type BoolField = {
  key: string;
  label: string;
  detailsKey?: string;
  detailsLabel?: string;
};
type SectionKey =
  | "personalData"
  | "objectives"
  | "healthHistory"
  | "medicationAndSupplements"
  | "familyHistory"
  | "activityHistory"
  | "lifestyle"
  | "nutrition"
  | "limitations"
  | "behavior"
  | "imageAuthorization"
  | "parq";

const personalDataFields: TextField[] = [
  { key: "fullName", label: "Nome completo", maxLength: 100 },
  { key: "birthDate", label: "Data de nascimento (ex: 15/08/1990)", maxLength: 10, keyboardType: "number-pad" },
  { key: "age", label: "Idade", maxLength: 5, keyboardType: "number-pad" },
  { key: "phone", label: "Telefone/WhatsApp", maxLength: 30, keyboardType: "phone-pad" },
  { key: "email", label: "E-mail", maxLength: 120, keyboardType: "email-address", autoCapitalize: "none" },
  { key: "fullAddress", label: "Endereço completo", maxLength: 200 },
  { key: "emergencyContact", label: "Contato de emergência (nome e telefone)", maxLength: 100 },
];

const genderOptions = [
  { label: "Mulher", value: "Mulher" },
  { label: "Homem", value: "Homem" },
  { label: "Não Binário", value: "Não Binário" },
  { label: "Prefiro não informar", value: "Prefiro não informar" },
] as const;

function parseNumericInput(raw: string): number | null {
  const clean = raw.replace(/[^\d.,]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function formatWeightDisplay(raw: string): string {
  const n = parseNumericInput(raw);
  if (n === null) return raw.trim();
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) + " kg";
}

function formatHeightDisplay(raw: string): string {
  const n = parseNumericInput(raw);
  if (n === null) return raw.trim();
  const meters = n >= 100 ? n / 100 : n;
  const hasDec = meters % 1 !== 0;
  return meters.toLocaleString("pt-BR", { minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2 }) + " m";
}

function stripUnit(value: string, unit: string): string {
  return value.replace(new RegExp("\\s*" + unit + "\\s*$", "i"), "").trim();
}

function formatBirthDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

const objectiveFields: TextField[] = [
  { key: "other", label: "Outro objetivo", maxLength: 300, optional: true, multiline: true },
  { key: "mainObjective", label: "Descreva seu objetivo principal", maxLength: 300, multiline: true },
  { key: "targetTimeframe", label: "Prazo para atingir o objetivo", maxLength: 300, multiline: true },
];

const healthFields: BoolField[] = [
  { key: "hasDiagnosedDisease", label: "Possui alguma doença diagnosticada?", detailsKey: "diagnosedDiseaseDetails", detailsLabel: "Se sim, quais?" },
  { key: "hadSurgery", label: "Já teve alguma cirurgia?", detailsKey: "surgeryDetails", detailsLabel: "Quais cirurgias?" },
  { key: "hasInjuries", label: "Lesões articulares ou musculares?", detailsKey: "injuriesDetails", detailsLabel: "Se sim, quais lesões?" },
  { key: "hasCurrentPain", label: "Sente dores atualmente?", detailsKey: "currentPainDetails", detailsLabel: "Onde?" },
  { key: "hasCardiacProblems", label: "Problemas cardíacos?" },
  { key: "hasHypertension", label: "Hipertensão?" },
  { key: "hasDiabetes", label: "Diabetes?" },
  { key: "hasRespiratoryProblems", label: "Problemas respiratórios?" },
];

const medicationFields: BoolField[] = [
  { key: "usesMedication", label: "Faz uso de medicamentos?", detailsKey: "medicationDetails", detailsLabel: "Quais medicamentos?" },
  { key: "usesSupplements", label: "Faz uso de suplementos?", detailsKey: "supplementsDetails", detailsLabel: "Quais suplementos?" },
  { key: "usedHormones", label: "Já usou hormônios/anabolizantes?", detailsKey: "hormonesDetails", detailsLabel: "Quais hormônios?" },
];

const activityFields: BoolField[] = [
  { key: "hasTrainedBefore", label: "Já treinou antes?" },
  { key: "hadProfessionalSupport", label: "Já teve acompanhamento profissional?" },
];

const activityTextFields: TextField[] = [
  { key: "trainingDuration", label: "Há quanto tempo treina?", maxLength: 30 },
  { key: "weeklyFrequency", label: "Frequência semanal", maxLength: 30 },
  { key: "practicedModalities", label: "Modalidades praticadas", maxLength: 300, multiline: true },
  { key: "stopReason", label: "Motivo de ter parado (opcional)", maxLength: 300, optional: true, multiline: true },
];

const nutritionFields: BoolField[] = [
  { key: "followsDiet", label: "Segue alguma dieta?", detailsKey: "dietDetails", detailsLabel: "Qual dieta?" },
  { key: "hasBingeEating", label: "Tem compulsão alimentar?" },
];

const nutritionTextFields: TextField[] = [
  { key: "mealsPerDay", label: "Quantas refeições por dia?", maxLength: 30 },
  { key: "waterIntake", label: "Consumo de água por dia", maxLength: 30 },
  { key: "avoidedFoods", label: "Alimentos que evita ou não gosta", maxLength: 300, multiline: true },
];

const lifestyleOptions = {
  sleepQuality: [
    { label: "Boa", value: "BOA" },
    { label: "Regular", value: "REGULAR" },
    { label: "Ruim", value: "RUIM" },
  ],
  stressLevel: [
    { label: "Baixo", value: "BAIXO" },
    { label: "Moderado", value: "MODERADO" },
    { label: "Alto", value: "ALTO" },
  ],
  alcoholConsumption: [
    { label: "Não", value: "NAO" },
    { label: "Social", value: "SOCIAL" },
    { label: "Frequente", value: "FREQUENTE" },
  ],
  workRoutine: [
    { label: "Sedentária", value: "SEDENTARIA" },
    { label: "Moderadamente ativa", value: "MODERADAMENTE_ATIVA" },
    { label: "Muito ativa", value: "MUITO_ATIVA" },
  ],
};

const goals = [
  { label: "Emagrecimento", value: "EMAGRECIMENTO" },
  { label: "Hipertrofia", value: "HIPERTROFIA" },
  { label: "Condicionamento", value: "CONDICIONAMENTO_FISICO" },
  { label: "Reabilitação", value: "REABILITACAO" },
  { label: "Performance", value: "PERFORMANCE_ESPORTIVA" },
  { label: "Saúde geral", value: "SAUDE_GERAL" },
] as const;

const TOTAL_REQUIRED = 28 + 24 + 2;

const requiredPaths = [
  ["personalData", "fullName"], ["personalData", "birthDate"], ["personalData", "age"],
  ["personalData", "sex"], ["personalData", "weightKg"], ["personalData", "heightM"],
  ["personalData", "phone"], ["personalData", "email"], ["personalData", "fullAddress"],
  ["personalData", "emergencyContact"], ["objectives", "mainObjective"], ["objectives", "targetTimeframe"],
  ["activityHistory", "trainingDuration"], ["activityHistory", "weeklyFrequency"],
  ["activityHistory", "practicedModalities"],
  ["lifestyle", "sleepHours"], ["lifestyle", "sleepQuality"], ["lifestyle", "stressLevel"],
  ["lifestyle", "alcoholConsumption"], ["lifestyle", "workRoutine"],
  ["nutrition", "mealsPerDay"], ["nutrition", "waterIntake"], ["nutrition", "avoidedFoods"],
  ["limitations", "physicalLimitations"], ["limitations", "restrictedExercises"],
  ["behavior", "trainingMotivation"], ["behavior", "biggestConsistencyDifficulty"], ["behavior", "quitBeforeReason"],
] as const;

const requiredBooleans = [
  ["healthHistory", "hasDiagnosedDisease"], ["healthHistory", "hadSurgery"],
  ["healthHistory", "hasInjuries"], ["healthHistory", "hasCurrentPain"],
  ["healthHistory", "hasCardiacProblems"], ["healthHistory", "hasHypertension"],
  ["healthHistory", "hasDiabetes"], ["healthHistory", "hasRespiratoryProblems"],
  ["medicationAndSupplements", "usesMedication"], ["medicationAndSupplements", "usesSupplements"],
  ["medicationAndSupplements", "usedHormones"], ["activityHistory", "hasTrainedBefore"],
  ["activityHistory", "hadProfessionalSupport"], ["lifestyle", "smokes"],
  ["nutrition", "followsDiet"], ["nutrition", "hasBingeEating"],
  ["imageAuthorization", "allowImageUse"], ["parq", "hasHeartCondition"],
  ["parq", "chestPainDuringExercise"], ["parq", "chestPainAtRestLastMonth"],
  ["parq", "dizzinessOrFainting"], ["parq", "jointProblemsWithExercise"],
  ["parq", "usesCardiacMedication"], ["parq", "hasOtherExerciseRestriction"],
] as const;

function stripNulls<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null) result[k] = v;
  }
  return result as T;
}

function buildInitialAnswers(input?: AnamnesisAnswers | null): AnamnesisAnswers {
  return {
    personalData: stripNulls({ ...(input?.personalData ?? {}) }),
    objectives: stripNulls({ selected: input?.objectives?.selected ?? [], ...(input?.objectives ?? {}) }),
    healthHistory: stripNulls({ ...(input?.healthHistory ?? {}) }),
    medicationAndSupplements: stripNulls({ ...(input?.medicationAndSupplements ?? {}) }),
    familyHistory: stripNulls({ ...(input?.familyHistory ?? {}) }),
    activityHistory: stripNulls({ ...(input?.activityHistory ?? {}) }),
    lifestyle: stripNulls({ ...(input?.lifestyle ?? {}) }),
    nutrition: stripNulls({ ...(input?.nutrition ?? {}) }),
    limitations: stripNulls({ ...(input?.limitations ?? {}) }),
    behavior: stripNulls({ ...(input?.behavior ?? {}) }),
    imageAuthorization: stripNulls({ ...(input?.imageAuthorization ?? {}) }),
    parq: stripNulls({ ...(input?.parq ?? {}) }),
    responsibilityTermAccepted: input?.responsibilityTermAccepted === true,
  };
}

function getValue(input: AnamnesisAnswers, path: readonly string[]) {
  return path.reduce<unknown>((acc, key) => {
    if (typeof acc === "object" && acc && key in acc) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, input);
}

function missingRequired(answers: AnamnesisAnswers) {
  let missing = 0;
  requiredPaths.forEach((path) => {
    const value = getValue(answers, path);
    if (typeof value !== "string" || !value.trim()) missing += 1;
  });
  requiredBooleans.forEach((path) => {
    if (typeof getValue(answers, path) !== "boolean") missing += 1;
  });
  if (!answers.objectives?.selected?.length && !(answers.objectives?.other ?? "").trim()) missing += 1;
  if (answers.responsibilityTermAccepted !== true) missing += 1;
  return missing;
}

const lifestyleKeyLabel: Record<string, string> = {
  sleepQuality: "Qualidade do sono",
  stressLevel: "Nível de estresse",
  alcoholConsumption: "Consumo de álcool",
  workRoutine: "Rotina de trabalho",
};

const STEPS = [
  { icon: "person-outline" as const,           title: "Dados pessoais",      subtitle: "Informações básicas de identificação" },
  { icon: "flag-outline" as const,             title: "Objetivos",           subtitle: "O que você quer alcançar" },
  { icon: "heart-outline" as const,            title: "Histórico de saúde",  subtitle: "Condições médicas, medicamentos e família" },
  { icon: "barbell-outline" as const,          title: "Atividade física",    subtitle: "Experiência e histórico de treinos" },
  { icon: "sunny-outline" as const,            title: "Estilo de vida",      subtitle: "Rotina, sono e hábitos alimentares" },
  { icon: "bulb-outline" as const,             title: "Limitações",          subtitle: "Restrições físicas e aspectos comportamentais" },
  { icon: "shield-checkmark-outline" as const, title: "Finalização",         subtitle: "Triagem PAR-Q, imagem e termos" },
];

const TOTAL_STEPS = STEPS.length;

const familyHistoryItems = [
  { key: "hasCardiacDisease", label: "Doença cardíaca" },
  { key: "hasHypertension", label: "Hipertensão" },
  { key: "hasDiabetes", label: "Diabetes" },
  { key: "hasObesity", label: "Obesidade" },
  { key: "hasOrthopedicProblems", label: "Problemas ortopédicos" },
];

export function ClientAnamnesisScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [answers, setAnswers] = useState<AnamnesisAnswers>(buildInitialAnswers());
  const [status, setStatus] = useState<"DRAFT" | "COMPLETED">("DRAFT");
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [weightRaw, setWeightRaw] = useState("");
  const [heightRaw, setHeightRaw] = useState("");
  const [currentStep, setCurrentStep] = useState(0);

  const patchSection = (section: SectionKey, patch: Record<string, unknown>) => {
    setAnswers((current) => ({
      ...current,
      [section]: { ...((current[section] as Record<string, unknown>) ?? {}), ...patch },
    }));
  };

  const anamnesisQuery = useAuthQuery(
    queryKeys.user.anamnesis(),
    (token) => userApi.myAnamnesis(token),
  );

  const loading = anamnesisQuery.isLoading;

  useEffect(() => {
    const data = anamnesisQuery.data;
    if (!data) return;
    setStatus(data.status);
    const initialAnswers = buildInitialAnswers(data.answers);
    setAnswers(initialAnswers);
    setWeightRaw(stripUnit(initialAnswers.personalData?.weightKg ?? "", "kg"));
    setHeightRaw(stripUnit(initialAnswers.personalData?.heightM ?? "", "m"));
  }, [anamnesisQuery.data]);

  useEffect(() => {
    if (anamnesisQuery.error) {
      handleScreenError({ error: anamnesisQuery.error, showToast, fallbackMessage: "Falha ao carregar anamnese.", navigation });
    }
  }, [anamnesisQuery.error, showToast, navigation]);

  const missingCount = useMemo(() => missingRequired(answers), [answers]);

  const save = async (targetStatus: "DRAFT" | "COMPLETED") => {
    if (targetStatus === "COMPLETED" && missingCount > 0) {
      setErrorText(`Ainda faltam ${missingCount} resposta(s) obrigatória(s).`);
      showToast("Preencha os campos obrigatórios antes de confirmar.", "error");
      return;
    }
    try {
      if (targetStatus === "DRAFT") setSavingDraft(true);
      else setSavingFinal(true);
      await runWithAuth((token) => userApi.upsertMyAnamnesis(token, { status: targetStatus, answers }));
      setStatus(targetStatus);
      setErrorText(null);
      showToast(targetStatus === "COMPLETED" ? "Anamnese confirmada." : "Rascunho salvo.", "success");
    } catch (error) {
      if (__DEV__ && error instanceof Error) {
        const apiErr = error as any;
        if (apiErr.details?.errors) {
          console.error("[anamnese] Campos com erro Zod:", JSON.stringify(apiErr.details.errors, null, 2));
        }
      }
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao salvar anamnese.", navigation });
    } finally {
      setSavingDraft(false);
      setSavingFinal(false);
    }
  };

  const goNext = () => {
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const goPrev = () => {
    if (currentStep === 0) {
      navigation.goBack();
      return;
    }
    setCurrentStep((s) => s - 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        accessibilityRole="button"
        style={{
          paddingHorizontal: 14, paddingVertical: 9, borderRadius: S.chipR,
          alignItems: "center", justifyContent: "center",
          backgroundColor: selected ? theme.primarySubtle : "transparent",
          borderWidth: 1, borderColor: selected ? theme.primarySubtleBorder : theme.border,
        }}
      >
        <MvText variant="body4" style={{ color: selected ? theme.primary : theme.text2 }}>{label}</MvText>
      </TouchableOpacity>
    );
  }

  function BinaryChoice({ label, value, onChange }: { label: string; value?: boolean; onChange: (value: boolean) => void }) {
    return (
      <View style={{ gap: 7 }}>
        <MvText variant="label">{label}</MvText>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={() => onChange(true)}
            activeOpacity={0.75}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
              paddingVertical: 11, borderRadius: 12, borderWidth: 1,
              borderColor: value === true ? theme.primarySubtleBorder : theme.border,
              backgroundColor: value === true ? theme.primarySubtle : "transparent",
              gap: 6,
            }}
          >
            <Ionicons name="checkmark-circle" size={15} color={value === true ? theme.primary : theme.text3} />
            <MvText variant="body4" style={{ color: value === true ? theme.primary : theme.text2 }}>Sim</MvText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onChange(false)}
            activeOpacity={0.75}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
              paddingVertical: 11, borderRadius: 12, borderWidth: 1,
              borderColor: value === false ? "rgba(239,68,68,0.35)" : theme.border,
              backgroundColor: value === false ? "rgba(239,68,68,0.08)" : "transparent",
              gap: 6,
            }}
          >
            <Ionicons name="close-circle" size={15} color={value === false ? theme.danger : theme.text3} />
            <MvText variant="body4" style={{ color: value === false ? theme.danger : theme.text2 }}>Não</MvText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderTextFields = (section: SectionKey, fields: TextField[]) => (
    <>
      {fields.map((field) => (
        <MvInput
          key={`${section}-${field.key}`}
          keyboardType={field.keyboardType}
          autoCapitalize={field.autoCapitalize ?? (field.keyboardType === "email-address" ? "none" : "sentences")}
          placeholder={`${field.label}${field.optional ? " (opcional)" : ""}`}
          maxLength={field.maxLength}
          multiline={field.multiline}
          numberOfLines={field.multiline ? 3 : 1}
          value={String(((answers[section] as Record<string, unknown>)?.[field.key] as string) ?? "")}
          onChangeText={(value) => {
            const nextValue =
              section === "personalData" && field.key === "birthDate"
                ? formatBirthDateInput(value)
                : value;
            patchSection(section, { [field.key]: nextValue });
          }}
        />
      ))}
    </>
  );

  const renderBoolFields = (section: SectionKey, fields: BoolField[]) => (
    <>
      {fields.map((field) => (
        <View key={`${section}-${field.key}`} style={{ gap: 6 }}>
          <BinaryChoice
            label={field.label}
            value={(answers[section] as Record<string, unknown> | undefined)?.[field.key] as boolean | undefined}
            onChange={(value) => patchSection(section, { [field.key]: value })}
          />
          {field.detailsKey ? (
            <MvInput
              placeholder={field.detailsLabel ?? "Detalhes"}
              maxLength={300}
              multiline
              numberOfLines={2}
              value={String(((answers[section] as Record<string, unknown>)?.[field.detailsKey] as string) ?? "")}
              onChangeText={(value) => patchSection(section, { [field.detailsKey!]: value })}
            />
          ) : null}
        </View>
      ))}
    </>
  );

  const selectedGoals = answers.objectives?.selected ?? [];

  function renderCurrentStep() {
    switch (currentStep) {
      // ── Passo 1: Dados pessoais ──────────────────────────────────────────────
      case 0:
        return (
          <MvCard style={{ gap: 10 }}>
            <View style={{ gap: 8 }}>
              {renderTextFields("personalData", personalDataFields)}

              <View style={{ gap: 6 }}>
                <MvText variant="label" color="secondary">Gênero</MvText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {genderOptions.map((opt) => (
                    <Chip
                      key={opt.value}
                      label={opt.label}
                      selected={answers.personalData?.sex === opt.value}
                      onPress={() => patchSection("personalData", { sex: opt.value })}
                    />
                  ))}
                </View>
              </View>

              <MvInput
                placeholder="Peso (ex: 80 ou 79.4)"
                keyboardType="decimal-pad"
                maxLength={15}
                value={weightRaw}
                onChangeText={setWeightRaw}
                onBlur={() => {
                  const formatted = formatWeightDisplay(weightRaw);
                  setWeightRaw(formatted);
                  patchSection("personalData", { weightKg: formatted });
                }}
                onFocus={() => setWeightRaw(stripUnit(weightRaw, "kg"))}
              />

              <MvInput
                placeholder="Altura (ex: 175 cm ou 1.75)"
                keyboardType="decimal-pad"
                maxLength={15}
                value={heightRaw}
                onChangeText={setHeightRaw}
                onBlur={() => {
                  const formatted = formatHeightDisplay(heightRaw);
                  setHeightRaw(formatted);
                  patchSection("personalData", { heightM: formatted });
                }}
                onFocus={() => setHeightRaw(stripUnit(heightRaw, "m"))}
              />
            </View>
          </MvCard>
        );

      // ── Passo 2: Objetivos ───────────────────────────────────────────────────
      case 1:
        return (
          <MvCard style={{ gap: 12 }}>
            <View style={{ gap: 6 }}>
              <MvText variant="label" color="secondary">Selecione seus objetivos (pode escolher mais de um)</MvText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {goals.map((goal) => (
                  <Chip
                    key={goal.value}
                    label={goal.label}
                    selected={selectedGoals.includes(goal.value)}
                    onPress={() => {
                      const next = selectedGoals.includes(goal.value)
                        ? selectedGoals.filter((item) => item !== goal.value)
                        : [...selectedGoals, goal.value];
                      patchSection("objectives", { selected: next });
                    }}
                  />
                ))}
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {renderTextFields("objectives", objectiveFields)}
            </View>
          </MvCard>
        );

      // ── Passo 3: Histórico de saúde ──────────────────────────────────────────
      case 2:
        return (
          <View style={{ gap: 12 }}>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="heart-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Condições de saúde</MvText>
              </View>
              <View style={{ gap: 10 }}>
                {renderBoolFields("healthHistory", healthFields)}
              </View>
            </MvCard>

            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="medical-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Medicamentos e suplementos</MvText>
              </View>
              <View style={{ gap: 10 }}>
                {renderBoolFields("medicationAndSupplements", medicationFields)}
              </View>
            </MvCard>

            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="people-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">
                  Histórico familiar{" "}
                  <MvText variant="body4" style={{ color: theme.text3 }}>(opcional)</MvText>
                </MvText>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {familyHistoryItems.map((item) => (
                  <Chip
                    key={item.key}
                    label={item.label}
                    selected={Boolean((answers.familyHistory as Record<string, unknown>)?.[item.key])}
                    onPress={() => patchSection("familyHistory", { [item.key]: !(answers.familyHistory as Record<string, unknown>)?.[item.key] })}
                  />
                ))}
              </View>
              <MvInput
                placeholder="Outro"
                maxLength={300}
                multiline
                numberOfLines={2}
                value={answers.familyHistory?.other ?? ""}
                onChangeText={(value) => patchSection("familyHistory", { other: value })}
              />
            </MvCard>
          </View>
        );

      // ── Passo 4: Atividade física ────────────────────────────────────────────
      case 3:
        return (
          <MvCard style={{ gap: 10 }}>
            <View style={{ gap: 10 }}>
              {renderBoolFields("activityHistory", activityFields)}
              {renderTextFields("activityHistory", activityTextFields)}
            </View>
          </MvCard>
        );

      // ── Passo 5: Estilo de vida & Alimentação ────────────────────────────────
      case 4:
        return (
          <View style={{ gap: 12 }}>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="sunny-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Estilo de vida</MvText>
              </View>
              <View style={{ gap: 10 }}>
                <MvInput
                  placeholder="Horas de sono por noite"
                  maxLength={10}
                  value={answers.lifestyle?.sleepHours ?? ""}
                  onChangeText={(value) => patchSection("lifestyle", { sleepHours: value })}
                />
                {Object.entries(lifestyleOptions).map(([key, options]) => (
                  <View key={key} style={{ gap: 6 }}>
                    <MvText variant="label">{lifestyleKeyLabel[key] ?? key}</MvText>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {options.map((opt) => (
                        <Chip
                          key={opt.value}
                          label={opt.label}
                          selected={(answers.lifestyle as Record<string, unknown>)?.[key] === opt.value}
                          onPress={() => patchSection("lifestyle", { [key]: opt.value })}
                        />
                      ))}
                    </View>
                  </View>
                ))}
                <BinaryChoice
                  label="Fuma?"
                  value={answers.lifestyle?.smokes}
                  onChange={(value) => patchSection("lifestyle", { smokes: value })}
                />
              </View>
            </MvCard>

            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="restaurant-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Hábitos alimentares</MvText>
              </View>
              <View style={{ gap: 10 }}>
                {renderBoolFields("nutrition", nutritionFields)}
                {renderTextFields("nutrition", nutritionTextFields)}
              </View>
            </MvCard>
          </View>
        );

      // ── Passo 6: Limitações & Comportamento ─────────────────────────────────
      case 5:
        return (
          <View style={{ gap: 12 }}>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(239,68,68,0.10)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="warning-outline" size={14} color={theme.danger} />
                </View>
                <MvText variant="semi2">Limitações e restrições</MvText>
              </View>
              <View style={{ gap: 8 }}>
                {renderTextFields("limitations", [
                  { key: "physicalLimitations", label: "Possui alguma limitação física?", maxLength: 300, multiline: true },
                  { key: "restrictedExercises", label: "Algum exercício que não pode realizar?", maxLength: 300, multiline: true },
                ])}
              </View>
            </MvCard>

            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="bulb-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Aspectos comportamentais</MvText>
              </View>
              <View style={{ gap: 8 }}>
                {renderTextFields("behavior", [
                  { key: "trainingMotivation", label: "O que te motiva a treinar?", maxLength: 300, multiline: true },
                  { key: "biggestConsistencyDifficulty", label: "Maior dificuldade para manter constância", maxLength: 300, multiline: true },
                  { key: "quitBeforeReason", label: "Já desistiu de treinos antes? Por quê?", maxLength: 300, multiline: true },
                ])}
              </View>
            </MvCard>
          </View>
        );

      // ── Passo 7: Finalização ─────────────────────────────────────────────────
      case 6:
        return (
          <View style={{ gap: 12 }}>
            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="camera-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Autorização de imagem</MvText>
              </View>
              <BinaryChoice
                label="Autoriza uso da sua imagem para fins profissionais e divulgação?"
                value={answers.imageAuthorization?.allowImageUse}
                onChange={(value) => patchSection("imageAuthorization", { allowImageUse: value })}
              />
            </MvCard>

            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(239,68,68,0.10)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="shield-checkmark-outline" size={14} color={theme.danger} />
                </View>
                <MvText variant="semi2">
                  Triagem de prontidão{" "}
                  <MvText variant="body4" style={{ color: theme.text3 }}>(PAR-Q)</MvText>
                </MvText>
              </View>
              <View style={{ gap: 10 }}>
                {renderBoolFields("parq", [
                  { key: "hasHeartCondition", label: "Médico já disse que você tem problema cardíaco?" },
                  { key: "chestPainDuringExercise", label: "Dor no peito durante exercício?" },
                  { key: "chestPainAtRestLastMonth", label: "Dor no peito em repouso no último mês?" },
                  { key: "dizzinessOrFainting", label: "Tontura ou perda de consciência?" },
                  { key: "jointProblemsWithExercise", label: "Problemas articulares pioram com exercício?" },
                  { key: "usesCardiacMedication", label: "Uso de medicação cardíaca/pressão?" },
                  { key: "hasOtherExerciseRestriction", label: "Outro impedimento para exercício?" },
                ])}
              </View>
            </MvCard>

            <MvCard style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="document-text-outline" size={14} color={theme.primary} />
                </View>
                <MvText variant="semi2">Termo de responsabilidade</MvText>
              </View>
              <BinaryChoice
                label="Declaro que as informações são verdadeiras e informarei alterações de saúde."
                value={answers.responsibilityTermAccepted}
                onChange={(value) => setAnswers((current) => ({ ...current, responsibilityTermAccepted: value }))}
              />
              <MvText variant="body4" style={{ fontSize: 12, color: theme.danger, marginTop: 4 }}>
                O botão confirmar valida termo + campos obrigatórios de todas as etapas.
              </MvText>
            </MvCard>
          </View>
        );

      default:
        return null;
    }
  }

  const progressPct = Math.round(((TOTAL_REQUIRED - missingCount) / TOTAL_REQUIRED) * 100);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 14,
        paddingHorizontal: S.px,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TouchableOpacity
            onPress={goPrev}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={currentStep === 0 ? "Voltar" : "Etapa anterior"}
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: theme.inputBg,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text1} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <MvText variant="eyebrow" style={{ color: theme.primary }}>
              Passo {currentStep + 1} de {TOTAL_STEPS}
            </MvText>
            <MvText variant="h1">{STEPS[currentStep].title}</MvText>
          </View>

          <View style={{
            backgroundColor: status === "COMPLETED" ? theme.primarySubtle : C.amberDim,
            borderWidth: 1,
            borderColor: status === "COMPLETED" ? theme.primarySubtleBorder : C.amberBorder,
            borderRadius: S.chipR,
            paddingHorizontal: 10,
            paddingVertical: 3,
          }}>
            <MvText variant="caption" style={{ color: status === "COMPLETED" ? theme.primary : C.amber }}>
              {status === "COMPLETED" ? "Concluída" : "Rascunho"}
            </MvText>
          </View>
        </View>

        {/* Segmentos de progresso por etapa */}
        <View style={{ flexDirection: "row", gap: 4, marginTop: 12 }}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={{
                flex: 1, height: 3, borderRadius: 99,
                backgroundColor: i <= currentStep ? theme.primary : (theme.mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"),
              }}
            />
          ))}
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 7 }}>
          <MvText variant="body4" color="secondary">{STEPS[currentStep].subtitle}</MvText>
          {!loading && (
            <MvText variant="caption" style={{ color: missingCount === 0 ? theme.primary : theme.text3 }}>
              {progressPct}% completo
            </MvText>
          )}
        </View>
      </View>

      <ScreenEntrance>
        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <MvText variant="body4" color="secondary">Carregando...</MvText>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 12, paddingTop: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {errorText ? (
              <MvText variant="body4" style={{ color: theme.danger }}>{errorText}</MvText>
            ) : null}

            {renderCurrentStep()}

            {/* Navegação */}
            <View style={{ gap: 8, paddingTop: 4 }}>
              {currentStep < TOTAL_STEPS - 1 ? (
                <MvButton
                  label="Próximo"
                  disabled={savingDraft || savingFinal}
                  onPress={goNext}
                />
              ) : (
                <MvButton
                  label="Confirmar anamnese"
                  loading={savingFinal}
                  disabled={savingDraft || savingFinal}
                  onPress={() => void save("COMPLETED")}
                />
              )}
              <MvButton
                variant="outline"
                label="Salvar rascunho"
                loading={savingDraft}
                disabled={savingDraft || savingFinal}
                onPress={() => void save("DRAFT")}
              />
            </View>

            {currentStep === TOTAL_STEPS - 1 && missingCount > 0 ? (
              <MvText variant="body4" color="tertiary" style={{ textAlign: "center" }}>
                {missingCount} {missingCount === 1 ? "campo obrigatório faltando" : "campos obrigatórios faltando"}
              </MvText>
            ) : null}
          </ScrollView>
        )}
      </ScreenEntrance>
    </View>
  );
}
