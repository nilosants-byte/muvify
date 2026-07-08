import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ToastHost } from "../components/primitives";
import { useAppState } from "../state/AppState";
import { useConnectivity } from "../state/useConnectivity";
import { useTheme } from "../theme/useTheme";
import { useThemedStyles } from "../theme/useThemedStyles";
import {
  AvailabilityManagerScreen,
  BookingConfirmationScreen,
  CategoriesListScreen,
  ConnectPayoutAccountScreen,
  CreateBookingScreen,
  CustomerBookingDetailScreen,
  CustomerBookingsScreen,
  CustomerCompleteConfirmScreen,
  CustomerHomeScreen,
  CustomerPaymentMethodScreen,
  CustomerProfileScreen,
  CustomerSettingsScreen,
  FavoritesScreen,
  ForgotPasswordScreen,
  GenericErrorScreen,
  HomeHeaderRoleTag,
  LoginScreen,
  NotificationsScreen,
  OfflineRequiredScreen,
  OnboardingScreen,
  PaymentStatusScreen,
  PayoutStatusScreen,
  ProviderAgendaScreen,
  ProviderBookingDetailScreen,
  ProviderCompleteConfirmScreen,
  ProviderDetailScreen,
  ProviderHomeScreen,
  ProviderListScreen,
  ProviderProfileEditScreen,
  ProviderSearchScreen,
  RegisterScreen,
  ReviewCreateScreen,
  RoleSelectionScreen,
  SessionExpiredScreen,
  SplashScreen,
  SupportScreen
} from "../screens/Screens";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const OFFLINE_GRACE_MS = 4000;

function OfflineDropBanner({ message }: { message: string }) {
  const styles = useThemedStyles((palette) => ({
    offlineBannerWrap: {
      position: "absolute",
      top: 12,
      alignSelf: "center",
      backgroundColor: "rgba(215,160,49,0.95)",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      zIndex: 999
    },
    offlineBannerText: {
      color: palette.black,
      fontWeight: "700"
    }
  }));

  return (
    <View style={styles.offlineBannerWrap}>
      <Text style={styles.offlineBannerText}>{message}</Text>
    </View>
  );
}

