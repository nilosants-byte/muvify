import { Platform } from "react-native";

export type UserRole = "CLIENT" | "PROVIDER" | "ADMIN";
export type PaymentMethod = "CARD" | "CREDIT_CARD" | "DEBIT_CARD" | "PIX";
export type ProviderServiceMode = "PRESENTIAL_ONLY" | "HOME_VISIT_ONLY" | "BOTH";

export type ProviderFixedLocation = {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number | null;
};

export type AuthUser = {
  id: string;
  name: string;
  apelido?: string | null;
  email: string;
  role: UserRole;
  phone?: string | null;
  photoUrl?: string | null;
  emailVerifiedAt?: string | null;
  createdAt?: string;
  providerProfile?: {
    id: string;
    displayName: string;
    bio: string;
    photoUrl?: string | null;
    experienceYears: number;
    priceCents: number;
    serviceRadiusKm?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    serviceMode?: ProviderServiceMode | null;
    fixedLocations?: ProviderFixedLocation[] | null;
    excludedLocations?: string[] | null;
    specialties?: string[] | null;
    categoryLinks?: Array<{
      categoryId: string;
      category?: Category;
    }>;
    mpAccountId?: string | null;
  } | null;
};

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export type AuthLoginTwoFactorChallenge = {
  requiresTwoFactor: true;
  challengeToken: string;
};

export type AuthLoginResponse = AuthResponse | AuthLoginTwoFactorChallenge;

export type ForgotPasswordResponse = {
  message: string;
  resetToken?: string;
};

export type ForgotPasswordChannel = "EMAIL";

export type Category = {
  id: string;
  name: string;
  description?: string | null;
};

export type ProviderSummary = {
  id: string;
  displayName: string;
  bio: string;
  photoUrl?: string | null;
  specialties?: string[] | null;
  age?: number | null;
  experienceYears: number;
  priceCents: number;
  averageRating?: number;
  totalReviews?: number;
  /** @deprecated use averageRating */ avgRating?: number;
  /** @deprecated use totalReviews */ reviewCount?: number;
  serviceRadiusKm?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  serviceMode?: ProviderServiceMode | null;
  fixedLocations?: ProviderFixedLocation[] | null;
  excludedLocations?: string[] | null;
  minBookingNoticeHours?: number;
  distanceKm?: number;
};

export type ProviderCategoryLink = {
  categoryId: string;
  category?: Category;
};

export type ProviderReview = {
  id: string;
  rating: number;
  comment?: string | null;
  providerResponse?: string | null;
  providerRespondedAt?: string | null;
  createdAt: string;
  user?: {
    id: string;
    name?: string;
  };
};

export type ProviderDetail = ProviderSummary & {
  presentationVideoUrl?: string | null;
  user?: {
    id: string;
    name?: string;
    email?: string;
    phone?: string | null;
  };
  categoryLinks?: ProviderCategoryLink[];
  availabilities?: Availability[];
  reviews?: ProviderReview[];
};

export type ProviderSchedulePreviewDay = {
  date: string;
  weekday: number;
  label: string;
  availableSlots: string[];
  occupiedSlots: string[];
};

export type ProviderSchedulePreview = {
  providerId: string;
  timezone: string;
  days: ProviderSchedulePreviewDay[];
};

export type Booking = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  scheduledAt: string;
  priceCents?: number;
  currency?: string;
  notes?: string | null;
  sessionLocation?: string | null;
  providerId: string;
  clientId: string;
  categoryId: string;
  clientConfirmedAt?: string | null;
  providerConfirmedAt?: string | null;
  completedAt?: string | null;
  attendanceCodeValidatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  category?: Category;
  provider?: {
    id: string;
    displayName?: string;
    photoUrl?: string | null;
    user?: {
      id: string;
      name?: string;
      phone?: string | null;
    };
  };
  client?: {
    id: string;
    name?: string;
    email?: string;
    phone?: string | null;
    photoUrl?: string | null;
  };
  payment?: PaymentStatusResponse;
  noShowReport?: {
    id: string;
    reportedUserId: string;
    reportedByUserId: string;
    status: "PENDING" | "CONTESTED" | "RESOLVED";
    contestDeadlineAt: string;
    contestedAt: string | null;
    resolvedAt: string | null;
  } | null;
};

export type CompletionProofInput = {
  imageBase64: string;
  mimeType: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
  cameraFacing: "FRONT" | "BACK";
};

export type AttendanceCodeResponse = {
  bookingId: string;
  available: boolean;
  releaseAt?: string;
  code?: string | null;
  generatedAt?: string | null;
  expiresAt?: string | null;
  validated: boolean;
  validatedAt?: string | null;
  qrToken?: string | null;
  qrDeepLink?: string | null;
};

export type ServiceOfferKind =
  | "PRESENTIAL"
  | "ONLINE_CONSULTANCY"
  | "ONLINE_CONSULTANCY_SPECIALIZED"
  | "COMBO";

export type OfferBillingCycle =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMIANNUAL"
  | "ANNUAL";

export type ConsultancyPaymentMethod = "CREDIT_CARD" | "DEBIT_CARD" | "PIX";

export type PresentialPackageMode = "FIXED_RECURRING" | "FLEXIBLE_CREDITS";

export type ProviderServiceOffer = {
  id: string;
  providerId: string;
  kind: ServiceOfferKind;
  title: string;
  billingCycle: OfferBillingCycle;
  daysPerWeek?: number | null;
  comboPresentialDaysPerWeek?: number | null;
  comboOnlineDaysPerWeek?: number | null;
  priceCents: number;
  basePriceUpdatedAt: string;
  isPromotion: boolean;
  promotionPriceCents?: number | null;
  promotionEndsAt?: string | null;
  isPromotionActive?: boolean;
  effectivePriceCents?: number;
  kindDescription?: string | null;
  basePriceChangeLockedUntil?: string;
  promotionLabel?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Pacote presencial (assinatura cobrada em ciclos) - so PRESENTIAL/COMBO
  presentialPackageMode?: PresentialPackageMode | null;
  presentialHasFixedTerm?: boolean;
  presentialTotalCycles?: number | null;
  presentialSessionsPerCycle?: number | null;
  comboPresentialShareCents?: number | null;
  comboConsultancyShareCents?: number | null;
};

export type PromotionFeedItem = {
  offerId: string;
  providerId: string;
  providerName: string;
  providerPhotoUrl?: string | null;
  specialty: string;
  itemInPromotion: string;
  promotionalPriceCents: number;
  basePriceCents?: number;
  promotionEndsAt?: string | null;
  kind: ServiceOfferKind;
  billingCycle: OfferBillingCycle;
  daysPerWeek?: number | null;
  comboPresentialDaysPerWeek?: number | null;
  comboOnlineDaysPerWeek?: number | null;
};

export type ProviderConsultancyCatalog = {
  provider: {
    id: string;
    displayName: string;
    photoUrl?: string | null;
    specialties: string[];
  };
  onlineConsultancyEnabled: boolean;
  offers: ProviderServiceOffer[];
  prebuiltPlanPreviews: Array<{
    id: string;
    title: string;
    description?: string | null;
    exerciseCount: number;
  }>;
};

export type ConsultancyRequest = {
  id: string;
  providerId: string;
  clientId: string;
  trainingNeedText?: string | null;
  limitationText?: string | null;
  extraInfoText?: string | null;
  providerResponseText?: string | null;
  status:
    | "OPEN"
    | "RESPONDED"
    | "ACCEPTED"
    | "REFUSED"
    | "EXPIRED_REFUNDED"
    | "ARCHIVED";
  quotedOfferId?: string | null;
  respondedAt?: string | null;
  clientDecisionAt?: string | null;
  createdAt: string;
  updatedAt: string;
  provider?: {
    id: string;
    displayName: string;
    photoUrl?: string | null;
    user?: {
      id: string;
      name?: string;
    };
  };
  client?: {
    id: string;
    name?: string;
    email?: string;
  };
  quotedOffer?: ProviderServiceOffer | null;
  contract?: ConsultancyContract | null;
};

export type ConsultancyContract = {
  id: string;
  requestId: string;
  providerId: string;
  clientId: string;
  offerId: string;
  status: "PENDING_PAYMENT" | "ACTIVE" | "DELIVERED" | "REFUNDED_EXPIRED" | "ARCHIVED";
  paymentMethod?: ConsultancyPaymentMethod | null;
  paymentStatus: "PENDING" | "CAPTURED" | "REFUNDED" | "FAILED";
  paymentAmountCents: number;
  providerAmountCents: number;
  platformAmountCents: number;
  deliveryDeadlineAt: string;
  deliveredAt?: string | null;
  refundedAt?: string | null;
  offer?: ProviderServiceOffer;
  provider?: {
    id: string;
    displayName: string;
    photoUrl?: string | null;
  };
  trainingPlans?: TrainingPlan[];
};

export type TrainingPlanExercise = {
  id: string;
  sortOrder: number;
  name: string;
  repetitionsSets: string;
  load: string;
  restSeconds?: number | null;
  restLabel?: string | null;
  demoVideoUrl?: string | null;
  exerciseId?: string | null;
  exercise?: {
    id: string;
    name: string;
    category: string;
    description?: string | null;
    mediaUrl?: string | null;
    mediaType?: ExerciseMediaType | null;
  } | null;
};

export type TrainingPlan = {
  id: string;
  providerId: string;
  contractId?: string | null;
  title: string;
  description?: string | null;
  isPrebuilt: boolean;
  isActive: boolean;
  validUntil?: string | null;
  isVigente?: boolean;
  exercises: TrainingPlanExercise[];
};

export type TrainingPlanCompletion = {
  id: string;
  clientId: string;
  providerId: string;
  trainingPlanId: string;
  contractId?: string | null;
  notes?: string | null;
  completedAt: string;
};

export type MyTrainingResponse = {
  locked: boolean;
  waitingDelivery: Array<{
    contractId: string;
    providerName: string;
    deliveryDeadlineAt: string;
    status: "PENDING_PAYMENT" | "ACTIVE" | "DELIVERED" | "REFUNDED_EXPIRED" | "ARCHIVED";
  }>;
  contracts: ConsultancyContract[];
};

export type Favorite = {
  id: string;
  userId: string;
  providerId: string;
  provider?: ProviderSummary & {
    user?: {
      id: string;
      name?: string;
      phone?: string | null;
    };
  };
};

export type Availability = {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
};

