import { NotificationPreferenceType } from "@prisma/client";
import { z } from "zod";
import { isCommonPassword } from "../../../shared/utils/password-strength";

const notCommonPassword = (value: string) => !isCommonPassword(value);
const COMMON_PASSWORD_MESSAGE = "Essa senha é muito comum. Escolha uma senha mais difícil de adivinhar.";

const optionalTrimmedString = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-ZÀ-ÿ\s'\-\.]+$/, "Nome contém caracteres inválidos.")
  .optional();

const photoUrlSchema = z
  .union([
    z.literal(""), // empty string = remove photo
    z.string().trim().url(),
  ])
  .optional();

export const updateMeSchema = z.object({
  body: z
    .object({
      name: optionalTrimmedString,
      apelido: z
        .string()
        .trim()
        .min(3)
        .max(30)
        .regex(/^[a-z0-9_]+$/, "Apelido deve conter apenas letras minúsculas, números e _.")
        .optional(),
      phone: z
        .string()
        .trim()
        .regex(
          /^(?=(?:\D*\d){8,15}\D*$)[\d\s()+-]+$/,
          "Telefone deve conter entre 8 e 15 digitos."
        )
        .optional(),
      photoUrl: photoUrlSchema,
    })
    .refine((value) => value.name || value.apelido || value.phone || value.photoUrl !== undefined, {
      message: "Informe ao menos um campo para atualizar.",
      path: ["name"]
    })
});

export const changeMyPasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(8).max(72),
      newPassword: z
        .string()
        .min(8)
        .max(72)
        .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, "Senha deve conter letras e números.")
        .refine(notCommonPassword, COMMON_PASSWORD_MESSAGE),
      confirmNewPassword: z.string().min(8).max(72)
    })
    .refine((value) => value.newPassword === value.confirmNewPassword, {
      message: "A confirmação da nova senha não confere.",
      path: ["confirmNewPassword"]
    })
});

export const upsertRecoveryEmailSchema = z.object({
  body: z.object({
    recoveryEmail: z.string().trim().email().max(120),
    password: z.string().min(1).max(72, "Senha atual obrigatória para confirmar a troca de e-mail de recuperação.")
  })
});

export const deleteMeSchema = z.object({
  body: z.object({
    password: z.string().min(1).max(72, "Senha obrigatória para confirmar exclusão da conta.")
  })
});

export const userPhotoParamsSchema = z.object({
  params: z.object({
    userId: z.string().uuid()
  }),
  query: z.object({
    exp: z.coerce.number().int().positive(),
    sig: z.string().trim().regex(/^[a-fA-F0-9]{64}$/)
  })
});

export const sendSupportMessageSchema = z.object({
  body: z.object({
    subject: z.string().trim().min(3).max(120).optional(),
    message: z.string().trim().min(10).max(4000)
  })
});

const maxText = (size: number) => z.string().trim().max(size);

const choiceGoalSchema = z.enum([
  "EMAGRECIMENTO",
  "HIPERTROFIA",
  "CONDICIONAMENTO_FISICO",
  "REABILITACAO",
  "PERFORMANCE_ESPORTIVA",
  "SAUDE_GERAL"
]);

const qualitySchema = z.enum(["BOA", "REGULAR", "RUIM"]);
const stressSchema = z.enum(["BAIXO", "MODERADO", "ALTO"]);
const alcoholSchema = z.enum(["NAO", "SOCIAL", "FREQUENTE"]);
const workRoutineSchema = z.enum(["SEDENTARIA", "MODERADAMENTE_ATIVA", "MUITO_ATIVA"]);

const personalDataSchema = z
  .object({
    fullName: maxText(100),
    birthDate: maxText(20),
    age: maxText(5),
    sex: maxText(20),
    weightKg: maxText(10),
    heightM: maxText(10),
    phone: maxText(30),
    email: maxText(120),
    fullAddress: maxText(200),
    emergencyContact: maxText(100)
  })
  .partial();

