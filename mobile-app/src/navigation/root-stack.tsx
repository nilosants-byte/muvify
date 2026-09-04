import React, { useEffect, useMemo, useState } from "react";
import {
  NavigationContainer,
  Theme,
  createNavigationContainerRef
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { MvOfflineBanner, MvToastHost } from "../components/mv";
import { addNavigationBreadcrumb } from "../observability/sentry";
import {
  resolveNotificationRoute,
  isBookingNotificationType,
  isConsultancyNotificationType,
  isPresentialPackageNotificationType,
  isPaymentNotificationType
} from "./notification-routing";
import { AdminCrefValidationScreen } from "../screens/admin/AdminCrefValidationScreen";
import { AdminChatAuditDetailScreen } from "../screens/admin/AdminChatAuditDetailScreen";
import { AdminChatAuditScreen } from "../screens/admin/AdminChatAuditScreen";
import { AdminConsultasBookingDetailScreen } from "../screens/admin/AdminConsultasBookingDetailScreen";
import { AdminConsultasScreen } from "../screens/admin/AdminConsultasScreen";
import { AdminDebtsScreen } from "../screens/admin/AdminDebtsScreen";
import { AdminWaitlistScreen } from "../screens/admin/AdminWaitlistScreen";
import { AdminDisputeDetailScreen } from "../screens/admin/AdminDisputeDetailScreen";
import { AdminDisputesScreen } from "../screens/admin/AdminDisputesScreen";
import { AdminUserSearchScreen } from "../screens/admin/AdminUserSearchScreen";
import { AdminNoShowReportsScreen } from "../screens/admin/AdminNoShowReportsScreen";
import { AdminDataRetentionScreen } from "../screens/admin/AdminDataRetentionScreen";
import { AdminModerationScreen } from "../screens/admin/AdminModerationScreen";
import { AdminExercisesScreen } from "../screens/admin/AdminExercisesScreen";
import { AdminHomeScreen } from "../screens/admin/AdminHomeScreen";
import { AdminSupportScreen } from "../screens/admin/AdminSupportScreen";
import MuvifySplash from "../screens/auth/MuvifySplash";
import { AuthOnboardingScreen } from "../screens/auth/AuthOnboardingScreen";
import { AuthLoginScreen } from "../screens/auth/AuthLoginScreen";
import { AuthTwoFactorScreen } from "../screens/auth/AuthTwoFactorScreen";
import { AuthProfileSelectionScreen } from "../screens/auth/AuthProfileSelectionScreen";
import { AuthRegisterScreen } from "../screens/auth/AuthRegisterScreen";
import { ArchivedRequestsScreen } from "../screens/client/ArchivedRequestsScreen";
import { BookingConfirmationScreen } from "../screens/client/BookingConfirmationScreen";
import { BuyPresentialPackageScreen } from "../screens/client/BuyPresentialPackageScreen";
import { ClientAnamnesisScreen } from "../screens/client/ClientAnamnesisScreen";
import { ClientChatListScreen } from "../screens/client/ClientChatListScreen";
import { ClientBookingDetailScreen } from "../screens/client/ClientBookingDetailScreen";
import { ClientBookingsScreen } from "../screens/client/ClientBookingsScreen";
import { WorkoutCelebrationScreen } from "../screens/client/WorkoutCelebrationScreen";
import { ClientPaymentMethodScreen } from "../screens/client/ClientPaymentMethodScreen";
import { ClientSettingsScreen } from "../screens/client/ClientSettingsScreen";
import { ConsultancyRequestScreen } from "../screens/client/ConsultancyRequestScreen";
import { CreateBookingScreen } from "../screens/client/CreateBookingScreen";
import { ForgotPasswordScreen } from "../screens/client/ForgotPasswordScreen";
import { MyPresentialPackagesScreen } from "../screens/client/MyPresentialPackagesScreen";
import { MyDebtsScreen } from "../screens/client/MyDebtsScreen";
import { MyDisputesScreen } from "../screens/client/MyDisputesScreen";
import { PresentialPackageDetailScreen } from "../screens/client/PresentialPackageDetailScreen";
import { ProfessionalDetailScreen } from "../screens/client/ProfessionalDetailScreen";
import { ProfessionalsListScreen } from "../screens/client/ProfessionalsListScreen";
import { ResetPasswordScreen } from "../screens/client/ResetPasswordScreen";
import { ReviewProfessionalScreen } from "../screens/client/ReviewProfessionalScreen";
import { SearchProfessionalsScreen } from "../screens/client/SearchProfessionalsScreen";
import { FriendsListScreen } from "../screens/client/FriendsListScreen";
import { ProviderServicesUpgradeScreen } from "../screens/client/ProviderServicesUpgradeScreen";
import { AddExternalStudentScreen } from "../screens/professional/AddExternalStudentScreen";
import { ExternalStudentInviteCreatedScreen } from "../screens/professional/ExternalStudentInviteCreatedScreen";
import { AvailabilityManagerScreen } from "../screens/professional/AvailabilityManagerScreen";
import { BookingDetailProfessionalScreen } from "../screens/professional/BookingDetailProfessionalScreen";
import { BookingPaymentStatusScreen } from "../screens/professional/BookingPaymentStatusScreen";
import { ConnectPayoutAccountScreen } from "../screens/professional/ConnectPayoutAccountScreen";
import { PayoutStatusScreen } from "../screens/professional/PayoutStatusScreen";
import { ProfessionalArchivedRequestsScreen } from "../screens/professional/ProfessionalArchivedRequestsScreen";
import { ProfessionalConfirmCompletionScreen } from "../screens/professional/ProfessionalConfirmCompletionScreen";
import { ProfessionalConsultancyCenterScreen } from "../screens/professional/ProfessionalConsultancyCenterScreen";
import { ProfessionalCredentialsScreen } from "../screens/professional/ProfessionalCredentialsScreen";
import { ProfessionalReviewsScreen } from "../screens/professional/ProfessionalReviewsScreen";
import { ProfessionalAnnualReportScreen } from "../screens/professional/ProfessionalAnnualReportScreen";
import { FinancialStudentsScreen } from "../screens/professional/FinancialStudentsScreen";
import { FinancialHistoryScreen } from "../screens/professional/FinancialHistoryScreen";
import { FinancialGoalsScreen } from "../screens/professional/FinancialGoalsScreen";
import { ProfessionalSettingsScreen } from "../screens/professional/ProfessionalSettingsScreen";
import { ProfessionalStudentAnamnesisScreen } from "../screens/professional/ProfessionalStudentAnamnesisScreen";
import { ProfessionalStudentDetailScreen } from "../screens/professional/ProfessionalStudentDetailScreen";
import { ProfessionalStudentsScreen } from "../screens/professional/ProfessionalStudentsScreen";
import { ProviderDebtsScreen } from "../screens/professional/ProviderDebtsScreen";
import { ProviderPaymentMethodScreen } from "../screens/professional/ProviderPaymentMethodScreen";
import { MySubscriptionScreen } from "../screens/professional/MySubscriptionScreen";
import { ProfessionalTrainingCreationScreen } from "../screens/professional/ProfessionalTrainingCreationScreen";
import { ProfessionalChatListScreen } from "../screens/professional/ProfessionalChatListScreen";
import { ClaimInviteScreen } from "../screens/shared/ClaimInviteScreen";
import { GenericErrorScreen } from "../screens/shared/GenericErrorScreen";
import { ErrorBoundary, withScreenErrorBoundary } from "../components/ErrorBoundary";
import { NotificationsScreen } from "../screens/shared/NotificationsScreen";
import { OfflineRequiredScreen } from "../screens/shared/OfflineRequiredScreen";
import { ReconsentGateScreen } from "../screens/shared/ReconsentGateScreen";
import { SessionExpiredScreen } from "../screens/shared/SessionExpiredScreen";
import { SupportScreen } from "../screens/shared/SupportScreen";
import { PrivacyScreen } from "../screens/shared/PrivacyScreen";
import { SecurityScreen } from "../screens/shared/SecurityScreen";
import { ConnectedDevicesScreen } from "../screens/shared/ConnectedDevicesScreen";
import { useAppState } from "../state/AppState";
import { useToast } from "../state/ToastState";
import { useSubscriptionGate } from "../state/SubscriptionGateState";
import { SubscriptionRequiredSheet } from "../components/professional/SubscriptionRequiredSheet";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { useConnectivity } from "../state/useConnectivity";
import { useOfflineGate } from "../state/useOfflineGate";
import { darkColors, lightColors } from "../theme/tokens";
import { HeaderBackButton } from "./header-components";
import { ClientTabsNavigator } from "./client-tabs";
import { ProfessionalTabsNavigator } from "./professional-tabs";
import type {
  AdminStackParamList,
  AuthStackParamList,
  ClientStackParamList,
  ProfessionalStackParamList
} from "./route-types";

const OFFLINE_GRACE_MS = 4000;
const navigationRef = createNavigationContainerRef();

// Frente 11 (engenharia mobile), Lote 10: até aqui só existia um
// ErrorBoundary no app inteiro (envolvendo o NavigationContainer, no fim
// deste arquivo) — um erro de render em qualquer tela profunda derrubava a
// pilha de navegação inteira, voltando pro cliente pra tela de erro
// genérica de app inteiro. Pagamento, chat e upload são as áreas de maior
// risco (dependem de dado externo/formatação sensível a variação) e maior
// custo se o usuário perder a tela sem querer (fluxo de pagamento em
// andamento, mensagens não enviadas, upload em progresso) — ganham
// contenção local: um erro de render aqui volta pra tela anterior com
// opção de tentar de novo, sem afetar o resto da navegação. Definidos uma
// única vez no escopo do módulo (não inline no JSX) pra manter a mesma
// identidade de componente entre renders do RootNavigator — um novo
// componente a cada render faria a navegação remontar a tela.
const PAYMENT_ERROR_BOUNDARY_PROPS = {
  title: "Não foi possível abrir o pagamento",
  description: "Algo deu errado ao carregar esta tela. Toque para tentar de novo.",
  retryLabel: "Tentar de novo",
};
const CHAT_ERROR_BOUNDARY_PROPS = {
  title: "Não foi possível abrir a conversa",
  description: "Algo deu errado ao carregar o chat. Toque para tentar de novo.",
  retryLabel: "Tentar de novo",
};
const UPLOAD_ERROR_BOUNDARY_PROPS = {
  title: "Não foi possível abrir esta tela",
  description: "Algo deu errado ao carregar esta seção. Toque para tentar de novo.",
  retryLabel: "Tentar de novo",
};

const BookingPaymentStatusScreenSafe = withScreenErrorBoundary(BookingPaymentStatusScreen, PAYMENT_ERROR_BOUNDARY_PROPS);
const PayoutStatusScreenSafe = withScreenErrorBoundary(PayoutStatusScreen, PAYMENT_ERROR_BOUNDARY_PROPS);
const ConnectPayoutAccountScreenSafe = withScreenErrorBoundary(ConnectPayoutAccountScreen, PAYMENT_ERROR_BOUNDARY_PROPS);
const ClientPaymentMethodScreenSafe = withScreenErrorBoundary(ClientPaymentMethodScreen, PAYMENT_ERROR_BOUNDARY_PROPS);
const ProviderPaymentMethodScreenSafe = withScreenErrorBoundary(ProviderPaymentMethodScreen, PAYMENT_ERROR_BOUNDARY_PROPS);
const ClientChatListScreenSafe = withScreenErrorBoundary(ClientChatListScreen, CHAT_ERROR_BOUNDARY_PROPS);
const ProfessionalChatListScreenSafe = withScreenErrorBoundary(ProfessionalChatListScreen, CHAT_ERROR_BOUNDARY_PROPS);
const ProfessionalCredentialsScreenSafe = withScreenErrorBoundary(ProfessionalCredentialsScreen, UPLOAD_ERROR_BOUNDARY_PROPS);

function routeNotification(
  data: Record<string, unknown>,
  role: string | null | undefined
) {
  if (!navigationRef.isReady() || !role) return;
  // Épico de Frentes, Frente 9, Lote 4: role aqui nunca é "PROFESSIONAL" -
  // o valor real do app é "PROVIDER" (ver UserRole em AppState.tsx). Esse
  // branch inteiro nunca executava, então TODO deep link de notificação
  // pro profissional caía silenciosamente em nada (routeNotification
  // simplesmente não fazia nada, sem navegar pra lugar nenhum).
  const target = resolveNotificationRoute(data, role);
  // Frente 7 (segunda camada), Lote 13: o fallback abaixo ("Notifications")
  // só existe no ClientStack/ProfessionalStack — hoje nenhum push é
  // enviado pra usuários ADMIN (resolveNotificationRoute sempre retorna
  // null pra esse role), então isso nunca disparou na prática, mas era uma
  // armadilha latente: o admin não tem central de avisos nem rota
  // "Notifications" registrada, e cairia numa navegação pra rota inexistente
  // no dia em que algum push admin for adicionado.
  if (!target && role === "ADMIN") return;
  const finalTarget = target ?? { screen: "Notifications" };
  (navigationRef as any).navigate(finalTarget.screen, finalTarget.params);
}

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ClientStack = createNativeStackNavigator<ClientStackParamList>();
const ProfessionalStack = createNativeStackNavigator<ProfessionalStackParamList>();
const AdminStack = createNativeStackNavigator<AdminStackParamList>();

function buildAppTheme(
  palette: typeof lightColors | typeof darkColors,
  mode: "light" | "dark"
): Theme {
  return {
    dark: mode === "dark",
    colors: {
      primary: palette.primary,
      background: palette.bg,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      notification: palette.primary
    },
    fonts: {
      regular: {
        fontFamily: "System",
        fontWeight: "400"
      },
      medium: {
        fontFamily: "System",
        fontWeight: "500"
      },
      bold: {
        fontFamily: "System",
        fontWeight: "700"
      },
      heavy: {
        fontFamily: "System",
        fontWeight: "800"
      }
    }
  };
}

function buildSharedStackOptions(palette: typeof lightColors | typeof darkColors) {
  return {
    headerShown: false,
    headerStyle: {
      backgroundColor: palette.surface,
      borderBottomWidth: 1,
      borderBottomColor: palette.border
    },
    headerTintColor: palette.text,
    headerTitleStyle: { fontWeight: "700", fontSize: 18, fontFamily: "DMSans_700Bold" },
    headerTitleAlign: "center",
    headerBackTitleVisible: false,
    headerLeft: (props: any) => <HeaderBackButton {...props} />,
    contentStyle: { backgroundColor: palette.bg },
    // Animação de transição V2 — 220ms, fade from bottom, gesto horizontal
    animation: "fade_from_bottom" as const,
    animationDuration: 220,
    gestureEnabled: true,
    gestureDirection: "horizontal" as const,
  } as const;
}

export function RootNavigator() {
  const {
    bootstrapping,
    role,
    isAuthenticated,
    onboardingDone,
    themeMode,
    user
  } = useAppState();
  // Frente 11 (engenharia mobile), Lote 4: toast agora é um contexto próprio
  // (ver ToastState.tsx) — só este arquivo lê o payload de verdade, então só
  // ele precisa re-renderizar quando um toast aparece.
  const { toast, clearToast } = useToast();
  // Bloco 6 (bloqueio por assinatura inativa): mesmo motivo do toast acima —
  // só este arquivo (que renderiza o sheet) precisa re-renderizar quando a
  // visibilidade muda.
  const { subscriptionSheetVisible, hideSubscriptionRequiredSheet } = useSubscriptionGate();
  const { online, recheckNow } = useConnectivity(5000, false);
  const { shouldHardBlockColdStart, showOfflineBanner } = useOfflineGate(online, OFFLINE_GRACE_MS);
  const [showLaunchSplash, setShowLaunchSplash] = useState(
    process.env.EXPO_PUBLIC_SKIP_LAUNCH_SPLASH === "true" ? false : true
  );

  const palette = useMemo(
    () => (themeMode === "light" ? lightColors : darkColors),
    [themeMode]
  );
  const appTheme = useMemo(
    () => buildAppTheme(palette, themeMode),
    [palette, themeMode]
  );
  const sharedStackOptions = useMemo(
    () => buildSharedStackOptions(palette),
    [palette]
  );

  const AuthNavigator = useMemo(
    () =>
      function AuthNavigatorComponent() {
        return (
    <AuthStack.Navigator
      screenOptions={{
        ...sharedStackOptions,
        headerShown: false
      }}
    >
      <AuthStack.Screen
        name="Login"
        component={AuthLoginScreen as React.ComponentType<any>}
      />
      <AuthStack.Screen
        name="ProfileSelection"
        component={AuthProfileSelectionScreen as React.ComponentType<any>}
      />
      <AuthStack.Screen
        name="Register"
        component={AuthRegisterScreen as React.ComponentType<any>}
      />
      <AuthStack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen as React.ComponentType<any>}
      />
      <AuthStack.Screen
        name="ResetPassword"
        component={ResetPasswordScreen as React.ComponentType<any>}
      />
      <AuthStack.Screen
        name="ClaimInvite"
        component={ClaimInviteScreen as React.ComponentType<any>}
      />
      <AuthStack.Screen
        name="TwoFactor"
        component={AuthTwoFactorScreen as React.ComponentType<any>}
        options={{ title: "Verificação em dois fatores" }}
      />
      <AuthStack.Screen
        name="SessionExpired"
        component={SessionExpiredScreen as React.ComponentType<any>}
      />
    </AuthStack.Navigator>
        );
      },
    [sharedStackOptions]
  );

  const ClientNavigator = useMemo(
    () =>
      function ClientNavigatorComponent() {
        return (
    <ClientStack.Navigator screenOptions={sharedStackOptions}>
      <ClientStack.Screen
        name="ClientTabs"
        component={ClientTabsNavigator}
        options={{ headerShown: false }}
      />
      <ClientStack.Screen
        name="ClientBookings"
        component={ClientBookingsScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ClientStack.Screen
        name="SearchProfessionals"
        component={SearchProfessionalsScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ProfessionalsList"
        component={ProfessionalsListScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ProfessionalDetail"
        component={ProfessionalDetailScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ConsultancyRequest"
        component={ConsultancyRequestScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ArchivedRequests"
        component={ArchivedRequestsScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="CreateBooking"
        component={CreateBookingScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="BuyPresentialPackage"
        component={BuyPresentialPackageScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="MyPresentialPackages"
        component={MyPresentialPackagesScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="PresentialPackageDetail"
        component={PresentialPackageDetailScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="MyDebts"
        component={MyDebtsScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="MyDisputes"
        component={MyDisputesScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="BookingConfirmation"
        component={BookingConfirmationScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="BookingPaymentStatus"
        component={BookingPaymentStatusScreenSafe as React.ComponentType<any>}
        options={{ gestureEnabled: false }}
      />
      <ClientStack.Screen
        name="ClientBookingDetail"
        component={ClientBookingDetailScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="WorkoutCelebration"
        component={WorkoutCelebrationScreen as React.ComponentType<any>}
        options={{ headerShown: false, animation: "fade" as const, gestureEnabled: false }}
      />
      <ClientStack.Screen
        name="ReviewProfessional"
        component={ReviewProfessionalScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ClientSettings"
        component={ClientSettingsScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ClientAnamnesis"
        component={ClientAnamnesisScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ClientChatList"
        component={ClientChatListScreenSafe as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ClientStack.Screen
        name="ClientPaymentMethod"
        component={ClientPaymentMethodScreenSafe as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="Notifications"
        component={NotificationsScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ClientStack.Screen
        name="Support"
        component={SupportScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="Privacy"
        component={PrivacyScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="Security"
        component={SecurityScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ConnectedDevices"
        component={ConnectedDevicesScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="GenericError"
        component={GenericErrorScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="FriendsList"
        component={FriendsListScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ClaimInvite"
        component={ClaimInviteScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="ProviderServicesUpgrade"
        component={ProviderServicesUpgradeScreen as React.ComponentType<any>}
      />
    </ClientStack.Navigator>
        );
      },
    [sharedStackOptions]
  );

  const ProfessionalNavigator = useMemo(
    () =>
      function ProfessionalNavigatorComponent() {
        return (
    <ProfessionalStack.Navigator screenOptions={sharedStackOptions}>
      <ProfessionalStack.Screen
        name="ProfessionalTabs"
        component={ProfessionalTabsNavigator}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="PayoutStatus"
        component={PayoutStatusScreenSafe as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="AnnualReport"
        component={ProfessionalAnnualReportScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="FinancialStudents"
        component={FinancialStudentsScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="FinancialHistory"
        component={FinancialHistoryScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="FinancialGoals"
        component={FinancialGoalsScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="ProfessionalCredentials"
        component={ProfessionalCredentialsScreenSafe as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalReviews"
        component={ProfessionalReviewsScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalSettings"
        component={ProfessionalSettingsScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="AvailabilityManager"
        component={AvailabilityManagerScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalConsultancyCenter"
        component={ProfessionalConsultancyCenterScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="ProfessionalArchivedRequests"
        component={ProfessionalArchivedRequestsScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ConnectPayoutAccount"
        component={ConnectPayoutAccountScreenSafe as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="BookingDetailProfessional"
        component={BookingDetailProfessionalScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalConfirmCompletion"
        component={ProfessionalConfirmCompletionScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="BookingPaymentStatus"
        component={BookingPaymentStatusScreenSafe as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalStudents"
        component={ProfessionalStudentsScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="AddExternalStudent"
        component={AddExternalStudentScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="ExternalStudentInviteCreated"
        component={ExternalStudentInviteCreatedScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="ProviderDebts"
        component={ProviderDebtsScreen as React.ComponentType<any>}
      />
      {/* Frente 6 (segunda camada), Lote 10: profissional não tinha
        equivalente a "Minhas disputas" — só via casos em análise abrindo
        agendamento por agendamento. Mesma tela do cliente, reaproveitada
        (listMyDisputes já cobre os dois lados no backend). */}
      <ProfessionalStack.Screen
        name="MyDisputes"
        component={MyDisputesScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProviderPaymentMethod"
        component={ProviderPaymentMethodScreenSafe as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="MySubscription"
        component={MySubscriptionScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalStudentDetail"
        component={ProfessionalStudentDetailScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalStudentAnamnesis"
        component={ProfessionalStudentAnamnesisScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="TrainingCreation"
        component={ProfessionalTrainingCreationScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="ProfessionalChatList"
        component={ProfessionalChatListScreenSafe as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="Notifications"
        component={NotificationsScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ProfessionalStack.Screen
        name="Support"
        component={SupportScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="Privacy"
        component={PrivacyScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="Security"
        component={SecurityScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ConnectedDevices"
        component={ConnectedDevicesScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="GenericError"
        component={GenericErrorScreen as React.ComponentType<any>}
      />
    </ProfessionalStack.Navigator>
        );
      },
    [sharedStackOptions]
  );
  const AdminNavigator = useMemo(
    () =>
      function AdminNavigatorComponent() {
        return (
          <AdminStack.Navigator screenOptions={sharedStackOptions}>
            <AdminStack.Screen
              name="AdminHome"
              component={AdminHomeScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminCrefValidation"
              component={AdminCrefValidationScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminSupport"
              component={AdminSupportScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminChatAudit"
              component={AdminChatAuditScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminChatAuditDetail"
              component={AdminChatAuditDetailScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminConsultas"
              component={AdminConsultasScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminConsultasBookingDetail"
              component={AdminConsultasBookingDetailScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminExercises"
              component={AdminExercisesScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminDisputes"
              component={AdminDisputesScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminDisputeDetail"
              component={AdminDisputeDetailScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminDebts"
              component={AdminDebtsScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminWaitlist"
              component={AdminWaitlistScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminUserSearch"
              component={AdminUserSearchScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminNoShowReports"
              component={AdminNoShowReportsScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminDataRetention"
              component={AdminDataRetentionScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="AdminModeration"
              component={AdminModerationScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="Security"
              component={SecurityScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
            <AdminStack.Screen
              name="ConnectedDevices"
              component={ConnectedDevicesScreen as React.ComponentType<any>}
              options={{ headerShown: false }}
            />
          </AdminStack.Navigator>
        );
      },
    [sharedStackOptions]
  );

  const locationSearch =
    typeof window !== "undefined" && typeof window.location?.search === "string"
      ? window.location.search
      : "";
  const searchParams = locationSearch ? new URLSearchParams(locationSearch) : null;
  const previewParam = searchParams?.get("preview");

  useEffect(() => {
    (globalThis as any).__PERSONALAPP_NAV__ = navigationRef;
    return () => {
      if ((globalThis as any).__PERSONALAPP_NAV__ === navigationRef) {
        delete (globalThis as any).__PERSONALAPP_NAV__;
      }
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, 2200);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  useEffect(() => {
    if (!isAuthenticated || !role) return;

    // Cold start: app was killed when notification was tapped
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (navigationRef.isReady()) {
        routeNotification(data, role);
        return;
      }
      // Poll until navigator is ready (rare edge case on cold start)
      const id = setInterval(() => {
        if (navigationRef.isReady()) {
          clearInterval(id);
          routeNotification(data, role);
        }
      }, 100);
      setTimeout(() => clearInterval(id), 5000);
    });

    // Runtime: app in foreground or background when notification is tapped
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      routeNotification(data, role);
    });

    // Frente 5 (Descoberta, agendamento e agenda), Lote 7: telas de agenda/
    // booking só recarregavam via useFocusEffect ou pull-to-refresh — se o
    // profissional já estivesse com a agenda aberta e um booking mudasse de
    // status em outro lugar (cliente cancelou pelo app dele, por exemplo),
    // a notificação chegava mas os dados na tela ficavam desatualizados até
    // sair e voltar. Notificação recebida em primeiro plano invalida as
    // queries relevantes direto, sem precisar de nenhuma navegação.
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      const type = typeof data.type === "string" ? data.type : "";
      // Épico de Frentes, Frente 9, Lote 3: notificação recebida em primeiro
      // plano nunca invalidava a central de avisos nem o badge do sino - só
      // recalculavam ao focar a Home. Toda notificação recebida invalida
      // a query canônica, sem depender do tipo.
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      if (isBookingNotificationType(type)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agenda.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all });
      }
      // Épico de Frentes, Frente 6, Lote 9: mesmo gap do Frente 5 Lote 7 -
      // notificação de consultoria/pacote presencial recebida em primeiro
      // plano nunca invalidava as queries correspondentes, deixando a tela
      // de consultoria/pacote aberta desatualizada até sair e voltar.
      if (isConsultancyNotificationType(type)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.consultancy.all });
      }
      if (isPresentialPackageNotificationType(type)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.presentialPackages.all });
      }
      if (isPaymentNotificationType(type)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.payments.providerPayouts() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.financial.all });
      }
    });

    return () => {
      sub.remove();
      receivedSub.remove();
    };
  }, [isAuthenticated, role]);

  if (previewParam === "splash") {
    return <MuvifySplash colorScheme={themeMode} />;
  }

  if (showLaunchSplash) {
    return (
      <MuvifySplash
        colorScheme={themeMode}
        onFinish={() => setShowLaunchSplash(false)}
      />
    );
  }

  if (bootstrapping) {
    return <MuvifySplash colorScheme={themeMode} />;
  }

  if (shouldHardBlockColdStart) {
    return <OfflineRequiredScreen onRetry={() => void recheckNow()} />;
  }

  if (isAuthenticated && user?.needsReconsent) {
    return <ReconsentGateScreen />;
  }

  const linking = {
    prefixes: ["muvify://", "https://muvify.com.br", "https://www.muvify.com.br"],
    config: {
      screens: {
        // Bloco 2 (aluno externo): funciona só se o app já estiver
        // instalado (não temos Universal Links configurados nativamente
        // ainda — ver plano do bloco). Sem o app instalado, o convite cai
        // pro código digitado à mão em "Tenho um convite".
        AuthStack: {
          screens: {
            ClaimInvite: "convite/:token",
          },
        },
        ClientStack: {
          screens: {
            ClientBookingDetail: "booking/:bookingId",
            Notifications: "notifications",
            WorkoutCelebration: "celebration/:bookingId",
            ClaimInvite: "convite/:token",
          },
        },
        ProfessionalStack: {
          screens: {
            BookingDetailProfessional: "booking/:bookingId",
            ProfessionalConsultancyCenter: "consultancy",
            PayoutStatus: "payout",
            Notifications: "notifications",
          },
        },
      },
    },
  };

  return (
    <ErrorBoundary>
      <NavigationContainer
        ref={navigationRef}
        theme={appTheme}
        linking={linking}
        // Frente 13 (segunda camada), Lote 14: breadcrumb básico de tela —
        // não existia nenhuma reconstituição da navegação antes de um
        // crash (só os breadcrumbs genéricos automáticos do SDK).
        onStateChange={() => {
          const currentRouteName = navigationRef.getCurrentRoute()?.name;
          if (currentRouteName) addNavigationBreadcrumb(currentRouteName);
        }}
      >
        {!isAuthenticated ? (
          <AuthNavigator />
        ) : role === "ADMIN" ? (
          <AdminNavigator />
        ) : role === "CLIENT" ? (
          // Frente 8 (segunda camada), Lote 16: onboarding pós-cadastro (3
          // slides + permissão de localização) só existe pro lado CLIENT -
          // PROVIDER nunca vê nada equivalente ao entrar pela primeira vez.
          // Decisão de produto aceita por ora (o fluxo de cadastro do
          // profissional já é mais longo e guiado por natureza - CREF,
          // oferta, disponibilidade); estender pro lado PROVIDER é melhoria
          // futura, fora do escopo desta frente.
          !onboardingDone ? <AuthOnboardingScreen /> : <ClientNavigator />
        ) : role === "PROVIDER" ? (
          <ProfessionalNavigator />
        ) : (
          <AuthNavigator />
        )}
        {showOfflineBanner ? <MvOfflineBanner onRetry={() => void recheckNow()} /> : null}
        {toast ? <MvToastHost message={toast.message} type={toast.type} /> : null}
      </NavigationContainer>
      <SubscriptionRequiredSheet
        visible={subscriptionSheetVisible}
        onDismiss={hideSubscriptionRequiredSheet}
        onActivate={() => {
          hideSubscriptionRequiredSheet();
          if (navigationRef.isReady()) {
            (navigationRef as any).navigate("MySubscription");
          }
        }}
      />
    </ErrorBoundary>
  );
}