export type ProviderAccountStatus = {
  hasAccount: boolean;
  accountId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export type ProviderCredentialsDocument = {
  id?: string;
  name: string;
  uri: string;
  mimeType?: string | null;
  createdAt?: string;
};

export type ProviderCredentials = {
  providerId: string;
  crefNumber?: string | null;
  crefDocumentUrl?: string | null;
  credentials: ProviderCredentialsDocument[];
  crefValidatedAt?: string | null;
  crefValidationStatus?: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  crefRejectionReason?: string | null;
  crefReviewedAt?: string | null;
};

export type AdminDashboardOverview = {
  summary: {
    activeUsers: number;
    totalUsers: number;
    totalProviders: number;
    totalClients: number;
  };
  rankings: {
    byRegion: Array<{ label: string; bookingsCount: number }>;
    byCity: Array<{ label: string; bookingsCount: number }>;
    byNeighborhood: Array<{ label: string; bookingsCount: number }>;
  };
  newUsersChart: {
    month: number;
    year: number;
    total: number;
    data: Array<{
      day: number;
      date: string;
      usersCount: number;
    }>;
  };
};

export type AdminCrefQueueItem = ProviderCredentials & {
  user: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type AdminSupportTicket = {
  id: string;
  subject?: string | null;
  message: string;
  status: "OPEN" | "ANSWERED";
  adminResponse?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
  respondedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
};

export type AdminChatAuditSessionSummary = {
  bookingId: string;
  chatStartedAt: string;
  chatLastMessageAt: string;
  messageCount: number;
  bookingScheduledAt: string;
  sessionLocation?: string | null;
  priceCents: number;
  currency: string;
  serviceType: string;
  client: {
    id: string;
    name: string;
    email: string;
  };
  provider: {
    profileId: string;
    userId: string;
    name: string;
    email: string;
  };
};

export type AdminChatAuditSessionListResponse = {
  items: AdminChatAuditSessionSummary[];
  nextCursor: string | null;
};

export type AdminChatAuditMessage = {
  id: string;
  senderId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  isSystem: boolean;
  content: string;
  readAt: string | null;
  createdAt: string;
};

export type AdminChatAuditSessionMessagesResponse = {
  session: AdminChatAuditSessionSummary;
  messages: AdminChatAuditMessage[];
  nextCursor: string | null;
};

export type AdminLookupUser = {
  id: string;
  name: string;
  email?: string;
  documentMasked?: string | null; // Backend retorna mascarado: "***.***.***-XX"
  /** @deprecated Usar documentMasked */
  document?: string | null;
};

export type AdminLookupCrefResult = {
  user: AdminLookupUser;
  cref: {
    id: string;
    crefNumber: string | null;
    crefDocumentUrl: string | null;
    credentialDocuments: unknown;
    crefValidationStatus: string;
    crefValidatedAt: string | null;
    crefRejectionReason: string | null;
    crefReviewedAt: string | null;
  };
} | null;

export type AdminLookupChatItem = {
  bookingId: string;
  scheduledAt: string;
  sessionLocation: string | null;
  chatStartedAt: string;
  messageCount: number;
};

export type AdminLookupChatsResult = {
  provider: AdminLookupUser | null;
  client: AdminLookupUser | null;
  items: AdminLookupChatItem[];
};

export type AdminLookupBookingItem = {
  bookingId: string;
  scheduledAt: string;
  sessionLocation: string | null;
  status: string;
  priceCents: number;
  currency: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
};

export type AdminLookupBookingsResult = {
  provider: Pick<AdminLookupUser, "id" | "name" | "documentMasked"> | null;
  client: Pick<AdminLookupUser, "id" | "name" | "documentMasked"> | null;
  items: AdminLookupBookingItem[];
};

export type AdminLookupBookingDetail = {
  id: string;
  scheduledAt: string;
  sessionLocation: string | null;
  notes: string | null;
  status: string;
  priceCents: number;
  currency: string;
  attendanceCodeValidatedAt: string | null;
  clientConfirmedAt: string | null;
  providerConfirmedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  client: { id: string; name: string; email: string; documentMasked?: string | null };
  provider: {
    id: string;
    displayName: string;
    crefNumber: string | null;
    user: { id: string; email: string; documentMasked?: string | null };
  };
  category: { name: string } | null;
  payment: {
    method: string;
    status: string;
    amountCents: number;
    currency: string;
    authorizedAt: string | null;
    capturedAt: string | null;
    canceledAt: string | null;
    refundedAt: string | null;
    failureReason: string | null;
  } | null;
};

export const PROFESSIONAL_SPECIALTIES = [
  "Hipertrofia",
  "Emagrecimento",
  "Corrida",
  "Alongamento",
  "Reabilitação e Lesão",
  "LPO (Levantamento de Peso Olímpico)",
  "Fisiculturismo",
  "Grupos Especiais",
  "Saúde da Mulher",
  "Treino Intervalado (HIIT)",
] as const;

export type AnamnesisGoal =
  | "EMAGRECIMENTO"
  | "HIPERTROFIA"
  | "CONDICIONAMENTO_FISICO"
  | "REABILITACAO"
  | "PERFORMANCE_ESPORTIVA"
  | "SAUDE_GERAL";

export type AnamnesisAnswers = {
  personalData?: {
    fullName?: string;
    birthDate?: string;
    age?: string;
    sex?: string;
    weightKg?: string;
    heightM?: string;
    phone?: string;
    email?: string;
    fullAddress?: string;
    emergencyContact?: string;
  };
  objectives?: {
    selected?: AnamnesisGoal[];
    other?: string;
    mainObjective?: string;
    targetTimeframe?: string;
  };
  healthHistory?: {
    hasDiagnosedDisease?: boolean;
    diagnosedDiseaseDetails?: string;
    hadSurgery?: boolean;
    surgeryDetails?: string;
    hasInjuries?: boolean;
    injuriesDetails?: string;
    hasCurrentPain?: boolean;
    currentPainDetails?: string;
    hasCardiacProblems?: boolean;
    hasHypertension?: boolean;
    hasDiabetes?: boolean;
    hasRespiratoryProblems?: boolean;
  };
  medicationAndSupplements?: {
    usesMedication?: boolean;
    medicationDetails?: string;
    usesSupplements?: boolean;
    supplementsDetails?: string;
    usedHormones?: boolean;
    hormonesDetails?: string;
  };
  familyHistory?: {
    hasCardiacDisease?: boolean;
    hasHypertension?: boolean;
    hasDiabetes?: boolean;
    hasObesity?: boolean;
    hasOrthopedicProblems?: boolean;
    other?: string;
  };
  activityHistory?: {
    hasTrainedBefore?: boolean;
    trainingDuration?: string;
    weeklyFrequency?: string;
    hadProfessionalSupport?: boolean;
    practicedModalities?: string;
    stopReason?: string;
  };
  lifestyle?: {
    sleepHours?: string;
    sleepQuality?: "BOA" | "REGULAR" | "RUIM";
    stressLevel?: "BAIXO" | "MODERADO" | "ALTO";
    alcoholConsumption?: "NAO" | "SOCIAL" | "FREQUENTE";
    smokes?: boolean;
    workRoutine?: "SEDENTARIA" | "MODERADAMENTE_ATIVA" | "MUITO_ATIVA";
  };
  nutrition?: {
    mealsPerDay?: string;
    followsDiet?: boolean;
    dietDetails?: string;
    waterIntake?: string;
    hasBingeEating?: boolean;
    avoidedFoods?: string;
  };
  limitations?: {
    physicalLimitations?: string;
    restrictedExercises?: string;
  };
  behavior?: {
    trainingMotivation?: string;
    biggestConsistencyDifficulty?: string;
    quitBeforeReason?: string;
  };
  imageAuthorization?: {
    allowImageUse?: boolean;
  };
  parq?: {
    hasHeartCondition?: boolean;
    chestPainDuringExercise?: boolean;
    chestPainAtRestLastMonth?: boolean;
    dizzinessOrFainting?: boolean;
    jointProblemsWithExercise?: boolean;
    usesCardiacMedication?: boolean;
    hasOtherExerciseRestriction?: boolean;
  };
  responsibilityTermAccepted?: boolean;
};

export type ClientAnamnesisProfile = {
  id: string | null;
  clientId: string;
  status: "DRAFT" | "COMPLETED";
  answers: AnamnesisAnswers | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SecurityRecoveryEmailResponse = {
  recoveryEmail: string;
  accountEmail: string;
  custom: boolean;
};

export type ProviderStudentServiceKind =
  | "PRESENTIAL"
  | "ONLINE_CONSULTANCY"
  | "ONLINE_CONSULTANCY_SPECIALIZED"
  | "COMBO";

export type ProviderStudentServiceEntry = {
  serviceKind: ProviderStudentServiceKind;
  serviceLabel: string;
  valueCents: number;
  active: boolean;
  nextSessionAt: string | null;
  validUntil: string | null;
};

export type ProviderStudent = {
  clientId: string;
  name: string;
  email: string;
  phone: string | null;
  profilePhotoUrl: string | null;
  age?: number | null;
  anamnesisPending: boolean;
  trainingPlanPending: boolean;
  active: boolean;
  totalValueCents: number;
  services: ProviderStudentServiceEntry[];
  totalBookings: number;
  totalContracts: number;
  lastActivityAt: string;
};

export type ProviderDashboardStudentsResponse = {
  providerId: string;
  totalStudents: number;
  serviceCounts: Record<"ALL" | ProviderStudentServiceKind, number>;
  students: ProviderStudent[];
};

export type ProviderStudentPhysicalAssessment = {
  id: string | null;
  providerId: string;
  clientId: string;
  weight: string | null;
  height: string | null;
  imc: string | null;
  bodyFatPercent: string | null;
  muscleMass: string | null;
  circumferences: string | null;
  waist: string | null;
  hip: string | null;
  chest: string | null;
  arm: string | null;
  thigh: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ProviderStudentManagementDetail = {
  student: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    profilePhotoUrl: string | null;
    memberSince: string;
  };
  anamnesis: {
    id: string | null;
    status: "DRAFT" | "COMPLETED";
    completedAt: string | null;
    answers: AnamnesisAnswers | null;
  };
  physicalAssessment: ProviderStudentPhysicalAssessment;
  serviceSummary: {
    presentialBookings: number;
    onlineConsultancyContracts: number;
    specializedConsultancyContracts: number;
    comboContracts: number;
  };
  presentialHistory: unknown[];
  consultancyContracts: Array<{
    id: string;
    status: string;
    paymentAmountCents: number;
    paymentInstallments: number;
    createdAt: string;
    deliveredAt: string | null;
    validUntil: string | null;
    isVigente: boolean;
    offer: {
      id: string;
      kind: ProviderStudentServiceKind;
      title: string;
      billingCycle: string;
      priceCents: number;
    };
    trainingPlans: Array<{
      id: string;
      title: string;
      description: string | null;
      validUntil: string | null;
      isVigente: boolean;
      createdAt: string;
    }>;
  }>;
  trainingCompliance: {
    completionCount: number;
    latestCompletions: unknown[];
  };
};

export type ProviderAccountCreate = {
  accountId: string;
  onboardingUrl: string;
};

export type PaymentStatusResponse = {
  id: string;
  method: PaymentMethod;
  failureReason?: string | null;
  status:
    | "PENDING_AUTH"
    | "AUTHORIZING"
    | "AUTHORIZED"
    | "CAPTURED"
    | "CANCELED"
    | "REFUNDED"
    | "FAILED";
  amountCents: number;
  currency: string;
  bookingId: string;
};

export type PixChargeResponse = {
  paymentId: string;
  bookingId: string;
  method: PaymentMethod;
  status: PaymentStatusResponse["status"];
  amountCents: number;
  pix: {
    qrCodeUrl: string | null;
    copyAndPasteCode: string | null;
    hostedInstructionsUrl: string | null;
    expiresAt: string | null;
  } | null;
};

export type PushDevice = {
  id: string;
  token: string;
  platform: "IOS" | "ANDROID" | "WEB" | "UNKNOWN";
  appVersion?: string | null;
  deviceName?: string | null;
  isActive: boolean;
  invalidAt?: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type NotificationInboxItem = {
  id: string;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean> | null;
  readAt?: string | null;
  createdAt: string;
};

export type CustomerPaymentStatus = {
  configured: boolean;
  hasCustomer: boolean;
  hasDefaultPaymentMethod: boolean;
};

export type CustomerCardSummary = {
  id: string;
  nickname: string;
  brand: string;
  last4: string;
  funding: "CREDIT" | "DEBIT" | "UNKNOWN";
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerSetupIntent = {
  setupIntentId: string;
  setupIntentClientSecret: string;
  customerId: string;
  ephemeralKeySecret: string;
  mpPublicKey?: string;
};

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type RequestConfig = {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
};

export type ExerciseMediaType = "YOUTUBE" | "VIDEO" | "IMAGE" | "GIF";

export type Exercise = {
  id: string;
  providerId?: string | null;
  name: string;
  category: string;
  description?: string | null;
  defaultRepetitionsSets?: string | null;
  defaultRestLabel?: string | null;
  mediaUrl?: string | null;
  mediaType?: ExerciseMediaType | null;
  isPrebuilt: boolean;
  createdAt: string;
  updatedAt: string;
};

export const EXERCISE_CATEGORIES = [
  "Peitoral",
  "Ombros",
  "Tríceps",
  "Bíceps",
  "Dorsal",
  "Posterior",
  "Glúteos",
  "Quadríceps",
  "Panturrilha",
  "Abdômen",
  "Alongamento",
  "Mobilidade",
  "Cardio",
] as const;

export type ExerciseCategory = typeof EXERCISE_CATEGORIES[number];

export const exerciseApi = {
  listAll(token: string, params?: { category?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.q) query.set("q", params.q);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<Exercise[]>(`/exercises${suffix}`, { token });
  },
  listMine(token: string, params?: { category?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.q) query.set("q", params.q);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<Exercise[]>(`/exercises/mine${suffix}`, { token });
  },
  listPrebuilt(params?: { category?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.q) query.set("q", params.q);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<Exercise[]>(`/exercises/prebuilt${suffix}`);
  },
  create(token: string, body: {
    name: string;
    category: string;
    description?: string;
    defaultRepetitionsSets?: string;
    defaultRestLabel?: string;
    mediaUrl?: string;
    mediaType?: ExerciseMediaType;
  }) {
    return apiRequest<Exercise>("/exercises", { method: "POST", token, body });
  },
  delete(token: string, exerciseId: string) {
    return apiRequest<void>(`/exercises/${exerciseId}`, { method: "DELETE", token });
  },
};

export const adminExerciseApi = {
  list(token: string, params?: { category?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.q) query.set("q", params.q);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<Exercise[]>(`/admin/exercises${suffix}`, { token });
  },
  create(token: string, body: {
    name: string;
    category: string;
    description?: string;
    defaultRepetitionsSets?: string;
    defaultRestLabel?: string;
    mediaUrl?: string;
    mediaType?: ExerciseMediaType;
  }) {
    return apiRequest<Exercise>("/admin/exercises", { method: "POST", token, body });
  },
  update(token: string, exerciseId: string, body: {
    name?: string;
    category?: string;
    description?: string;
    defaultRepetitionsSets?: string;
    defaultRestLabel?: string;
    mediaUrl?: string;
    mediaType?: ExerciseMediaType;
  }) {
    return apiRequest<Exercise>(`/admin/exercises/${exerciseId}`, { method: "PATCH", token, body });
  },
  delete(token: string, exerciseId: string) {
    return apiRequest<void>(`/admin/exercises/${exerciseId}`, { method: "DELETE", token });
  },
};

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function resolveApiBaseUrl() {
  const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    if (!__DEV__ && configuredBaseUrl.startsWith("http://")) {
      throw new Error(
        "EXPO_PUBLIC_API_BASE_URL deve usar HTTPS em build de producao."
      );
    }
    return configuredBaseUrl;
  }

  if (!__DEV__) {
    throw new Error(
      "EXPO_PUBLIC_API_BASE_URL e obrigatoria em producao."
    );
  }

  // Android emulator cannot reach localhost of host machine directly.
  if (Platform.OS === "android") {
    return "http://10.0.2.2:3000/api";
  }

  return "http://localhost:3000/api";
}

export const API_BASE_URL = resolveApiBaseUrl();
const API_REQUEST_TIMEOUT_MS = 30000;

function buildNetworkErrorMessage() {
  if (__DEV__) {
    return `Falha de rede. URL: ${API_BASE_URL}`;
  }
  return "Sem conexão com a internet. Verifique sua rede e tente novamente.";
}

function buildTimeoutErrorMessage() {
  if (__DEV__) {
    return `Tempo limite (${Math.round(API_REQUEST_TIMEOUT_MS / 1000)}s). URL: ${API_BASE_URL}`;
  }
  return "A conexão demorou muito. Verifique sua internet e tente novamente.";
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) {
    return undefined;
  }
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function apiRequest<T = unknown>(
  path: string,
  { method = "GET", token, body }: RequestConfig = {}
) {
  const requestUrl = `${API_BASE_URL}${path}`;
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(requestUrl, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Header de tunelamento do ngrok — só faz sentido em dev local (npm run start:ngrok).
        // Nunca deve ir para builds de produção.
        ...(__DEV__ ? { "ngrok-skip-browser-warning": "true" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
    const cause = error instanceof Error ? error.message : "Network request failed";
    throw new ApiError(0, timedOut ? buildTimeoutErrorMessage() : buildNetworkErrorMessage(), {
      cause,
      requestUrl,
      method
    });
  } finally {
    clearTimeout(timeoutId);
  }

  return finalizeResponse<T>(response);
}

async function finalizeResponse<T>(response: Response): Promise<T> {
  const payload = await parseResponse(response);
  if (!response.ok) {
    let message: string;
    if (typeof payload === "string") {
      message = payload;
    } else if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      if (Array.isArray(p.errors) && p.errors.length > 0) {
        message = (p.errors as Array<{ message?: string }>)
          .map((e) => e.message)
          .filter(Boolean)
          .join(", ") || `HTTP ${response.status}`;
      } else {
        message = (p.message as string | undefined) ?? (p.error as string | undefined) ?? (p.detail as string | undefined) ?? `HTTP ${response.status}`;
      }
    } else {
      message = `HTTP ${response.status}`;
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const wait = retryAfter ? parseInt(retryAfter, 10) : 60;
      message = `Muitas requisições. Aguarde ${wait}s e tente novamente.`;
    } else if (response.status === 503 || response.status === 502 || response.status === 504) {
      message = (payload as Record<string, unknown> | null)?.message as string | undefined
        ?? "Serviço temporariamente indisponível. Tente novamente em alguns minutos.";
    }
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}

type UploadRequestConfig = {
  token?: string;
  formData: FormData;
};

// Multipart uploads: no Content-Type header here on purpose — fetch/RN sets
// "multipart/form-data; boundary=..." automatically based on the FormData body.
export async function apiUploadRequest<T = unknown>(
  path: string,
  { token, formData }: UploadRequestConfig
): Promise<T> {
  const requestUrl = `${API_BASE_URL}${path}`;
  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(__DEV__ ? { "ngrok-skip-browser-warning": "true" } : {})
      },
      body: formData,
      signal: controller.signal
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || /aborted|timeout/i.test(error.message));
    const cause = error instanceof Error ? error.message : "Network request failed";
    throw new ApiError(0, timedOut ? buildTimeoutErrorMessage() : buildNetworkErrorMessage(), {
      cause,
      requestUrl,
      method: "POST"
    });
  } finally {
    clearTimeout(timeoutId);
  }

  return finalizeResponse<T>(response);
}

export const authApi = {
  register(input: {
    name: string;
    apelido?: string;
    email: string;
    password: string;
    phone: string;
    role?: "CLIENT" | "PROVIDER";
    termsVersion: string;
    consentAccepted: true;
  }) {
    return apiRequest<AuthResponse>("/auth/register", { method: "POST", body: input });
  },
  login(input: { email: string; password: string }) {
    return apiRequest<AuthLoginResponse>("/auth/login", { method: "POST", body: input });
  },
  refresh(refreshToken: string) {
    return apiRequest<AuthResponse>("/auth/refresh", {
      method: "POST",
      body: { refreshToken }
    });
  },
  logout(refreshToken: string) {
    return apiRequest<void>("/auth/logout", {
      method: "POST",
      body: { refreshToken }
    });
  },
  forgotPassword(input: { channel: ForgotPasswordChannel; email?: string; phone?: string }) {
    return apiRequest<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      body: input
    });
  },
  resetPassword(input: { token: string; newPassword: string }) {
    return apiRequest<void>("/auth/reset-password", {
      method: "POST",
      body: input
    });
  },
  resendVerificationEmail(token: string) {
    return apiRequest<{ message: string }>("/auth/resend-verification", {
      method: "POST",
      token
    });
  },
  loginWithTwoFactor(input: { challengeToken: string; code: string }) {
    return apiRequest<AuthResponse>("/auth/2fa/login", {
      method: "POST",
      body: input
    });
  },
  loginWithBackupCode(input: { challengeToken: string; code: string }) {
    return apiRequest<AuthResponse>("/auth/2fa/login", {
      method: "POST",
      body: input
    });
  }
};

export type UploadFolder =
  | "profile-photos"
  | "presentation-videos"
  | "feed-photos"
  | "cref-documents"
  | "exercise-media";

export type UploadFile = {
  uri: string;
  mimeType: string;
  fileName?: string;
};

export const uploadsApi = {
  async uploadMedia(token: string, file: UploadFile, folder: UploadFolder) {
    const formData = new FormData();
    formData.append("folder", folder);
    const fileName = file.fileName ?? `upload-${Date.now()}`;
    if (file.uri.startsWith("data:")) {
      // Already-in-memory data URI (e.g. a selfie stashed in AsyncStorage) — resolve
      // it to a Blob directly, no local file:// path to hand to FormData.
      const blob = await (await fetch(file.uri)).blob();
      formData.append("file", blob, fileName);
    } else {
      formData.append("file", {
        uri: file.uri,
        name: fileName,
        type: file.mimeType
      } as unknown as Blob);
    }
    return apiUploadRequest<{ url: string; mimeType: string; sizeBytes: number }>("/uploads/media", {
      token,
      formData
    });
  }
};

export const userApi = {
  me(token: string) {
    return apiRequest<AuthUser>("/users/me", { token });
  },
  updateMe(token: string, input: { name?: string; apelido?: string; phone?: string; photoUrl?: string }) {
    // Nota: email foi removido — mudança de email requer endpoint dedicado no futuro
    return apiRequest<AuthUser>("/users/me", { method: "PATCH", token, body: input });
  },
  myAnamnesis(token: string) {
    return apiRequest<ClientAnamnesisProfile>("/users/me/anamnesis", { token });
  },
  upsertMyAnamnesis(
    token: string,
    input: {
      status?: "DRAFT" | "COMPLETED";
      answers?: AnamnesisAnswers;
    }
  ) {
    return apiRequest<ClientAnamnesisProfile>("/users/me/anamnesis", {
      method: "PUT",
      token,
      body: input
    });
  },
  changePassword(
    token: string,
    input: {
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
    }
  ) {
    return apiRequest<{ success: boolean }>("/users/me/security/password", {
      method: "POST",
      token,
      body: input
    });
  },
  getRecoveryEmail(token: string) {
    return apiRequest<SecurityRecoveryEmailResponse>("/users/me/security/recovery-email", {
      token
    });
  },
  upsertRecoveryEmail(token: string, recoveryEmail: string) {
    return apiRequest<SecurityRecoveryEmailResponse>("/users/me/security/recovery-email", {
      method: "PUT",
      token,
      body: { recoveryEmail }
    });
  },
  sendSupportMessage(
    token: string,
    input: {
      subject?: string;
      message: string;
    }
  ) {
    return apiRequest<{ ticketId: string; delivered: boolean; queued?: boolean }>("/users/me/support-message", {
      method: "POST",
      token,
      body: input
    });
  },
  deleteMe(token: string, password: string) {
    return apiRequest<void>("/users/me", { method: "DELETE", token, body: { password } });
  },
  exportMyData(token: string) {
    return apiRequest<Record<string, unknown>>("/users/me/data-export", { token });
  },
};

export const adminApi = {
  dashboardOverview(
    token: string,
    params?: {
      month?: number;
      year?: number;
    }
  ) {
    const query = new URLSearchParams();
    if (typeof params?.month === "number") query.set("month", String(params.month));
    if (typeof params?.year === "number") query.set("year", String(params.year));
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<AdminDashboardOverview>(`/admin/dashboard/overview${suffix}`, { token });
  },
  listCrefRequests(
    token: string,
    params?: {
      status?: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
      take?: number;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (typeof params?.take === "number") query.set("take", String(params.take));
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<AdminCrefQueueItem[]>(`/admin/cref/requests${suffix}`, { token });
  },
  reviewCref(
    token: string,
    providerId: string,
    input: {
      decision: "APPROVE" | "REJECT";
      justification?: string;
    }
  ) {
    return apiRequest<ProviderCredentials>(`/admin/cref/requests/${providerId}`, {
      method: "PATCH",
      token,
      body: input
    });
  },
  listSupportTickets(
    token: string,
    params?: {
      status?: "OPEN" | "ANSWERED";
      take?: number;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (typeof params?.take === "number") query.set("take", String(params.take));
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<AdminSupportTicket[]>(`/admin/support/tickets${suffix}`, { token });
  },
  replySupportTicket(token: string, ticketId: string, responseMessage: string) {
    return apiRequest<AdminSupportTicket>(`/admin/support/tickets/${ticketId}/respond`, {
      method: "PATCH",
      token,
      body: { responseMessage }
    });
  },
  listChatAuditSessions(
    token: string,
    params?: {
      clientEmail?: string;
      providerEmail?: string;
      startedFrom?: string;
      startedTo?: string;
      take?: number;
      cursor?: string;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.clientEmail) query.set("clientEmail", params.clientEmail);
    if (params?.providerEmail) query.set("providerEmail", params.providerEmail);
    if (params?.startedFrom) query.set("startedFrom", params.startedFrom);
    if (params?.startedTo) query.set("startedTo", params.startedTo);
    if (typeof params?.take === "number") query.set("take", String(params.take));
    if (params?.cursor) query.set("cursor", params.cursor);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<AdminChatAuditSessionListResponse>(`/admin/chat-audit/sessions${suffix}`, { token });
  },
  getChatAuditSessionMessages(
    token: string,
    bookingId: string,
    params?: {
      take?: number;
      cursor?: string;
    }
  ) {
    const query = new URLSearchParams();
    if (typeof params?.take === "number") query.set("take", String(params.take));
    if (params?.cursor) query.set("cursor", params.cursor);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<AdminChatAuditSessionMessagesResponse>(
      `/admin/chat-audit/sessions/${bookingId}/messages${suffix}`,
      { token }
    );
  },
  lookupCref(token: string, providerDocument: string) {
    return apiRequest<AdminLookupCrefResult>(
      `/admin/lookup/cref?providerDocument=${encodeURIComponent(providerDocument)}`,
      { token }
    );
  },
  lookupChats(token: string, providerDocument: string, clientDocument: string) {
    return apiRequest<AdminLookupChatsResult>(
      `/admin/lookup/chats?providerDocument=${encodeURIComponent(providerDocument)}&clientDocument=${encodeURIComponent(clientDocument)}`,
      { token }
    );
  },
  lookupBookings(token: string, providerDocument: string, clientDocument: string, date?: string) {
    const q = new URLSearchParams({ providerDocument, clientDocument });
    if (date) q.set("date", date);
    return apiRequest<AdminLookupBookingsResult>(`/admin/lookup/bookings?${q}`, { token });
  },
  lookupBookingDetail(token: string, bookingId: string) {
    return apiRequest<AdminLookupBookingDetail>(`/admin/lookup/bookings/${bookingId}`, { token });
  },
  listDisputeCases(token: string, params?: { status?: "OPEN" | "RESOLVED" }) {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<AdminDisputeCaseListItem[]>(`/admin/disputes${suffix}`, { token });
  },
  getDisputeCaseDetail(token: string, caseId: string) {
    return apiRequest<AdminDisputeCaseDetail>(`/admin/disputes/${caseId}`, { token });
  },
  resolveDisputeCase(
    token: string,
    caseId: string,
    input: { resolution: "REFUNDED" | "DENIED"; amountCents?: number; note: string }
  ) {
    return apiRequest<AdminDisputeCaseListItem>(`/admin/disputes/${caseId}/resolve`, {
      method: "POST",
      token,
      body: input
    });
  }
};

export type AdminDisputeCaseType = "NO_SHOW_CONTESTED" | "CHARGEBACK" | "REFUND_FAILED";
export type AdminDisputeCaseStatus = "OPEN" | "RESOLVED";
export type AdminDisputeCaseResolution = "REFUNDED" | "DENIED";

export type AdminDisputeCaseListItem = {
  id: string;
  type: AdminDisputeCaseType;
  status: AdminDisputeCaseStatus;
  amountCents: number;
  resolution: AdminDisputeCaseResolution | null;
  resolvedAmountCents: number | null;
  createdAt: string;
  resolvedAt: string | null;
  client: { id: string; name: string; email: string };
  provider: { id: string; displayName: string; user: { email: string } };
};

export type AdminDisputeCaseDetail = AdminDisputeCaseListItem & {
  resolutionNote: string | null;
  resolvedByAdmin: { id: string; name: string } | null;
  provider: { id: string; displayName: string; user: { id: string; name: string; email: string } };
  booking: {
    id: string;
    scheduledAt: string;
    sessionLocation: string | null;
    status: string;
    priceCents: number;
    currency: string;
    attendanceCodeValidatedAt: string | null;
    category: { name: string } | null;
    completionEvidences: Array<{
      id: string;
      userId: string;
      mimeType: string;
      storageKey: string | null;
      imageBase64: string | null;
      capturedAt: string;
    }>;
    chatMessages: Array<{
      id: string;
      senderId: string | null;
      isSystem: boolean;
      content: string;
      createdAt: string;
    }>;
  } | null;
  consultancyContract: {
    id: string;
    status: string;
    paymentAmountCents: number;
    paymentCapturedAt: string | null;
    offer: { title: string } | null;
  } | null;
  presentialPackage: {
    id: string;
    status: string;
    cycleAmountCents: number;
    mode: string;
    offer: { title: string } | null;
  } | null;
  presentialPackageCycle: {
    id: string;
    cycleIndex: number;
    amountCents: number;
    capturedAt: string;
    periodStart: string;
    periodEnd: string;
  } | null;
  noShowReport: {
    id: string;
    status: string;
    reportReason: string | null;
    contestReason: string | null;
    contestDeadlineAt: string;
    contestedAt: string | null;
    reportedUserId: string;
    reportedByUserId: string;
  } | null;
};

export const categoriesApi = {
  list() {
    return apiRequest<Category[]>("/categories");
  }
};

export type StudentAnamnesisResponse = {
  status: "NONE" | "DRAFT" | "COMPLETED";
  answers: Record<string, unknown> | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  client?: { id: string; name: string; email?: string; phone?: string | null } | null;
};

export type ProviderTimelineBooking = {
  id: string;
  status: "PENDING" | "CONFIRMED";
  scheduledAt: string;
  client: { id: string; name: string; photoUrl?: string | null };
  category?: { name: string };
};

export type ProviderTimelineStudent = {
  id: string;
  name: string;
  photoUrl?: string | null;
};

export type ProviderTimelineResponse = {
  upcomingNow: ProviderTimelineBooking[];
  today: ProviderTimelineBooking[];
  recentNew: ProviderTimelineBooking[];
  studentsWithIncompleteAnamnesis: ProviderTimelineStudent[];
  generatedAt: string;
};

export const providersApi = {
  list(params?: {
    categoryId?: string;
    q?: string;
    minRating?: number;
    lat?: number;
    lng?: number;
    maxDistanceKm?: number;
    serviceMode?: ProviderServiceMode;
    take?: number;
    offset?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.categoryId) query.set("categoryId", params.categoryId);
    if (params?.q) query.set("q", params.q);
    if (typeof params?.minRating === "number") query.set("minRating", String(params.minRating));
    if (typeof params?.lat === "number") query.set("lat", String(params.lat));
    if (typeof params?.lng === "number") query.set("lng", String(params.lng));
    if (typeof params?.maxDistanceKm === "number") query.set("maxDistanceKm", String(params.maxDistanceKm));
    if (params?.serviceMode) query.set("serviceMode", params.serviceMode);
    if (typeof params?.take === "number") query.set("take", String(params.take));
    if (typeof params?.offset === "number") query.set("offset", String(params.offset));
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<ProviderSummary[]>(`/providers${suffix}`);
  },
  detail(providerId: string) {
    return apiRequest<ProviderDetail>(`/providers/${providerId}`);
  },
  schedulePreview(
    providerId: string,
    params?: {
      startDate?: string;
      days?: number;
    }
  ) {
    const query = new URLSearchParams();
    if (params?.startDate) query.set("startDate", params.startDate);
    if (typeof params?.days === "number") query.set("days", String(params.days));
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<ProviderSchedulePreview>(`/providers/${providerId}/schedule-preview${suffix}`);
  },
  createProfile(
    token: string,
    body: {
      displayName: string;
      bio: string;
      photoUrl?: string;
      presentationVideoUrl?: string;
      experienceYears: number;
      priceCents: number;
      serviceRadiusKm?: number;
      latitude?: number;
      longitude?: number;
      serviceMode?: ProviderServiceMode;
      fixedLocations?: Array<{
        id?: string;
        name: string;
        address?: string;
        latitude?: number;
        longitude?: number;
        radiusKm?: number;
      }>;
      excludedLocations?: string[];
      categoryIds?: string[];
      specialties?: string[];
    }
  ) {
    return apiRequest<unknown>("/providers/profile", { method: "POST", token, body });
  },
  updateProfile(
    token: string,
    body: Partial<{
      displayName: string;
      bio: string;
      photoUrl: string;
      presentationVideoUrl: string | null;
      experienceYears: number;
      priceCents: number;
      serviceRadiusKm: number;
      latitude: number;
      longitude: number;
      serviceMode: ProviderServiceMode;
      fixedLocations: Array<{
        id?: string;
        name: string;
        address?: string;
        latitude?: number;
        longitude?: number;
        radiusKm?: number;
      }>;
      excludedLocations: string[];
      categoryIds: string[];
      specialties: string[];
      minBookingNoticeHours: number;
    }>
  ) {
    return apiRequest<unknown>("/providers/profile", { method: "PUT", token, body });
  },
  myCredentials(token: string) {
    return apiRequest<ProviderCredentials>("/providers/me/credentials", { token });
  },
  upsertMyCredentials(
    token: string,
    body: {
      crefNumber: string;
      crefDocumentUrl?: string;
      credentials?: ProviderCredentialsDocument[];
    }
  ) {
    return apiRequest<ProviderCredentials>("/providers/me/credentials", {
      method: "PUT",
      token,
      body
    });
  },
  dashboardStudents(token: string) {
    return apiRequest<ProviderDashboardStudentsResponse>("/providers/dashboard/students", {
      token
    });
  },
  dashboardStudentDetail(token: string, clientId: string) {
    return apiRequest<ProviderStudentManagementDetail>(
      `/providers/dashboard/students/${clientId}`,
      {
        token
      }
    );
  },
  upsertStudentPhysicalAssessment(
    token: string,
    clientId: string,
    input: {
      weight?: string;
      height?: string;
      imc?: string;
      bodyFatPercent?: string;
      muscleMass?: string;
      circumferences?: string;
      waist?: string;
      hip?: string;
      chest?: string;
      arm?: string;
      thigh?: string;
    }
  ) {
    return apiRequest<ProviderStudentPhysicalAssessment>(
      `/providers/dashboard/students/${clientId}/physical-assessment`,
      {
        method: "PUT",
        token,
        body: input
      }
    );
  },
  getStudentAnamnesis(token: string, clientId: string) {
    return apiRequest<StudentAnamnesisResponse>(
      `/providers/dashboard/students/${clientId}/anamnesis`,
      { token }
    );
  },
  getTimeline(token: string) {
    return apiRequest<ProviderTimelineResponse>("/providers/me/timeline", { token });
  },
};

export const availabilityApi = {
  me(token: string) {
    return apiRequest<Availability[]>("/availability/me", { token });
  },
  create(
    token: string,
    body: { weekday: number; startTime: string; endTime: string; isActive?: boolean }
  ) {
    return apiRequest<Availability>("/availability", { method: "POST", token, body });
  },
  delete(token: string, availabilityId: string) {
    return apiRequest<void>(`/availability/${availabilityId}`, { method: "DELETE", token });
  }
};

export type ProviderManualBlock = {
  id: string;
  providerId: string;
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  location?: string | null;
  createdAt: string;
  updatedAt: string;
};

export const manualBlocksApi = {
  list(token: string) {
    return apiRequest<ProviderManualBlock[]>("/manual-blocks", { token });
  },
  create(
    token: string,
    body: { date: string; startTime: string; endTime: string; label: string; location?: string }
  ) {
    return apiRequest<ProviderManualBlock>("/manual-blocks", { method: "POST", token, body });
  },
  delete(token: string, blockId: string) {
    return apiRequest<void>(`/manual-blocks/${blockId}`, { method: "DELETE", token });
  },
};

export const bookingsApi = {
  me(token: string) {
    return apiRequest<Booking[]>("/bookings/me", { token });
  },
  create(
    token: string,
    body: {
      providerId: string;
      categoryId: string;
      scheduledAt: string;
      offerId?: string;
      paymentMethod?: PaymentMethod;
      notes?: string;
      sessionLocation?: string;
      clientLatitude?: number;
      clientLongitude?: number;
    }
  ) {
    return apiRequest<Booking>("/bookings", { method: "POST", token, body });
  },
  updateStatus(
    token: string,
    bookingId: string,
    status: "CONFIRMED" | "CANCELLED" | "COMPLETED",
    completionProof?: CompletionProofInput
  ) {
    return apiRequest<Booking>(`/bookings/${bookingId}/status`, {
      method: "PATCH",
      token,
      body: {
        status,
        ...(completionProof ? { completionProof } : {})
      }
    });
  },
  attendanceCode(token: string, bookingId: string) {
    return apiRequest<AttendanceCodeResponse>(`/bookings/${bookingId}/attendance-code`, {
      token
    });
  },
  verifyAttendanceCode(token: string, bookingId: string, code: string) {
    return apiRequest<{
      bookingId: string;
      validated: boolean;
      validatedAt?: string | null;
    }>(`/bookings/${bookingId}/attendance-code/verify`, {
      method: "POST",
      token,
      body: { code }
    });
  },
  verifyAttendanceQr(token: string, bookingId: string, qrToken: string) {
    return apiRequest<{
      bookingId: string;
      validated: boolean;
      validatedAt?: string | null;
    }>(`/bookings/${bookingId}/attendance-code/verify-qr`, {
      method: "POST",
      token,
      body: { qrToken }
    });
  },
  reportNoShow(token: string, bookingId: string, reportReason?: string) {
    return apiRequest<Booking>(`/bookings/${bookingId}/report-no-show`, {
      method: "POST",
      token,
      body: { reportReason }
    });
  },
  contestNoShow(token: string, bookingId: string, contestReason?: string) {
    return apiRequest<{
      id: string;
      bookingId: string;
      reportedUserId: string;
      reportedByUserId: string;
      status: "PENDING" | "CONTESTED" | "RESOLVED";
      contestDeadlineAt: string;
      contestedAt: string | null;
      resolvedAt: string | null;
    }>(`/bookings/${bookingId}/contest-no-show`, {
      method: "POST",
      token,
      body: { contestReason }
    });
  },
  contestAutoCapture(token: string, bookingId: string, reason?: string) {
    return apiRequest<unknown>(`/bookings/${bookingId}/contest-auto-capture`, {
      method: "POST",
      token,
      body: { reason }
    });
  }
};

export type ChatMessage = {
  id: string;
  senderId: string | null;
  isSystem?: boolean;
  content: string;
  readAt: string | null;
  createdAt: string;
};

export type ChatSummary = {
  bookingId: string;
  bookingStatus: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  isOpen: boolean;
  otherUser: { name: string; photoUrl?: string | null };
  clientId: string;
  lastMessage: {
    content: string;
    createdAt: string;
    isMine: boolean;
    isSystem: boolean;
  };
  unreadCount: number;
};

export type ChatMessagesResponse = {
  messages: ChatMessage[];
  isOpen: boolean;
  otherUser: { name: string; photoUrl?: string | null };
};

export type ChatOtherUserResponse = {
  name: string;
  photoUrl?: string | null;
};

export const chatApi = {
  myChats(token: string) {
    return apiRequest<ChatSummary[]>("/bookings/me/chats", { token });
  },
  getOtherUser(token: string, bookingId: string) {
    return apiRequest<ChatOtherUserResponse>(`/bookings/${bookingId}/other-user`, { token });
  },
  getMessages(token: string, bookingId: string) {
    return apiRequest<ChatMessagesResponse>(`/bookings/${bookingId}/messages`, { token });
  },
  sendMessage(token: string, bookingId: string, content: string) {
    return apiRequest<ChatMessage>(`/bookings/${bookingId}/messages`, {
      method: "POST",
      token,
      body: { content }
    });
  }
};

export const reviewsApi = {
  create(
    token: string,
    body: {
      bookingId: string;
      rating: number;
      comment?: string;
    }
  ) {
    return apiRequest<unknown>("/reviews", { method: "POST", token, body });
  },
  respond(token: string, reviewId: string, response: string) {
    return apiRequest<unknown>(`/reviews/${reviewId}/response`, {
      method: "PATCH",
      token,
      body: { response }
    });
  }
};

export const favoritesApi = {
  list(token: string) {
    return apiRequest<Favorite[]>("/favorites", { token });
  },
  add(token: string, providerId: string) {
    return apiRequest<Favorite>("/favorites", { method: "POST", token, body: { providerId } });
  },
  remove(token: string, providerId: string) {
    return apiRequest<void>(`/favorites/${providerId}`, { method: "DELETE", token });
  }
};

export const paymentsApi = {
  customerStatus(token: string) {
    return apiRequest<CustomerPaymentStatus>("/payments/customer", { token });
  },
  createCustomerSetupIntent(token: string) {
    return apiRequest<CustomerSetupIntent>("/payments/customer/setup-intent", {
      method: "POST",
      token,
      body: {}
    });
  },
  confirmCustomerSetupIntent(token: string, setupIntentId: string) {
    return apiRequest<void>("/payments/customer/setup-intent/confirm", {
      method: "POST",
      token,
      body: { setupIntentId }
    });
  },
  confirmCustomerSetupIntentWithMetadata(
    token: string,
    input: {
      setupIntentId?: string;
      cardToken?: string;
      nickname?: string;
      makeDefault?: boolean;
    }
  ) {
    return apiRequest<void>("/payments/customer/setup-intent/confirm", {
      method: "POST",
      token,
      body: input
    });
  },
  listCustomerCards(token: string) {
    return apiRequest<CustomerCardSummary[]>("/payments/customer/cards", { token });
  },
  updateCustomerCardNickname(token: string, cardId: string, nickname: string) {
    return apiRequest<CustomerCardSummary[]>(`/payments/customer/cards/${cardId}`, {
      method: "PATCH",
      token,
      body: { nickname }
    });
  },
  setCustomerCardDefault(token: string, cardId: string) {
    return apiRequest<CustomerCardSummary[]>(`/payments/customer/cards/${cardId}/default`, {
      method: "PATCH",
      token,
      body: {}
    });
  },
  removeCustomerCard(token: string, cardId: string) {
    return apiRequest<CustomerCardSummary[]>(`/payments/customer/cards/${cardId}`, {
      method: "DELETE",
      token
    });
  },
  selectBookingPaymentMethod(
    token: string,
    bookingId: string,
    input: {
      method: "CARD" | "PIX";
      customerCardId?: string;
    }
  ) {
    return apiRequest<PaymentStatusResponse>(`/payments/booking/${bookingId}/method`, {
      method: "PATCH",
      token,
      body: input
    });
  },
  setupCustomer(token: string, paymentMethodId: string) {
    return apiRequest<void>("/payments/customer/setup", {
      method: "POST",
      token,
      body: { paymentMethodId }
    });
  },
  createProviderAccount(
    token: string,
    body?: {
      returnUrl?: string;
      refreshUrl?: string;
    }
  ) {
    return apiRequest<ProviderAccountCreate>("/payments/provider/account", {
      method: "POST",
      token,
      body: body ?? {}
    });
  },
  createOnboardingLink(
    token: string,
    body?: {
      returnUrl?: string;
      refreshUrl?: string;
    }
  ) {
    return apiRequest<ProviderAccountCreate>("/payments/provider/account/onboarding-link", {
      method: "POST",
      token,
      body: body ?? {}
    });
  },
  providerStatus(token: string) {
    return apiRequest<ProviderAccountStatus>("/payments/provider/account", { token });
  },
  bookingPayment(token: string, bookingId: string) {
    return apiRequest<PaymentStatusResponse>(`/payments/booking/${bookingId}`, { token });
  },
  createPixCharge(token: string, bookingId: string) {
    return apiRequest<PixChargeResponse>(`/payments/booking/${bookingId}/pix/charge`, {
      method: "POST",
      token,
      body: {}
    });
  }
};

// ─── Financial Management ─────────────────────────────────────────────────

export type FinancialStudentType = "PRESENTIAL" | "ONLINE" | "APP" | "BOTH";
export type FinancialExpenseCategory =
  | "GYM" | "TRANSPORT" | "EQUIPMENT" | "MARKETING"
  | "FORMATION" | "SOFTWARE" | "PROFESSIONAL_SERVICES" | "RENT" | "UNIFORM" | "NUTRITION"
  | "OTHER";

export type WeeklyScheduleSlot = {
  dayOfWeek: number; // 0=domingo, 1=segunda, ..., 6=sábado
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
};

export type FinancialRecurrence = "RECURRING" | "ONE_TIME";

export type FinancialStudent = {
  id: string;
  providerId: string;
  name: string;
  monthlyValueCents: number;
  type: FinancialStudentType;
  weeklyFrequency: number;
  isActive: boolean;
  paymentDueDay?: number | null;
  notes?: string | null;
  location?: string | null;
  weeklySchedule?: WeeklyScheduleSlot[] | null;
  recurrence: FinancialRecurrence;
  startDate: string;
  recurrenceEndDate?: string | null;
  /** calculado pelo backend: esse aluno "cobra" no mês atual? */
  billableThisMonth: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FinancialIncome = {
  id: string;
  providerId: string;
  studentId?: string | null;
  description: string;
  amountCents: number;
  source: string;
  paidAt: string;
  recurrence: FinancialRecurrence;
  recurrenceEndDate?: string | null;
  /** true quando é uma projeção de um lançamento recorrente de mês anterior (não editável diretamente) */
  isVirtual?: boolean;
  createdAt: string;
  student?: { id: string; name: string } | null;
};

export type FinancialExpense = {
  id: string;
  providerId: string;
  description: string;
  amountCents: number;
  category: FinancialExpenseCategory;
  paidAt: string;
  recurrence: FinancialRecurrence;
  recurrenceEndDate?: string | null;
  isVirtual?: boolean;
  createdAt: string;
};

export type FinancialGoal = {
  id: string;
  providerId: string;
  month: string;
  targetRevenueCents?: number | null;
  targetStudents?: number | null;
  targetWeeklyClasses?: number | null;
};

export type FinancialClassSession = {
  id: string;
  providerId: string;
  studentId?: string | null;
  date: string;
  notes?: string | null;
  createdAt: string;
  student?: { id: string; name: string } | null;
};

export type FinancialDashboard = {
  month: string;
  /** receitas manuais ? fora do app (aba Receitas) */
  totalRevenueCents: number;
  /** receitas realizadas pelo app ? agendamentos COMPLETED */
  appRevenueCents: number;
  /** receita prevista - agendamentos CONFIRMED ainda nao entregues */
  confirmedRevenueCents: number;
  totalExpensesCents: number;
  netProfitCents: number;
  growthPct: number | null;
  activeStudents: number;
  totalClassesThisMonth: number;
  avgClassesPerDay: number;
  weeklyClasses: number;
  ticketMedioCents: number;
  goal: FinancialGoal | null;
  dailyRevenue: Record<string, number>;
};

export type FinancialReport = {
  months: Array<{
    month: string;
    revenueCents: number;
    appRevenueCents: number;
    expensesCents: number;
    netCents: number;
    classes: number;
  }>;
  bestMonth: { month: string; revenueCents: number } | null;
  avgRevenueCents: number;
};

/** Cliente que comprou servico diretamente pelo app (agrupado por cliente/mes) */
export type FinancialAppClient = {
  clientId: string;
  name: string;
  /** sessoes concluidas + consultorias pagas - receita realizada */
  completedCents: number;
  /** sessoes agendadas (CONFIRMED) - receita prevista */
  confirmedCents: number;
  sessionCount: number;
  confirmedSessionCount: number;
  /** consultorias com pagamento capturado neste periodo */
  contractCount: number;
  services: string[];
  latestAt: string;
};

export type FinancialPayoutItem = {
  id: string;
  type: "PRESENTIAL" | "CONSULTANCY";
  bookingId: string | null;
  amountCents: number;
  providerAmountCents: number;
  platformFeeCents: number;
  method: string;
  status: string;
  capturedAt: string | null;
  scheduledAt: string | null;
};

export type FinancialPayouts = {
  pendingCents: number;
  availableCents: number;
  payments: FinancialPayoutItem[];
};

export const financialApi = {
  dashboard(token: string, month?: string) {
    const q = month ? `?month=${month}` : "";
    return apiRequest<FinancialDashboard>(`/financial/dashboard${q}`, { token });
  },
  report(token: string, months = 6) {
    return apiRequest<FinancialReport>(`/financial/report?months=${months}`, { token });
  },
  payouts(token: string) {
    return apiRequest<FinancialPayouts>("/financial/payouts", { token });
  },
  listAppClients(token: string, month?: string) {
    const q = month ? `?month=${month}` : "";
    return apiRequest<FinancialAppClient[]>(`/financial/app-clients${q}`, { token });
  },
  listStudents(token: string) {
    return apiRequest<FinancialStudent[]>("/financial/students", { token });
  },
  createStudent(token: string, body: { name: string; monthlyValueCents: number; type: FinancialStudentType; weeklyFrequency?: number; paymentDueDay?: number; notes?: string; location?: string; weeklySchedule?: WeeklyScheduleSlot[]; recurrence?: FinancialRecurrence; startDate?: string; recurrenceEndDate?: string | null }) {
    return apiRequest<FinancialStudent>("/financial/students", { method: "POST", token, body });
  },
  updateStudent(token: string, id: string, body: Partial<{ name: string; monthlyValueCents: number; type: FinancialStudentType; weeklyFrequency: number; isActive: boolean; paymentDueDay: number | null; notes: string; location: string; weeklySchedule: WeeklyScheduleSlot[]; recurrence: FinancialRecurrence; startDate: string; recurrenceEndDate: string | null }>) {
    return apiRequest<FinancialStudent>(`/financial/students/${id}`, { method: "PATCH", token, body });
  },
  deleteStudent(token: string, id: string) {
    return apiRequest<void>(`/financial/students/${id}`, { method: "DELETE", token });
  },
  listIncomes(token: string, month?: string) {
    const q = month ? `?month=${month}` : "";
    return apiRequest<FinancialIncome[]>(`/financial/incomes${q}`, { token });
  },
  createIncome(token: string, body: { description: string; amountCents: number; studentId?: string; paidAt: string; recurrence?: FinancialRecurrence; recurrenceEndDate?: string | null }) {
    return apiRequest<FinancialIncome>("/financial/incomes", { method: "POST", token, body });
  },
  updateIncome(token: string, id: string, body: { description?: string; amountCents?: number; studentId?: string | null; paidAt?: string; recurrence?: FinancialRecurrence; recurrenceEndDate?: string | null; occurrenceMonth?: string }) {
    return apiRequest<FinancialIncome>(`/financial/incomes/${id}`, { method: "PATCH", token, body });
  },
  deleteIncome(token: string, id: string) {
    return apiRequest<void>(`/financial/incomes/${id}`, { method: "DELETE", token });
  },
  listExpenses(token: string, month?: string) {
    const q = month ? `?month=${month}` : "";
    return apiRequest<FinancialExpense[]>(`/financial/expenses${q}`, { token });
  },
  createExpense(token: string, body: { description: string; amountCents: number; category?: FinancialExpenseCategory; paidAt: string; recurrence?: FinancialRecurrence; recurrenceEndDate?: string | null }) {
    return apiRequest<FinancialExpense>("/financial/expenses", { method: "POST", token, body });
  },
  updateExpense(token: string, id: string, body: { description?: string; amountCents?: number; category?: FinancialExpenseCategory; paidAt?: string; recurrence?: FinancialRecurrence; recurrenceEndDate?: string | null; occurrenceMonth?: string }) {
    return apiRequest<FinancialExpense>(`/financial/expenses/${id}`, { method: "PATCH", token, body });
  },
  deleteExpense(token: string, id: string) {
    return apiRequest<void>(`/financial/expenses/${id}`, { method: "DELETE", token });
  },
  getGoal(token: string, month?: string) {
    const q = month ? `?month=${month}` : "";
    return apiRequest<FinancialGoal | null>(`/financial/goals${q}`, { token });
  },
  upsertGoal(token: string, body: { month: string; targetRevenueCents?: number; targetStudents?: number; targetWeeklyClasses?: number }) {
    return apiRequest<FinancialGoal>("/financial/goals", { method: "PUT", token, body });
  },
  listSessions(token: string, month?: string) {
    const q = month ? `?month=${month}` : "";
    return apiRequest<FinancialClassSession[]>(`/financial/sessions${q}`, { token });
  },
  createSession(token: string, body: { studentId?: string; date: string; notes?: string }) {
    return apiRequest<FinancialClassSession>("/financial/sessions", { method: "POST", token, body });
  },
  deleteSession(token: string, id: string) {
    return apiRequest<void>(`/financial/sessions/${id}`, { method: "DELETE", token });
  }
};

export const notificationsApi = {
  inbox(token: string, take = 100) {
    return apiRequest<NotificationInboxItem[]>(`/notifications/inbox?take=${take}`, {
      token
    });
  },
  unreadCount(token: string) {
    return apiRequest<{ unread: number }>("/notifications/inbox/unread-count", { token });
  },
  markAllRead(token: string) {
    return apiRequest<void>("/notifications/inbox/read-all", {
      method: "PATCH",
      token,
      body: {}
    });
  },
  listDevices(token: string) {
    return apiRequest<PushDevice[]>("/notifications/devices", { token });
  },
  registerDevice(
    token: string,
    body: {
      token: string;
      platform?: "ios" | "android" | "web" | "unknown";
      appVersion?: string;
      deviceName?: string;
    }
  ) {
    return apiRequest<PushDevice>("/notifications/devices", { method: "POST", token, body });
  },
  unregisterDevice(token: string, pushToken: string) {
    return apiRequest<void>("/notifications/devices", {
      method: "DELETE",
      token,
      body: { token: pushToken }
    });
  }
};

export const consultancyApi = {
  promotions() {
    return apiRequest<PromotionFeedItem[]>("/consultancy/promotions");
  },
  providerCatalog(providerId: string) {
    return apiRequest<ProviderConsultancyCatalog>(`/consultancy/providers/${providerId}/catalog`);
  },
  myTraining(token: string) {
    return apiRequest<MyTrainingResponse>("/consultancy/my/training", { token });
  },
  completeTrainingPlan(token: string, trainingPlanId: string, notes?: string) {
    return apiRequest<TrainingPlanCompletion>(`/consultancy/my/training/plans/${trainingPlanId}/complete`, {
      method: "POST",
      token,
      body: { notes }
    });
  },
  myTrainingCompletions(token: string) {
    return apiRequest<TrainingPlanCompletion[]>("/consultancy/my/training/completions", { token });
  },
  myRequests(token: string) {
    return apiRequest<ConsultancyRequest[]>("/consultancy/my/requests", { token });
  },
  myArchivedRequests(
    token: string,
    params?: {
      status?: "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED";
    }
  ) {
    const query = new URLSearchParams();
    if (params?.status) {
      query.set("status", params.status);
    }
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<ConsultancyRequest[]>(`/consultancy/my/requests/archived${suffix}`, {
      token
    });
  },
  createRequest(
    token: string,
    body: {
      providerId: string;
      quotedOfferId?: string;
      trainingNeedText?: string;
      limitationText?: string;
      extraInfoText?: string;
    }
  ) {
    return apiRequest<ConsultancyRequest>("/consultancy/requests", {
      method: "POST",
      token,
      body
    });
  },
  decideRequest(
    token: string,
    requestId: string,
    body: {
      decision: "ACCEPT" | "REFUSE";
      paymentMethod?: ConsultancyPaymentMethod;
      acknowledgedImmediateExecution?: boolean;
    }
  ) {
    return apiRequest<{ request: ConsultancyRequest; contract: ConsultancyContract | null }>(
      `/consultancy/requests/${requestId}/decision`,
      {
        method: "POST",
        token,
        body
      }
    );
  },
  cancelContract(token: string, contractId: string) {
    return apiRequest<ConsultancyContract>(`/consultancy/contracts/${contractId}/cancel`, {
      method: "POST",
      token
    });
  },
  contestDelivery(token: string, contractId: string, reason?: string) {
    return apiRequest<unknown>(`/consultancy/contracts/${contractId}/contest-delivery`, {
      method: "POST",
      token,
      body: { reason }
    });
  },
  providerRequests(token: string) {
    return apiRequest<ConsultancyRequest[]>("/consultancy/provider/requests", { token });
  },
  providerArchivedRequests(
    token: string,
    params?: {
      status?: "ALL" | "REFUSED" | "EXPIRED_REFUNDED" | "ARCHIVED";
    }
  ) {
    const query = new URLSearchParams();
    if (params?.status) {
      query.set("status", params.status);
    }
    const suffix = query.toString() ? `?${query}` : "";
    return apiRequest<ConsultancyRequest[]>(
      `/consultancy/provider/requests/archived${suffix}`,
      {
        token
      }
    );
  },
  upsertProviderSettings(
    token: string,
    body: {
      enabled: boolean;
    }
  ) {
    return apiRequest<{
      id: string;
      enabled: boolean;
      providerId: string;
    }>("/consultancy/provider/settings", {
      method: "PUT",
      token,
      body
    });
  },
  providerSettings(token: string) {
    return apiRequest<{
      id: string | null;
      enabled: boolean;
      providerId: string;
    }>("/consultancy/provider/settings", {
      token
    });
  },
  providerOffers(token: string) {
    return apiRequest<ProviderServiceOffer[]>("/consultancy/provider/offers", { token });
  },
  createProviderOffer(
    token: string,
    body: {
      kind: ServiceOfferKind;
      title: string;
      billingCycle: OfferBillingCycle;
      daysPerWeek?: number;
      comboPresentialDaysPerWeek?: number;
      comboOnlineDaysPerWeek?: number;
      priceCents: number;
      isPromotion?: boolean;
      promotionPriceCents?: number;
      promotionEndsAt?: string;
      promotionLabel?: string;
      isActive?: boolean;
      presentialPackageMode?: PresentialPackageMode;
      presentialHasFixedTerm?: boolean;
      presentialTotalCycles?: number;
      presentialSessionsPerCycle?: number;
      comboPresentialShareCents?: number;
      comboConsultancyShareCents?: number;
    }
  ) {
    return apiRequest<ProviderServiceOffer>("/consultancy/provider/offers", {
      method: "POST",
      token,
      body
    });
  },
  updateProviderOffer(
    token: string,
    offerId: string,
    body: {
      title?: string;
      priceCents?: number;
      daysPerWeek?: number;
      comboPresentialDaysPerWeek?: number;
      comboOnlineDaysPerWeek?: number;
      isPromotion?: boolean;
      promotionPriceCents?: number;
      promotionEndsAt?: string;
      promotionLabel?: string;
      isActive?: boolean;
      presentialPackageMode?: PresentialPackageMode | null;
      presentialHasFixedTerm?: boolean;
      presentialTotalCycles?: number | null;
      presentialSessionsPerCycle?: number | null;
      comboPresentialShareCents?: number | null;
      comboConsultancyShareCents?: number | null;
    }
  ) {
    return apiRequest<ProviderServiceOffer>(`/consultancy/provider/offers/${offerId}`, {
      method: "PATCH",
      token,
      body
    });
  },
  deleteProviderOffer(token: string, offerId: string) {
    return apiRequest<void>(`/consultancy/provider/offers/${offerId}`, {
      method: "DELETE",
      token
    });
  },
  providerPlans(token: string) {
    return apiRequest<TrainingPlan[]>("/consultancy/provider/plans", { token });
  },
  createProviderPlan(
    token: string,
    body: {
      title: string;
      description?: string;
      isPrebuilt?: boolean;
      exercises: Array<{
        sortOrder?: number;
        exerciseId?: string;
        name: string;
        repetitionsSets: string;
        load: string;
        restSeconds?: number;
        restLabel?: string;
        demoVideoUrl?: string;
      }>;
    }
  ) {
    return apiRequest<TrainingPlan>("/consultancy/provider/plans", {
      method: "POST",
      token,
      body
    });
  },
  updateProviderPlan(
    token: string,
    planId: string,
    body: Partial<{
      title: string;
      description?: string;
      isActive: boolean;
      validUntil: string;
      exercises: Array<{
        sortOrder?: number;
        exerciseId?: string;
        name: string;
        repetitionsSets: string;
        load: string;
        restSeconds?: number;
        restLabel?: string;
        demoVideoUrl?: string;
      }>;
    }>
  ) {
    return apiRequest<TrainingPlan>(`/consultancy/provider/plans/${planId}`, {
      method: "PATCH",
      token,
      body
    });
  },
  deleteProviderPlan(token: string, planId: string) {
    return apiRequest<void>(`/consultancy/provider/plans/${planId}`, {
      method: "DELETE",
      token
    });
  },
  deliverContract(
    token: string,
    contractId: string,
    body: {
      title: string;
      description?: string;
      validUntil?: string;
      exercises: Array<{
        sortOrder?: number;
        exerciseId?: string;
        name: string;
        repetitionsSets: string;
        load: string;
        restLabel?: string;
        demoVideoUrl?: string;
      }>;
    }
  ) {
    return apiRequest<TrainingPlan>(`/consultancy/contracts/${contractId}/deliver`, {
      method: "POST",
      token,
      body
    });
  },
  respondRequest(
    token: string,
    requestId: string,
    body: {
      providerResponseText: string;
      quotedOfferId: string;
    }
  ) {
    return apiRequest<ConsultancyRequest>(`/consultancy/requests/${requestId}/respond`, {
      method: "POST",
      token,
      body
    });
  }
};

// ── Tipos Community ────────────────────────────────────────────────────────────
export type CommunityUser = {
  id: string;
  name: string;
  apelido?: string | null;
  photoUrl?: string | null;
  isFollowing?: boolean;
  followedAt?: string;
};

export type UserPublicProfile = {
  id: string;
  name: string;
  apelido?: string | null;
  photoUrl?: string | null;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  totalXp: number;
  currentLevel: number;
  levelName: string;
  currentStreak: number;
  longestStreak: number;
};

export type RankingEntry = {
  position: number;
  userId: string;
  name: string | null;
  apelido?: string | null;
  photoUrl?: string | null;
  xpEarned: number;
  isViewer: boolean;
};

export type RankingResponse = {
  items: RankingEntry[];
  viewerPosition: number | null;
  viewerXp: number;
  total: number;
  page: number;
  totalPages: number;
  period: "WEEKLY" | "MONTHLY" | "ALLTIME";
  periodKey: string;
};

export type FeedPostMetadata = {
  type?: "PRESENTIAL" | "ONLINE";
  providerId?: string;
  providerName?: string;
  providerPhotoUrl?: string | null;
  [key: string]: unknown;
};

export type FeedPost = {
  id: string;
  userId: string;
  type: string;
  referenceId?: string | null;
  imageUrl?: string | null;
  caption?: string | null;
  metadata?: FeedPostMetadata | null;
  createdAt: string;
  user?: { id: string; name: string; apelido?: string | null; photoUrl?: string | null };
  likesCount?: number;
  commentsCount?: number;
  likedByViewer?: boolean;
};

export type FeedComment = {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string; photoUrl?: string | null };
};

export type GamificationProfile = {
  totalXp: number;
  currentLevel: number;
  levelName: string;
  nextLevelMinXp: number | null;
  xpToNextLevel: number | null;
  currentStreak: number;
  longestStreak: number;
  weeklyXp: number;
  monthlyXp: number;
  unlockedAchievements?: Array<{
    id: string;
    achievement: { key: string; name: string; medalType: string; xpReward: number };
    unlockedAt: string;
  }>;
};

// ── presentialPackagesApi ────────────────────────────────────────────────────
export type PresentialPackageStatus = "PENDING_PAYMENT" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";

export type PresentialPackageWeeklyScheduleSlot = { weekday: number; time: string };

export type PresentialPackageCycle = {
  id: string;
  packageId: string;
  cycleIndex: number;
  amountCents: number;
  providerAmountCents: number;
  platformAmountCents: number;
  sessionsGranted: number;
  mpPaymentId?: string | null;
  capturedAt: string;
  periodStart: string;
  periodEnd: string;
};

export type PresentialPackage = {
  id: string;
  providerId: string;
  clientId: string;
  offerId: string;
  categoryId: string;
  consultancyContractId?: string | null;
  mode: PresentialPackageMode;
  status: PresentialPackageStatus;
  paymentMethod?: ConsultancyPaymentMethod | null;
  cycleAmountCents: number;
  billingCycle: OfferBillingCycle;
  sessionsPerCycle: number;
  weeklySchedule?: PresentialPackageWeeklyScheduleSlot[] | null;
  hasFixedTerm: boolean;
  totalCycles?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  cancelledAt?: string | null;
  nextCycleIndex: number;
  nextBillingAt?: string | null;
  consecutiveFailedCycles: number;
  creditsRemainingThisCycle: number;
  lastBillingFailureReason?: string | null;
  pendingChargePixQrCodeUrl?: string | null;
  pendingChargePixCopyPasteCode?: string | null;
  pendingChargePixExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  offer?: ProviderServiceOffer;
  provider?: { displayName: string; photoUrl?: string | null };
  client?: { id: string; name: string; photoUrl?: string | null };
  cycles?: PresentialPackageCycle[];
};

export type PresentialPackageChargeResult =
  | { status: "CAPTURED" }
  | {
      status: "PENDING";
      method?: "PIX";
      pix: { qrCodeUrl: string | null; copyAndPasteCode: string | null; hostedInstructionsUrl: string | null } | null;
    }
  | { status: "FAILED" };

export type PurchasePresentialPackageResponse = {
  package: PresentialPackage;
  payment: PresentialPackageChargeResult;
};

export type PurchaseComboResponse = {
  contract: unknown;
  package: PresentialPackage;
  consultancyPayment: PresentialPackageChargeResult;
  presentialPayment: PresentialPackageChargeResult;
};

export const presentialPackagesApi = {
  purchase(
    token: string,
    body: {
      offerId: string;
      categoryId: string;
      paymentMethod: "CREDIT_CARD" | "PIX";
      weeklySchedule?: PresentialPackageWeeklyScheduleSlot[];
    }
  ) {
    return apiRequest<PurchasePresentialPackageResponse>("/presential-packages", {
      method: "POST",
      token,
      body
    });
  },
  purchaseCombo(
    token: string,
    body: {
      offerId: string;
      categoryId: string;
      paymentMethod: "CREDIT_CARD" | "PIX";
      weeklySchedule?: PresentialPackageWeeklyScheduleSlot[];
      acknowledgedImmediateExecution?: boolean;
    }
  ) {
    return apiRequest<PurchaseComboResponse>("/presential-packages/combo", {
      method: "POST",
      token,
      body
    });
  },
  my(token: string) {
    return apiRequest<PresentialPackage[]>("/presential-packages/my", { token });
  },
  providerList(token: string) {
    return apiRequest<PresentialPackage[]>("/presential-packages/provider/my", { token });
  },
  detail(token: string, packageId: string) {
    return apiRequest<PresentialPackage>(`/presential-packages/${packageId}`, { token });
  },
  cancel(token: string, packageId: string) {
    return apiRequest<PresentialPackage>(`/presential-packages/${packageId}/cancel`, {
      method: "POST",
      token
    });
  }
};

// ── communityApi ───────────────────────────────────────────────────────────────
export const communityApi = {
  follow(token: string, userId: string) {
    return apiRequest<void>(`/community/follow/${userId}`, { method: "POST", token });
  },
  unfollow(token: string, userId: string) {
    return apiRequest<void>(`/community/follow/${userId}`, { method: "DELETE", token });
  },
  getFollowers(token: string, page = 1, limit = 20) {
    return apiRequest<{ items: CommunityUser[]; total: number; page: number; totalPages: number }>(
      `/community/followers?page=${page}&limit=${limit}`,
      { token }
    );
  },
  getFollowing(token: string, page = 1, limit = 20) {
    return apiRequest<{ items: CommunityUser[]; total: number; page: number; totalPages: number }>(
      `/community/following?page=${page}&limit=${limit}`,
      { token }
    );
  },
  searchUsers(token: string, query: string, page = 1, limit = 20) {
    return apiRequest<{ items: CommunityUser[]; total: number; page: number; totalPages: number }>(
      `/community/users/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`,
      { token }
    );
  },
  getUserPublicProfile(token: string, userId: string) {
    return apiRequest<UserPublicProfile>(`/community/users/${userId}`, { token });
  },
  getRanking(token: string, period: "WEEKLY" | "MONTHLY" | "ALLTIME" = "WEEKLY", page = 1, limit = 50) {
    return apiRequest<RankingResponse>(
      `/community/ranking?period=${period}&page=${page}&limit=${limit}`,
      { token }
    );
  },
  getFeed(token: string, page = 1, limit = 20) {
    return apiRequest<{ items: FeedPost[]; total: number; page: number; totalPages: number }>(
      `/community/feed?page=${page}&limit=${limit}`,
      { token }
    );
  },
  createPost(token: string, body: { imageUrl?: string; caption?: string }) {
    return apiRequest<void>(`/community/feed/posts`, { method: "POST", token, body });
  },
  deletePost(token: string, postId: string) {
    return apiRequest<void>(`/community/feed/posts/${postId}`, { method: "DELETE", token });
  },
  likePost(token: string, postId: string) {
    return apiRequest<{ liked: boolean }>(`/community/feed/posts/${postId}/like`, { method: "POST", token });
  },
  getComments(token: string, postId: string, page = 1, limit = 5) {
    return apiRequest<{ items: FeedComment[]; total: number; page: number; totalPages: number }>(
      `/community/feed/posts/${postId}/comments?page=${page}&limit=${limit}`,
      { token }
    );
  },
  addComment(token: string, postId: string, content: string) {
    return apiRequest<FeedComment>(`/community/feed/posts/${postId}/comments`, {
      method: "POST",
      token,
      body: { content },
    });
  },
  deleteComment(token: string, postId: string, commentId: string) {
    return apiRequest<void>(`/community/feed/posts/${postId}/comments/${commentId}`, {
      method: "DELETE",
      token,
    });
  },
  editComment(token: string, postId: string, commentId: string, content: string) {
    return apiRequest<FeedComment>(`/community/feed/posts/${postId}/comments/${commentId}`, {
      method: "PATCH",
      token,
      body: { content },
    });
  },
  getSuggestions(token: string, limit = 10) {
    return apiRequest<CommunityUser[]>(`/community/suggestions?limit=${limit}`, { token });
  },
};

// ── gamificationApi ────────────────────────────────────────────────────────────
export const gamificationApi = {
  getMyProfile(token: string) {
    return apiRequest<GamificationProfile>("/gamification/me", { token });
  },
  getAchievements(token: string) {
    return apiRequest<Array<{
      id: string;
      key: string;
      name: string;
      description: string;
      category: string;
      medalType: string;
      xpReward: number;
      conditionType: string;
      conditionValue: number;
      unlockedAt?: string | null;
    }>>("/gamification/achievements", { token });
  },
};
