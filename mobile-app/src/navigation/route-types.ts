import type { NavigatorScreenParams } from '@react-navigation/native';
export type AuthStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  ProfileSelection: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string } | undefined;
  SessionExpired: { reason?: string } | undefined;
  TwoFactor: { challengeToken: string };
};
export type ClientTabParamList = {
  ClientHome: undefined;
  Categories: undefined;
  Promotions: undefined;
  // Frente 9 (segunda camada), Lote 12: notificação de consultoria sempre
  // caía na tab default "Ativos" - sem como abrir direto na "Pendentes"
  // (onde a proposta/pagamento/entrega que gerou o aviso normalmente está).
  MyTraining: { initialTab?: "active" | "pending" | "history" } | undefined;
  ClientBookings: undefined;
  Favorites: undefined;
  ClientProfile: undefined;
  Community: undefined;
};
export type ProfessionalTabParamList = {
  ProfessionalHome: undefined;
  ProfessionalAgenda: undefined;
  ProfessionalConsultancyCenter: undefined;
  PayoutStatus: { openModal?: "income" | "expense" } | undefined;
  Notifications: undefined;
  ProfessionalProfileEditor: undefined;
};
export type ClientStackParamList = {
  ClientTabs: NavigatorScreenParams<ClientTabParamList>;
  ClientBookings: undefined;
  SearchProfessionals: { categoryId?: string; query?: string } | undefined;
  ProfessionalsList: {
    categoryId?: string;
    query?: string;
    objective?: import("../services/api/client").TrainingObjective;
    minRating?: number;
    lat?: number;
    lng?: number;
    maxDistanceKm?: number;
    serviceMode?: import("../services/api/client").ProviderServiceMode;
  } | undefined;
  ClientChatList: { openBookingId?: string; openContractId?: string } | undefined;
  ProfessionalDetail: { professionalId: string };
  ConsultancyRequest: { professionalId: string };
  ArchivedRequests: undefined;
  CreateBooking: {
    professionalId: string;
    offerId?: string;
    offerTitle?: string;
    offerPriceCents?: number;
    offerKind?: import("../services/api/client").ServiceOfferKind;
    isPromotionalOffer?: boolean;
    packageId?: string;
    packageCategoryId?: string;
    packageSessionPriceCents?: number;
    packageSessionsRemaining?: number;
  };
  BuyPresentialPackage: {
    professionalId: string;
    offerId: string;
    offerTitle: string;
    offerKind: import("../services/api/client").ServiceOfferKind;
    billingCycle: import("../services/api/client").OfferBillingCycle;
    cycleAmountCents: number;
    presentialPackageMode: import("../services/api/client").PresentialPackageMode;
    presentialSessionsPerCycle: number;
    presentialHasFixedTerm: boolean;
    presentialTotalCycles?: number | null;
    comboPresentialShareCents?: number | null;
    comboConsultancyShareCents?: number | null;
    acceptsPix?: boolean;
    acceptsCreditCard?: boolean;
    offerServiceMode?: import("../services/api/client").ProviderServiceMode | null;
  };
  MyPresentialPackages: undefined;
  PresentialPackageDetail: { packageId: string };
  MyDebts: undefined;
  MyDisputes: undefined;
  BookingConfirmation: {
    bookingId: string;
    bookingCount?: number;
    failedCount?: number;
  };
  BookingPaymentStatus: { bookingId?: string } | undefined;
  ClientBookingDetail: { bookingId: string };
  WorkoutCelebration: { bookingId: string; professionalId: string; skipReview?: boolean };
  // Frente 9 (segunda camada), Lote 4: avaliação passa a aceitar consultoria
  // online (contractId) além de booking presencial (bookingId).
  ReviewProfessional:
    | { bookingId: string; contractId?: undefined; professionalId: string }
    | { bookingId?: undefined; contractId: string; professionalId: string };
  ClientPaymentMethod: undefined;
  ClientSettings: undefined;
  ClientAnamnesis: undefined;
  Notifications: undefined;
  Support: undefined;
  Privacy: undefined;
  Security: undefined;
  ConnectedDevices: undefined;
  GenericError: { title?: string; message?: string } | undefined;
  FriendsList: undefined;
};
export type ProfessionalStackParamList = {
  ProfessionalTabs: NavigatorScreenParams<ProfessionalTabParamList>;
  PayoutStatus: { openModal?: "income" | "expense" } | undefined;
  AnnualReport: undefined;
  ProfessionalCredentials: undefined;
  ProfessionalReviews: undefined;
  ProfessionalSettings: undefined;
  AvailabilityManager: undefined;
  ProfessionalConsultancyCenter: { initialTab?: "offers" | "requests" } | undefined;
  ProfessionalArchivedRequests: undefined;
  ProfessionalChatList: { openBookingId?: string; openContractId?: string } | undefined;
  BookingDetailProfessional: { bookingId: string };
  ProfessionalConfirmCompletion: { bookingId: string };
  ConnectPayoutAccount: undefined;
  BookingPaymentStatus: { bookingId: string };
  ProfessionalStudents: undefined;
  ProviderDebts: undefined;
  MyDisputes: undefined;
  ProviderPaymentMethod: undefined;
  FinancialStudents: undefined;
  FinancialHistory: undefined;
  FinancialGoals: undefined;
  ProfessionalStudentDetail: { clientId: string };
  ProfessionalStudentAnamnesis: { clientId: string; clientName: string };
  Notifications: undefined;
  TrainingCreation: { contractId?: string; clientId?: string; editPlanId?: string; contractValidUntil?: string } | undefined;
  Support: undefined;
  Privacy: undefined;
  Security: undefined;
  ConnectedDevices: undefined;
  GenericError: { title?: string; message?: string } | undefined;
};

export type AdminStackParamList = {
  AdminHome: undefined;
  AdminCrefValidation: undefined;
  AdminSupport: undefined;
  AdminChatAudit: undefined;
  AdminChatAuditDetail: { bookingId: string };
  AdminConsultas: undefined;
  AdminConsultasBookingDetail: { bookingId: string };
  AdminExercises: undefined;
  AdminDisputes: undefined;
  AdminDebts: undefined;
  AdminWaitlist: undefined;
  AdminUserSearch: { initialQuery?: string } | undefined;
  AdminDisputeDetail: { caseId: string };
  AdminNoShowReports: undefined;
  AdminDataRetention: undefined;
  AdminModeration: undefined;
  Security: undefined;
  ConnectedDevices: undefined;
};

export type RootStackParamList = {
  AuthStack: NavigatorScreenParams<AuthStackParamList>;
  ClientStack: NavigatorScreenParams<ClientStackParamList>;
  ProfessionalStack: NavigatorScreenParams<ProfessionalStackParamList>;
  AdminStack: NavigatorScreenParams<AdminStackParamList>;
};
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
