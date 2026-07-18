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
  MyTraining: undefined;
  ClientBookings: undefined;
  Favorites: undefined;
  ClientProfile: undefined;
  Community: undefined;
};
export type ProfessionalTabParamList = {
  ProfessionalHome: undefined;
  ProfessionalAgenda: undefined;
  ProfessionalConsultancyCenter: undefined;
  PayoutStatus: undefined;
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
    minRating?: number;
    lat?: number;
    lng?: number;
    maxDistanceKm?: number;
    serviceMode?: import("../services/api/client").ProviderServiceMode;
  } | undefined;
  ClientChatList: undefined;
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
  };
  BookingConfirmation: {
    bookingId: string;
    bookingCount?: number;
    failedCount?: number;
  };
  BookingPaymentStatus: { bookingId?: string } | undefined;
  ClientBookingDetail: { bookingId: string };
  WorkoutCelebration: { bookingId: string; professionalId: string; skipReview?: boolean };
  ReviewProfessional: { bookingId: string; professionalId: string };
  ClientPaymentMethod: undefined;
  ClientSettings: undefined;
  ClientAnamnesis: undefined;
  Notifications: undefined;
  Support: undefined;
  Privacy: undefined;
  Security: undefined;
  GenericError: { title?: string; message?: string } | undefined;
  Offline: undefined;
  FriendsList: undefined;
};
export type ProfessionalStackParamList = {
  ProfessionalTabs: NavigatorScreenParams<ProfessionalTabParamList>;
  PayoutStatus: undefined;
  AnnualReport: undefined;
  ProfessionalCredentials: undefined;
  ProfessionalReviews: undefined;
  ProfessionalSettings: undefined;
  AvailabilityManager: undefined;
  ProfessionalConsultancyCenter: undefined;
  ProfessionalConsultancyOffers: undefined;
  ProfessionalConsultancyRequests: undefined;
  ProfessionalArchivedRequests: undefined;
  ProfessionalChatList: undefined;
  BookingDetailProfessional: { bookingId: string };
  ProfessionalConfirmCompletion: { bookingId: string };
  ConnectPayoutAccount: undefined;
  BookingPaymentStatus: { bookingId: string };
  ProfessionalStudents: undefined;
  FinancialStudents: undefined;
  FinancialHistory: undefined;
  FinancialGoals: undefined;
  ProfessionalStudentDetail: { clientId: string };
  ProfessionalStudentAnamnesis: { clientId: string; clientName: string };
  Notifications: undefined;
  TrainingCreation: { contractId?: string; clientId?: string } | undefined;
  Support: undefined;
  Privacy: undefined;
  Security: undefined;
  GenericError: { title?: string; message?: string } | undefined;
  Offline: undefined;
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