// Frente 8 (segunda camada), Lote 12: objetivos de treino (selected/
// mainObjective/targetTimeframe) são coletados como obrigatórios na
// anamnese, mas nenhum fluxo de busca ou recomendação de profissional
// (SearchProfessionalsScreen, discovery.service.ts) hoje filtra ou ordena
// por eles - o cliente preenche, mas isso não influencia quem aparece pra
// ele. Gap aceito por ora (o dado já é útil pro profissional lá na frente,
// via getStudentAnamnesis); vincular à busca é melhoria de produto futura,
// fora do escopo desta frente.
const objectivesSchema = z
  .object({
    selected: z.array(choiceGoalSchema).max(6),
    other: maxText(300).optional(),
    mainObjective: maxText(300),
    targetTimeframe: maxText(300)
  })
  .partial();

const healthHistorySchema = z
  .object({
    hasDiagnosedDisease: z.boolean(),
    diagnosedDiseaseDetails: maxText(300).optional(),
    hadSurgery: z.boolean(),
    surgeryDetails: maxText(300).optional(),
    hasInjuries: z.boolean(),
    injuriesDetails: maxText(300).optional(),
    hasCurrentPain: z.boolean(),
    currentPainDetails: maxText(300).optional(),
    hasCardiacProblems: z.boolean(),
    hasHypertension: z.boolean(),
    hasDiabetes: z.boolean(),
    hasRespiratoryProblems: z.boolean()
  })
  .partial();

const medicationSchema = z
  .object({
    usesMedication: z.boolean(),
    medicationDetails: maxText(300).optional(),
    usesSupplements: z.boolean(),
    supplementsDetails: maxText(300).optional(),
    usedHormones: z.boolean(),
    hormonesDetails: maxText(300).optional()
  })
  .partial();

const familyHistorySchema = z
  .object({
    hasCardiacDisease: z.boolean().optional(),
    hasHypertension: z.boolean().optional(),
    hasDiabetes: z.boolean().optional(),
    hasObesity: z.boolean().optional(),
    hasOrthopedicProblems: z.boolean().optional(),
    other: maxText(300).optional()
  })
  .optional();

const activityHistorySchema = z
  .object({
    hasTrainedBefore: z.boolean(),
    trainingDuration: maxText(30),
    weeklyFrequency: maxText(30),
    hadProfessionalSupport: z.boolean(),
    practicedModalities: maxText(300),
    stopReason: maxText(300).optional()
  })
  .partial();

const lifestyleSchema = z
  .object({
    sleepHours: maxText(10),
    sleepQuality: qualitySchema,
    stressLevel: stressSchema,
    alcoholConsumption: alcoholSchema,
    smokes: z.boolean(),
    workRoutine: workRoutineSchema
  })
  .partial();

const nutritionSchema = z
  .object({
    mealsPerDay: maxText(30),
    followsDiet: z.boolean(),
    dietDetails: maxText(300).optional(),
    waterIntake: maxText(30),
    hasBingeEating: z.boolean(),
    avoidedFoods: maxText(300)
  })
  .partial();

const limitationsSchema = z
  .object({
    physicalLimitations: maxText(300),
    restrictedExercises: maxText(300)
  })
  .partial();

const behaviorSchema = z
  .object({
    trainingMotivation: maxText(300),
    biggestConsistencyDifficulty: maxText(300),
    quitBeforeReason: maxText(300)
  })
  .partial();

const imageAuthorizationSchema = z
  .object({
    allowImageUse: z.boolean()
  })
  .partial();

const parqSchema = z
  .object({
    hasHeartCondition: z.boolean(),
    chestPainDuringExercise: z.boolean(),
    chestPainAtRestLastMonth: z.boolean(),
    dizzinessOrFainting: z.boolean(),
    jointProblemsWithExercise: z.boolean(),
    usesCardiacMedication: z.boolean(),
    hasOtherExerciseRestriction: z.boolean()
  })
  .partial();

const anamnesisAnswersSchema = z
  .object({
    personalData: personalDataSchema.optional(),
    objectives: objectivesSchema.optional(),
    healthHistory: healthHistorySchema.optional(),
    medicationAndSupplements: medicationSchema.optional(),
    familyHistory: familyHistorySchema,
    activityHistory: activityHistorySchema.optional(),
    lifestyle: lifestyleSchema.optional(),
    nutrition: nutritionSchema.optional(),
    limitations: limitationsSchema.optional(),
    behavior: behaviorSchema.optional(),
    imageAuthorization: imageAuthorizationSchema.optional(),
    parq: parqSchema.optional(),
    responsibilityTermAccepted: z.boolean().optional()
  })
  .partial();