export function AppNavigator() {
  const { bootstrapping, onboardingDone, role, isAuthenticated, toast, clearToast } = useAppState();
  const { online, checking, recheckNow } = useConnectivity();
  const { colors, themeMode } = useTheme();
  const [hadOnlineSession, setHadOnlineSession] = useState(false);
  const [offlineGraceExpired, setOfflineGraceExpired] = useState(false);

  const appTheme: Theme = useMemo(
    () => ({
      dark: themeMode === "dark",
      colors: {
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.primary
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
    }),
    [colors, themeMode]
  );

  const stackScreenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      contentStyle: { backgroundColor: colors.background }
    }),
    [colors]
  );

  const AuthNavigator = () => (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Entrar" }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Cadastro" }} />
      <Stack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
        options={{ title: "Recuperar senha" }}
      />
    </Stack.Navigator>
  );

  const CustomerTabs = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "800" },
        headerRight: () => (
          <View style={{ marginRight: 8 }}>
            <HomeHeaderRoleTag />
          </View>
        ),
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => {
          const iconName =
            route.name === "CustomerHome"
              ? "home-outline"
              : route.name === "ProviderSearch"
                ? "search-outline"
                : route.name === "Favorites"
                  ? "heart-outline"
                  : route.name === "CustomerBookings"
                    ? "calendar-outline"
                    : "person-outline";
          return <Ionicons name={iconName} size={size} color={color} />;
        }
      })}
    >
      <Tab.Screen
        name="CustomerHome"
        component={CustomerHomeScreen}
        options={{ title: "Home Cliente", tabBarLabel: "Home" }}
      />
      <Tab.Screen
        name="ProviderSearch"
        component={ProviderSearchScreen}
        options={{ title: "Buscar Profissionais", tabBarLabel: "Busca" }}
      />
      <Tab.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{ title: "Favoritos", tabBarLabel: "Favoritos" }}
      />
      <Tab.Screen
        name="CustomerBookings"
        component={CustomerBookingsScreen}
        options={{ title: "Meus Agendamentos", tabBarLabel: "Agenda" }}
      />
      <Tab.Screen
        name="CustomerProfile"
        component={CustomerProfileScreen}
        options={{ title: "Perfil", tabBarLabel: "Perfil" }}
      />
    </Tab.Navigator>
  );

  const ProviderTabs = () => (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "800" },
        headerRight: () => (
          <View style={{ marginRight: 8 }}>
            <HomeHeaderRoleTag />
          </View>
        ),
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => {
          const iconName =
            route.name === "ProviderHome"
              ? "grid-outline"
              : route.name === "ProviderAgenda"
                ? "calendar-number-outline"
                : route.name === "AvailabilityManager"
                  ? "time-outline"
                  : route.name === "PayoutStatus"
                    ? "card-outline"
                    : "person-circle-outline";
          return <Ionicons name={iconName} size={size} color={color} />;
        }
      })}
    >
      <Tab.Screen
        name="ProviderHome"
        component={ProviderHomeScreen}
        options={{ title: "Home Profissional", tabBarLabel: "Home" }}
      />
      <Tab.Screen
        name="ProviderAgenda"
        component={ProviderAgendaScreen}
        options={{ title: "Minha Agenda", tabBarLabel: "Agenda" }}
      />
      <Tab.Screen
        name="AvailabilityManager"
        component={AvailabilityManagerScreen}
        options={{ title: "Meus Horários", tabBarLabel: "Horários" }}
      />
      <Tab.Screen
        name="PayoutStatus"
        component={PayoutStatusScreen}
        options={{ title: "Recebimentos", tabBarLabel: "Recebimentos" }}
      />
      <Tab.Screen
        name="ProviderProfileEdit"
        component={ProviderProfileEditScreen}
        options={{ title: "Meu Perfil", tabBarLabel: "Perfil" }}
      />
    </Tab.Navigator>
  );

  const CustomerNavigator = () => (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="CustomerTabs" component={CustomerTabs} options={{ headerShown: false }} />
      <Stack.Screen name="CategoriesList" component={CategoriesListScreen} options={{ title: "Categorias" }} />
      <Stack.Screen name="ProviderList" component={ProviderListScreen} options={{ title: "Lista de profissionais" }} />
      <Stack.Screen name="ProviderDetail" component={ProviderDetailScreen} options={{ title: "Detalhe do profissional" }} />
      <Stack.Screen name="CreateBooking" component={CreateBookingScreen} options={{ title: "Criar agendamento" }} />
      <Stack.Screen
        name="CustomerPaymentMethod"
        component={CustomerPaymentMethodScreen}
        options={{ title: "Método de pagamento" }}
      />
      <Stack.Screen name="BookingConfirmation" component={BookingConfirmationScreen} options={{ title: "Confirmação" }} />
      <Stack.Screen
        name="CustomerBookingDetail"
        component={CustomerBookingDetailScreen}
        options={{ title: "Detalhe do agendamento" }}
      />
      <Stack.Screen
        name="CustomerCompleteConfirm"
        component={CustomerCompleteConfirmScreen}
        options={{ title: "Confirmar conclusão" }}
      />
      <Stack.Screen name="ReviewCreate" component={ReviewCreateScreen} options={{ title: "Avaliação" }} />
      <Stack.Screen name="CustomerSettings" component={CustomerSettingsScreen} options={{ title: "Configurações" }} />
      <Stack.Screen name="PaymentStatus" component={PaymentStatusScreen} options={{ title: "Status do pagamento" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notificações" }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: "Ajuda e suporte" }} />
      <Stack.Screen
        name="SessionExpired"
        component={SessionExpiredScreen}
        options={{ title: "Sessão expirada" }}
      />
      <Stack.Screen name="GenericError" component={GenericErrorScreen} options={{ title: "Erro" }} />
    </Stack.Navigator>
  );

  const ProviderNavigator = () => (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="ProviderTabs" component={ProviderTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="ConnectPayoutAccount"
        component={ConnectPayoutAccountScreen}
        options={{ title: "Conectar conta de recebimento" }}
      />
      <Stack.Screen name="ProviderBookingDetail" component={ProviderBookingDetailScreen} options={{ title: "Detalhe do agendamento" }} />
      <Stack.Screen
        name="ProviderCompleteConfirm"
        component={ProviderCompleteConfirmScreen}
        options={{ title: "Confirmar conclusão" }}
      />
      <Stack.Screen name="PaymentStatus" component={PaymentStatusScreen} options={{ title: "Status do pagamento" }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notificações" }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: "Ajuda e suporte" }} />
      <Stack.Screen
        name="SessionExpired"
        component={SessionExpiredScreen}
        options={{ title: "Sessão expirada" }}
      />
      <Stack.Screen name="GenericError" component={GenericErrorScreen} options={{ title: "Erro" }} />
    </Stack.Navigator>
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, 2200);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

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

  if (bootstrapping) {
    return <SplashScreen />;
  }

  const shouldHardBlockOffline = !online && (!hadOnlineSession || offlineGraceExpired);
  const shouldShowOfflineBanner = !online && hadOnlineSession && !offlineGraceExpired;

  if (shouldHardBlockOffline) {
    return <OfflineRequiredScreen onRetry={recheckNow} retrying={checking} />;
  }

  return (
    <NavigationContainer theme={appTheme}>
      {!onboardingDone ? (
        <OnboardingScreen />
      ) : !role ? (
        <RoleSelectionScreen />
      ) : !isAuthenticated ? (
        <AuthNavigator />
      ) : role === "CLIENT" ? (
        <CustomerNavigator />
      ) : role === "PROVIDER" ? (
        <ProviderNavigator />
      ) : (
        <AuthNavigator />
      )}
      {shouldShowOfflineBanner ? (
        <OfflineDropBanner message="Conexão instável. Reconectando..." />
      ) : null}
      {toast ? <ToastHost message={toast.message} type={toast.type} /> : null}
    </NavigationContainer>
  );
}
