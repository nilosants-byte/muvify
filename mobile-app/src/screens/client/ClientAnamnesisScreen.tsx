import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { AnamnesisAnswers, userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { handleScreenError } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientAnamnesis">;

type TextField = {
  key: string;
  label: string;
  maxLength: number;
  keyboardType?: "default" | "email-address" | "number-pad" | "phone-pad";
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

// sex, weightKg e heightM são renderizados de forma especial (chips / formatação automática)
const personalDataFields: TextField[] = [
  { key: "fullName", label: "Nome completo", maxLength: 100 },
  { key: "birthDate", label: "Data de nascimento (ex: 15/08/1990)", maxLength: 10, keyboardType: "number-pad" },
  { key: "age", label: "Idade", maxLength: 5, keyboardType: "number-pad" },
  { key: "phone", label: "Telefone/WhatsApp", maxLength: 30, keyboardType: "phone-pad" },
  { key: "email", label: "E-mail", maxLength: 120, keyboardType: "email-address" },
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

// Remove null values from a section object so Zod enum/boolean schemas don't reject them.
// Null can appear when the JSON column in DB was partially written with explicit nulls.
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

export function ClientAnamnesisScreen({ navigation }: Props) {
  const { runWithAuth, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [answers, setAnswers] = useState<AnamnesisAnswers>(buildInitialAnswers());
  const [status, setStatus] = useState<"DRAFT" | "COMPLETED">("DRAFT");
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingFinal, setSavingFinal] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Campos especiais: exibição separada para edição fluente
  const [weightRaw, setWeightRaw] = useState("");
  const [heightRaw, setHeightRaw] = useState("");

  const patchSection = (section: SectionKey, patch: Record<string, unknown>) => {
    setAnswers((current) => ({
      ...current,
      [section]: { ...((current[section] as Record<string, unknown>) ?? {}), ...patch },
    }));
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await runWithAuth((token) => userApi.myAnamnesis(token));
      setStatus(payload.status);
      setAnswers(buildInitialAnswers(payload.answers));
    } catch (error) {
      handleScreenError({ error, showToast, fallbackMessage: "Falha ao carregar anamnese.", navigation });
    } finally {
      setLoading(false);
    }
  }, [navigation, runWithAuth, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Sincroniza os inputs de peso/altura quando os dados carregam
  useEffect(() => {
    if (loading) return;
    setWeightRaw(stripUnit(answers.personalData?.weightKg ?? "", "kg"));
    setHeightRaw(stripUnit(answers.personalData?.heightM ?? "", "m"));
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Em dev: log detalhado dos erros Zod para diagnóstico
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

  function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={{
          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
          backgroundColor: selected ? "rgba(76,175,80,0.12)" : theme.chipBg,
          borderWidth: 1, borderColor: selected ? "rgba(76,175,80,0.30)" : theme.border,
        }}
      >
        <MvText variant="body4" style={{ color: selected ? theme.textGreen : theme.chipText }}>{label}</MvText>
      </TouchableOpacity>
    );
  }

  function BinaryChoice({ label, value, onChange }: { label: string; value?: boolean; onChange: (value: boolean) => void }) {
    return (
      <View style={{ gap: 6 }}>
        <MvText variant="semi3">{label}</MvText>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Chip label="Sim" selected={value === true} onPress={() => onChange(true)} />
          <Chip label="Não" selected={value === false} onPress={() => onChange(false)} />
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4" style={{ flex: 1 }}>Anamnese</MvText>
        <MvBadge label={status === "COMPLETED" ? "Concluída" : "Rascunho"} variant={status === "COMPLETED" ? "green" : "orange"} />
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="body4" color="secondary">
          Preencha seu questionário. O personal poderá apenas visualizar no perfil do aluno.
        </MvText>

        {loading ? <MvText variant="body4" color="secondary">Carregando...</MvText> : null}

        {errorText ? (
          <MvText variant="body4" color="danger">{errorText}</MvText>
        ) : null}

        {/* Dados pessoais */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Dados pessoais</MvText>
          <View style={{ gap: 8 }}>
            {renderTextFields("personalData", personalDataFields)}

            {/* Gênero — chips */}
            <View style={{ gap: 6 }}>
              <MvText variant="semi3">Gênero</MvText>
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

            {/* Peso — formatação automática ao sair do campo */}
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

            {/* Altura — formatação automática ao sair do campo */}
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

        {/* Objetivos */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Objetivos</MvText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
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
          <View style={{ gap: 8 }}>
            {renderTextFields("objectives", objectiveFields)}
          </View>
        </MvCard>

        {/* Histórico de saúde */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Histórico de saúde</MvText>
          <View style={{ gap: 10 }}>
            {renderBoolFields("healthHistory", healthFields)}
          </View>
        </MvCard>

        {/* Medicamentos e suplementos */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Medicamentos e suplementos</MvText>
          <View style={{ gap: 10 }}>
            {renderBoolFields("medicationAndSupplements", medicationFields)}
          </View>
        </MvCard>

        {/* Histórico familiar */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Histórico familiar (opcional)</MvText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {[
              { key: "hasCardiacDisease", label: "Doença cardíaca" },
              { key: "hasHypertension", label: "Hipertensão" },
              { key: "hasDiabetes", label: "Diabetes" },
              { key: "hasObesity", label: "Obesidade" },
              { key: "hasOrthopedicProblems", label: "Problemas ortopédicos" },
            ].map((item) => (
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

        {/* Histórico de atividade física */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Histórico de atividade física</MvText>
          <View style={{ gap: 10 }}>
            {renderBoolFields("activityHistory", activityFields)}
            {renderTextFields("activityHistory", activityTextFields)}
          </View>
        </MvCard>

        {/* Estilo de vida */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Estilo de vida</MvText>
          <View style={{ gap: 10 }}>
            <MvInput
              placeholder="Horas de sono por noite"
              maxLength={10}
              value={answers.lifestyle?.sleepHours ?? ""}
              onChangeText={(value) => patchSection("lifestyle", { sleepHours: value })}
            />
            {Object.entries(lifestyleOptions).map(([key, options]) => (
              <View key={key} style={{ gap: 6 }}>
                <MvText variant="semi3">{lifestyleKeyLabel[key] ?? key}</MvText>
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

        {/* Hábitos alimentares */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Hábitos alimentares</MvText>
          <View style={{ gap: 10 }}>
            {renderBoolFields("nutrition", nutritionFields)}
            {renderTextFields("nutrition", nutritionTextFields)}
          </View>
        </MvCard>

        {/* Limitações e restrições */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Limitações e restrições</MvText>
          <View style={{ gap: 8 }}>
            {renderTextFields("limitations", [
              { key: "physicalLimitations", label: "Possui alguma limitação física?", maxLength: 300, multiline: true },
              { key: "restrictedExercises", label: "Algum exercício que não pode realizar?", maxLength: 300, multiline: true },
            ])}
          </View>
        </MvCard>

        {/* Aspectos comportamentais */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Aspectos comportamentais</MvText>
          <View style={{ gap: 8 }}>
            {renderTextFields("behavior", [
              { key: "trainingMotivation", label: "O que te motiva a treinar?", maxLength: 300, multiline: true },
              { key: "biggestConsistencyDifficulty", label: "Maior dificuldade para manter constância", maxLength: 300, multiline: true },
              { key: "quitBeforeReason", label: "Já desistiu de treinos antes? Por quê?", maxLength: 300, multiline: true },
            ])}
          </View>
        </MvCard>

        {/* Autorização de imagem */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Autorização de imagem</MvText>
          <BinaryChoice
            label="Autoriza uso da sua imagem para fins profissionais e divulgação?"
            value={answers.imageAuthorization?.allowImageUse}
            onChange={(value) => patchSection("imageAuthorization", { allowImageUse: value })}
          />
        </MvCard>

        {/* PAR-Q */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Triagem de prontidão (PAR-Q)</MvText>
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

        {/* Termo de responsabilidade */}
        <MvCard>
          <MvText variant="semi2" style={{ marginBottom: 10 }}>Termo de responsabilidade</MvText>
          <BinaryChoice
            label="Declaro que as informações são verdadeiras e informarei alterações de saúde."
            value={answers.responsibilityTermAccepted}
            onChange={(value) => setAnswers((current) => ({ ...current, responsibilityTermAccepted: value }))}
          />
          <MvText variant="body4" color="danger" style={{ marginTop: 6 }}>
            O botão de confirmar valida termo + perguntas obrigatórias.
          </MvText>
        </MvCard>

        {/* Acoes */}
        <View style={{ gap: 10 }}>
          <MvButton variant="outline" label="Salvar rascunho" loading={savingDraft} onPress={() => void save("DRAFT")} />
          <MvButton label="Confirmar anamnese" loading={savingFinal} onPress={() => void save("COMPLETED")} />
        </View>

        {!loading && missingCount > 0 ? (
          <MvText variant="body4" color="secondary" style={{ textAlign: "center" }}>
            Pendências obrigatórias: {missingCount}
          </MvText>
        ) : null}
      </ScrollView>
    </View>
  );
}