function isFilled(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value !== "undefined" && value !== null;
}

function isBoolean(value: unknown) {
  return typeof value === "boolean";
}

function validateCompletedAnamnesis(answers: z.infer<typeof anamnesisAnswersSchema>) {
  const requiredChecks: Array<{ valid: boolean; path: string[]; message: string }> = [
    { valid: isFilled(answers.personalData?.fullName), path: ["answers", "personalData", "fullName"], message: "Nome completo é obrigatório." },
    { valid: isFilled(answers.personalData?.birthDate), path: ["answers", "personalData", "birthDate"], message: "Data de nascimento é obrigatória." },
    { valid: isFilled(answers.personalData?.age), path: ["answers", "personalData", "age"], message: "Idade é obrigatória." },
    { valid: isFilled(answers.personalData?.sex), path: ["answers", "personalData", "sex"], message: "Sexo é obrigatório." },
    { valid: isFilled(answers.personalData?.weightKg), path: ["answers", "personalData", "weightKg"], message: "Peso é obrigatório." },
    { valid: isFilled(answers.personalData?.heightM), path: ["answers", "personalData", "heightM"], message: "Altura é obrigatória." },
    { valid: isFilled(answers.personalData?.phone), path: ["answers", "personalData", "phone"], message: "Telefone é obrigatório." },
    { valid: isFilled(answers.personalData?.email), path: ["answers", "personalData", "email"], message: "E-mail é obrigatório." },
    { valid: isFilled(answers.personalData?.fullAddress), path: ["answers", "personalData", "fullAddress"], message: "Endereço completo é obrigatório." },
    { valid: isFilled(answers.personalData?.emergencyContact), path: ["answers", "personalData", "emergencyContact"], message: "Contato de emergência é obrigatório." },
    {
      valid:
        (Array.isArray(answers.objectives?.selected) &&
          answers.objectives?.selected.length > 0) ||
        isFilled(answers.objectives?.other),
      path: ["answers", "objectives", "selected"],
      message: "Selecione ao menos um objetivo."
    },
    { valid: isFilled(answers.objectives?.mainObjective), path: ["answers", "objectives", "mainObjective"], message: "Objetivo principal é obrigatório." },
    { valid: isFilled(answers.objectives?.targetTimeframe), path: ["answers", "objectives", "targetTimeframe"], message: "Prazo para objetivo é obrigatório." },

    { valid: isBoolean(answers.healthHistory?.hasDiagnosedDisease), path: ["answers", "healthHistory", "hasDiagnosedDisease"], message: "Informe doença diagnosticada." },
    { valid: isBoolean(answers.healthHistory?.hadSurgery), path: ["answers", "healthHistory", "hadSurgery"], message: "Informe cirurgias anteriores." },
    { valid: isBoolean(answers.healthHistory?.hasInjuries), path: ["answers", "healthHistory", "hasInjuries"], message: "Informe lesões." },
    { valid: isBoolean(answers.healthHistory?.hasCurrentPain), path: ["answers", "healthHistory", "hasCurrentPain"], message: "Informe dores atuais." },
    { valid: isBoolean(answers.healthHistory?.hasCardiacProblems), path: ["answers", "healthHistory", "hasCardiacProblems"], message: "Informe problemas cardíacos." },
    { valid: isBoolean(answers.healthHistory?.hasHypertension), path: ["answers", "healthHistory", "hasHypertension"], message: "Informe hipertensão." },
    { valid: isBoolean(answers.healthHistory?.hasDiabetes), path: ["answers", "healthHistory", "hasDiabetes"], message: "Informe diabetes." },
    { valid: isBoolean(answers.healthHistory?.hasRespiratoryProblems), path: ["answers", "healthHistory", "hasRespiratoryProblems"], message: "Informe problemas respiratórios." },

    { valid: isBoolean(answers.medicationAndSupplements?.usesMedication), path: ["answers", "medicationAndSupplements", "usesMedication"], message: "Informe uso de medicamentos." },
    { valid: isBoolean(answers.medicationAndSupplements?.usesSupplements), path: ["answers", "medicationAndSupplements", "usesSupplements"], message: "Informe uso de suplementos." },
    { valid: isBoolean(answers.medicationAndSupplements?.usedHormones), path: ["answers", "medicationAndSupplements", "usedHormones"], message: "Informe uso de hormônios." },

    { valid: isBoolean(answers.activityHistory?.hasTrainedBefore), path: ["answers", "activityHistory", "hasTrainedBefore"], message: "Informe histórico de treino." },
    { valid: isFilled(answers.activityHistory?.trainingDuration), path: ["answers", "activityHistory", "trainingDuration"], message: "Tempo de treino é obrigatório." },
    { valid: isFilled(answers.activityHistory?.weeklyFrequency), path: ["answers", "activityHistory", "weeklyFrequency"], message: "Frequência semanal é obrigatória." },
    { valid: isBoolean(answers.activityHistory?.hadProfessionalSupport), path: ["answers", "activityHistory", "hadProfessionalSupport"], message: "Informe acompanhamento profissional." },
    { valid: isFilled(answers.activityHistory?.practicedModalities), path: ["answers", "activityHistory", "practicedModalities"], message: "Modalidades praticadas são obrigatórias." },

    { valid: isFilled(answers.lifestyle?.sleepHours), path: ["answers", "lifestyle", "sleepHours"], message: "Horas de sono são obrigatórias." },
    { valid: isFilled(answers.lifestyle?.sleepQuality), path: ["answers", "lifestyle", "sleepQuality"], message: "Qualidade do sono é obrigatória." },
    { valid: isFilled(answers.lifestyle?.stressLevel), path: ["answers", "lifestyle", "stressLevel"], message: "Nível de estresse é obrigatório." },
    { valid: isFilled(answers.lifestyle?.alcoholConsumption), path: ["answers", "lifestyle", "alcoholConsumption"], message: "Consumo de álcool é obrigatório." },
    { valid: isBoolean(answers.lifestyle?.smokes), path: ["answers", "lifestyle", "smokes"], message: "Informe tabagismo." },
    { valid: isFilled(answers.lifestyle?.workRoutine), path: ["answers", "lifestyle", "workRoutine"], message: "Rotina de trabalho é obrigatória." },

    { valid: isFilled(answers.nutrition?.mealsPerDay), path: ["answers", "nutrition", "mealsPerDay"], message: "Refeições por dia é obrigatório." },
    { valid: isBoolean(answers.nutrition?.followsDiet), path: ["answers", "nutrition", "followsDiet"], message: "Informe se segue dieta." },
    { valid: isFilled(answers.nutrition?.waterIntake), path: ["answers", "nutrition", "waterIntake"], message: "Consumo de água é obrigatório." },
    { valid: isBoolean(answers.nutrition?.hasBingeEating), path: ["answers", "nutrition", "hasBingeEating"], message: "Informe compulsão alimentar." },
    { valid: isFilled(answers.nutrition?.avoidedFoods), path: ["answers", "nutrition", "avoidedFoods"], message: "Alimentos evitados são obrigatórios." },

    { valid: isFilled(answers.limitations?.physicalLimitations), path: ["answers", "limitations", "physicalLimitations"], message: "Limitações físicas são obrigatórias." },
    { valid: isFilled(answers.limitations?.restrictedExercises), path: ["answers", "limitations", "restrictedExercises"], message: "Restrições de exercícios são obrigatórias." },

    { valid: isFilled(answers.behavior?.trainingMotivation), path: ["answers", "behavior", "trainingMotivation"], message: "Motivação para treino é obrigatória." },
    { valid: isFilled(answers.behavior?.biggestConsistencyDifficulty), path: ["answers", "behavior", "biggestConsistencyDifficulty"], message: "Maior dificuldade de constância é obrigatória." },
    { valid: isFilled(answers.behavior?.quitBeforeReason), path: ["answers", "behavior", "quitBeforeReason"], message: "Histórico de desistências é obrigatório." },

    { valid: isBoolean(answers.imageAuthorization?.allowImageUse), path: ["answers", "imageAuthorization", "allowImageUse"], message: "Autorização de imagem é obrigatória." },

    { valid: isBoolean(answers.parq?.hasHeartCondition), path: ["answers", "parq", "hasHeartCondition"], message: "PAR-Q: problema cardíaco é obrigatório." },
    { valid: isBoolean(answers.parq?.chestPainDuringExercise), path: ["answers", "parq", "chestPainDuringExercise"], message: "PAR-Q: dor no peito durante exercício é obrigatório." },
    { valid: isBoolean(answers.parq?.chestPainAtRestLastMonth), path: ["answers", "parq", "chestPainAtRestLastMonth"], message: "PAR-Q: dor no peito em repouso é obrigatório." },
    { valid: isBoolean(answers.parq?.dizzinessOrFainting), path: ["answers", "parq", "dizzinessOrFainting"], message: "PAR-Q: tontura/perda de consciência é obrigatório." },
    { valid: isBoolean(answers.parq?.jointProblemsWithExercise), path: ["answers", "parq", "jointProblemsWithExercise"], message: "PAR-Q: problema articular é obrigatório." },
    { valid: isBoolean(answers.parq?.usesCardiacMedication), path: ["answers", "parq", "usesCardiacMedication"], message: "PAR-Q: medicação cardíaca é obrigatório." },
    { valid: isBoolean(answers.parq?.hasOtherExerciseRestriction), path: ["answers", "parq", "hasOtherExerciseRestriction"], message: "PAR-Q: impedimento adicional é obrigatório." },

    { valid: answers.responsibilityTermAccepted === true, path: ["answers", "responsibilityTermAccepted"], message: "Aceite o termo de responsabilidade para concluir." }
  ];

  return requiredChecks.filter((item) => !item.valid);
}

