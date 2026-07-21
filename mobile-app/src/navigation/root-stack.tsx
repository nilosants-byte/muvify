import React, { useEffect, useMemo, useState } from "react";
import {
  NavigationContainer,
  Theme,
  createNavigationContainerRef
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import { ToastHost } from "../components/primitives";
import { AdminCrefValidationScreen } from "../screens/admin/AdminCrefValidationScreen";
import { AdminChatAuditDetailScreen } from "../screens/admin/AdminChatAuditDetailScreen";
import { AdminChatAuditScreen } from "../screens/admin/AdminChatAuditScreen";
import { AdminConsultasBookingDetailScreen } from "../screens/admin/AdminConsultasBookingDetailScreen";
import { AdminConsultasScreen } from "../screens/admin/AdminConsultasScreen";
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
import { PresentialPackageDetailScreen } from "../screens/client/PresentialPackageDetailScreen";
import { ProfessionalDetailScreen } from "../screens/client/ProfessionalDetailScreen";
import { ProfessionalsListScreen } from "../screens/client/ProfessionalsListScreen";
import { ResetPasswordScreen } from "../screens/client/ResetPasswordScreen";
import { ReviewProfessionalScreen } from "../screens/client/ReviewProfessionalScreen";
import { SearchProfessionalsScreen } from "../screens/client/SearchProfessionalsScreen";
import { FriendsListScreen } from "../screens/client/FriendsListScreen";
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
import { ProfessionalTrainingCreationScreen } from "../screens/professional/ProfessionalTrainingCreationScreen";
import { ProfessionalChatListScreen } from "../screens/professional/ProfessionalChatListScreen";
import { GenericErrorScreen } from "../screens/shared/GenericErrorScreen";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { NotificationsScreen } from "../screens/shared/NotificationsScreen";
import { OfflineRequiredScreen } from "../screens/shared/OfflineRequiredScreen";
import { SessionExpiredScreen } from "../screens/shared/SessionExpiredScreen";
import { SupportScreen } from "../screens/shared/SupportScreen";
import { PrivacyScreen } from "../screens/shared/PrivacyScreen";
import { SecurityScreen } from "../screens/shared/SecurityScreen";
import { useAppState } from "../state/AppState";
import { useConnectivity } from "../state/useConnectivity";
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

const BOOKING_TYPES_PRO = new Set([
  "BOOKING_CREATED", "BOOKING_CONFIRMED", "BOOKING_CANCELLED", "BOOKING_COMPLETED",
  "BOOKING_EXPIRED", "BOOKING_ATTENDANCE_CODE_AVAILABLE", "BOOKING_ATTENDANCE_CODE_VALIDATED",
  "BOOKING_CONFIRMATION_PENDING", "CHAT_MESSAGE", "SESSION_REMINDER",
]);
const CONSULTANCY_TYPES_PRO = new Set([
  "CONSULTANCY_REQUEST_CREATED", "CONSULTANCY_PROPOSAL_REFUSED",
  "CONSULTANCY_CONTRACT_ACCEPTED", "CONSULTANCY_CONTRACT_EXPIRED",
  "CONSULTANCY_AUTO_REFUND", "CONSULTANCY_EXPIRY_7D", "CONSULTANCY_EXPIRY_1D", "CONSULTANCY_EXPIRED",
]);
const PAYMENT_TYPES_PRO = new Set([
  "PAYMENT_AUTHORIZED", "PAYMENT_REFUNDED", "PAYMENT_AUTH_FAILED", "PAYMENT_CANCELED",
]);
const BOOKING_TYPES_CLIENT = new Set([
  "BOOKING_CONFIRMED", "BOOKING_CANCELLED", "BOOKING_COMPLETED",
  "BOOKING_EXPIRED", "BOOKING_ATTENDANCE_CODE_AVAILABLE",
  "CHAT_MESSAGE", "SESSION_REMINDER",
]);

function routeNotification(
  data: Record<string, unknown>,
  role: string | null | undefined
) {
  if (!navigationRef.isReady() || !role) return;
  const type = typeof data.type === "string" ? data.type : "";
  const rawBookingId = typeof data.bookingId === "string" ? data.bookingId : undefined;
  const bookingId =
    rawBookingId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBookingId)
      ? rawBookingId
      : undefined;

  if (role === "PROFESSIONAL") {
    if (bookingId && BOOKING_TYPES_PRO.has(type)) {
      (navigationRef as any).navigate("BookingDetailProfessional", { bookingId });
    } else if (CONSULTANCY_TYPES_PRO.has(type)) {
      (navigationRef as any).navigate("ProfessionalConsultancyCenter");
    } else if (PAYMENT_TYPES_PRO.has(type)) {
      (navigationRef as any).navigate("PayoutStatus");
    } else {
      (navigationRef as any).navigate("Notifications");
    }
    return;
  }

  if (role === "CLIENT") {
    if (bookingId && BOOKING_TYPES_CLIENT.has(type)) {
      (navigationRef as any).navigate("ClientBookingDetail", { bookingId });
    } else if (type === "PAYMENT_AUTH_FAILED") {
      (navigationRef as any).navigate("ClientPaymentMethod");
    } else {
      (navigationRef as any).navigate("Notifications");
    }
  }
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
    toast,
    clearToast
  } = useAppState();
  const { online, recheckNow } = useConnectivity(5000, false);
  const [hadOnlineSession, setHadOnlineSession] = useState(false);
  const [offlineGraceExpired, setOfflineGraceExpired] = useState(false);
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
        name="BookingConfirmation"
        component={BookingConfirmationScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="BookingPaymentStatus"
        component={BookingPaymentStatusScreen as React.ComponentType<any>}
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
        component={ClientChatListScreen as React.ComponentType<any>}
        options={{ headerShown: false }}
      />
      <ClientStack.Screen
        name="ClientPaymentMethod"
        component={ClientPaymentMethodScreen as React.ComponentType<any>}
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
        name="GenericError"
        component={GenericErrorScreen as React.ComponentType<any>}
      />
      <ClientStack.Screen
        name="FriendsList"
        component={FriendsListScreen as React.ComponentType<any>}
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
        component={PayoutStatusScreen as React.ComponentType<any>}
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
        component={ProfessionalCredentialsScreen as React.ComponentType<any>}
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
        component={ConnectPayoutAccountScreen as React.ComponentType<any>}
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
        component={BookingPaymentStatusScreen as React.ComponentType<any>}
      />
      <ProfessionalStack.Screen
        name="ProfessionalStudents"
        component={ProfessionalStudentsScreen as React.ComponentType<any>}
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
        component={ProfessionalChatListScreen as React.ComponentType<any>}
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
    if (online) {
      setHadOnlineSession(true);
      setOfflineGraceExpired(false);
      return;
    }

    if (!hadOnlineSession) {
      setOfflineGraceExpired(true);
      return;
    }

    setOfflineGraceExpired(false);
    const timer = setTimeout(() => {
      setOfflineGraceExpired(true);
    }, OFFLINE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [online, hadOnlineSession]);

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

    return () => sub.remove();
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

  const shouldHardBlockOffline = !online && (!hadOnlineSession || offlineGraceExpired);

  if (shouldHardBlockOffline) {
    return <OfflineRequiredScreen onRetry={() => void recheckNow()} />;
  }

  const linking = {
    prefixes: ["muvify://", "https://muvify.app"],
    config: {
      screens: {
        ClientStack: {
          screens: {
            ClientBookingDetail: "booking/:bookingId",
            Notifications: "notifications",
            WorkoutCelebration: "celebration/:bookingId",
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
      <NavigationContainer ref={navigationRef} theme={appTheme} linking={linking}>
        {!isAuthenticated ? (
          <AuthNavigator />
        ) : role === "ADMIN" ? (
          <AdminNavigator />
        ) : role === "CLIENT" ? (
          !onboardingDone ? <AuthOnboardingScreen /> : <ClientNavigator />
        ) : role === "PROVIDER" ? (
          <ProfessionalNavigator />
        ) : (
          <AuthNavigator />
        )}
        {toast ? <ToastHost message={toast.message} type={toast.type} /> : null}
      </NavigationContainer>
    </ErrorBoundary>
  );
}