export const recordConsentSchema = z.object({
  body: z.object({
    termsVersion: z.string().trim().min(1).max(20),
    acceptedAt: z.string().datetime().optional()
  })
});

export const upsertNotificationPreferencesSchema = z.object({
  body: z.object({
    preferences: z
      .array(
        z.object({
          type: z.nativeEnum(NotificationPreferenceType),
          enabled: z.boolean()
        })
      )
      .min(1)
      .max(Object.keys(NotificationPreferenceType).length)
  })
});

export const upsertMyAnamnesisSchema = z.object({
  body: z
    .object({
      status: z.enum(["DRAFT", "COMPLETED"]).optional(),
      // z.any() para DRAFT — sem validação de tipos; para COMPLETED o superRefine valida via anamnesisAnswersSchema
      answers: z.any().optional()
    })
    .superRefine((value, ctx) => {
      if (value.status !== "COMPLETED") {
        return; // Rascunho aceita qualquer estrutura parcial
      }

      if (!value.answers) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answers"],
          message: "Preencha as respostas da anamnese."
        });
        return;
      }

      // Valida tipos apenas quando COMPLETED
      const parsed = anamnesisAnswersSchema.safeParse(value.answers);
      if (!parsed.success) {
        parsed.error.issues.forEach((issue) => {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["answers", ...issue.path.map(String)],
            message: issue.message
          });
        });
        return;
      }

      const missingItems = validateCompletedAnamnesis(parsed.data);
      missingItems.forEach((item) => {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: item.path,
          message: item.message
        });
      });
    })
});

// Bloco 3 (trocar/adicionar serviço do mesmo profissional).
export const switchOrAddOfferSchema = z.object({
  body: z.object({
    newOfferId: z.string().uuid(),
    paymentMethod: z.enum(["PIX", "CREDIT_CARD", "DEBIT_CARD"]),
    acknowledgedImmediateExecution: z.boolean().optional(),
    categoryId: z.string().uuid().optional(),
    weeklySchedule: z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          time: z.string().regex(/^\d{2}:\d{2}$/)
        })
      )
      .optional(),
    sessionLocation: z.string().trim().max(300).optional(),
    clientLatitude: z.number().optional(),
    clientLongitude: z.number().optional()
  })
});
