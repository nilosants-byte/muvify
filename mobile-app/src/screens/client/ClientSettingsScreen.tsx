import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Alert, Modal, Pressable, ScrollView, Share, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { MvPasswordConfirmModal, MvToggle } from "../../components/mv";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { authApi, userApi } from "../../services/api/client";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { AuthOnboardingScreen } from "../auth/AuthOnboardingScreen";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientSettings">;
const PUSH_KEY = "@personalapp/clientPushEnabled";

// Componente de linha de configuração V2
function ConfigRow({
  icon, title, subtitle, value, toggle, onToggle, onPress, badge, danger = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  value?: string;
  toggle?: boolean;
  onToggle?: (v: boolean) => void;
  onPress?: () => void;
  badge?: string;
  danger?: boolean;
}) {
  const { theme } = useMvTheme();
  const iconColor = danger ? theme.danger : theme.primary;
  const iconBg = danger ? "rgba(239,68,68,0.12)" : theme.primarySubtle;
  const iconBorder = danger ? "rgba(239,68,68,0.20)" : theme.primarySubtleBorder;
  const isToggle = typeof toggle === "boolean";
  return (
    <TouchableOpacity
      onPress={isToggle ? () => onToggle?.(!toggle) : onPress}
      activeOpacity={isToggle || onPress ? 0.75 : 1}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.border, minHeight: S.touchMin }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 12, backgroundColor: iconBg, borderWidth: 1, borderColor: iconBorder, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Ionicons name={icon} size={14} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: danger ? theme.danger : theme.text1 }}>{title}</Text>
        {subtitle && <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.text3, marginTop: 1 }} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {badge && (
        <View style={{ backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder, borderRadius: S.chipR, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, color: theme.primary }}>{badge}</Text>
        </View>
      )}
      {value && !isToggle && !badge && <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: theme.primary }}>{value}</Text>}
      {isToggle ? (
        <MvToggle value={toggle!} onValueChange={onToggle ?? (() => {})} />
      ) : !badge && onPress ? (
        <Ionicons name={danger ? "log-out-outline" : "chevron-forward"} size={14} color={theme.labelColor} />
      ) : null}
    </TouchableOpacity>
  );
}

function ConfigGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useMvTheme();
  return (
    <View>
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 16, color: theme.text1, marginBottom: 4 }}>{title}</Text>
      <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, paddingHorizontal: 14 }}>
        {children}
      </View>
    </View>
  );
}

export function ClientSettingsScreen({ navigation }: Props) {
  const { signOut, runWithAuth, analyticsEnabled, setAnalyticsPreference, setThemePreference, user, showToast } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [pushEnabled, setPushEnabled] = useState(true);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showDeletePasswordModal, setShowDeletePasswordModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const lightModeEnabled = !isDark;

  function handleToggleAnalytics(enabled: boolean) {
    void setAnalyticsPreference(enabled);
  }

  function handleDeleteAccount() {
    Alert.alert(
      "Excluir minha conta",
      "Esta ação é permanente e irreversível. Todos os seus dados serão removidos. Deseja continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Continuar",
          style: "destructive",
          onPress: () => setShowDeletePasswordModal(true),
        },
      ]
    );
  }

  async function handleConfirmDeleteAccount(password: string) {
    setDeletingAccount(true);
    try {
      await runWithAuth((token) => userApi.deleteMe(token, password));
      setShowDeletePasswordModal(false);
      await signOut();
    } catch (error) {
      Alert.alert("Erro", error instanceof Error ? error.message : "Não foi possível excluir a conta.");
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleResendVerificationEmail() {
    setResendingVerification(true);
    try {
      await runWithAuth((token) => authApi.resendVerificationEmail(token));
      Alert.alert("E-mail enviado", "Verifique sua caixa de entrada (e o spam) para confirmar seu e-mail.");
    } catch (error) {
      Alert.alert("Erro", "Não foi possível reenviar o e-mail de verificação. Tente novamente mais tarde.");
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleExportData() {
    try {
      const data = await runWithAuth((token) => userApi.exportMyData(token));
      await Share.share({
        message: JSON.stringify(data, null, 2),
        title: "Meus dados — Muvify",
      });
    } catch (error) {
      Alert.alert("Erro", "Não foi possível exportar seus dados.");
    }
  }

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PUSH_KEY).then((saved) => { if (active && saved) setPushEnabled(saved !== "0"); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(PUSH_KEY, pushEnabled ? "1" : "0").catch(() => {});
  }, [pushEnabled]);

  function handleSignOut() {
    Alert.alert("Sair da conta", "Tem certeza que deseja sair?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  function handleToggleLight(enabled: boolean) {
    if (enabled !== lightModeEnabled) {
      toggleTheme();
      void setThemePreference(enabled ? "light" : "dark");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header V2 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button" accessibilityLabel="Voltar" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 24, color: theme.text1, letterSpacing: -0.3 }}>Dados do perfil</Text>
          <Text style={{ fontFamily: "DMSans_500Medium", fontSize: 11, color: theme.text3, marginTop: 2 }}>sua conta, do seu jeito</Text>
        </View>
      </View>

      <ScreenEntrance>
      <ScrollView contentContainerStyle={{ paddingHorizontal: S.px, paddingBottom: 40, gap: 20, paddingTop: 16 }} showsVerticalScrollIndicator={false}>

        {/* Hero mini */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: theme.primarySubtleBorder, backgroundColor: "rgba(36,230,109,0.09)", padding: 14 }}>
          <View style={{ flexDirection: "row" }}>
            <Text style={{ fontFamily: "Nunito_800ExtraBold", fontSize: 10, color: theme.text1, letterSpacing: 0.1 * 10, textTransform: "uppercase" }}>muvi</Text>
            <Text style={{ fontFamily: "Nunito_800ExtraBold", fontSize: 10, color: theme.primary, letterSpacing: 0.1 * 10, textTransform: "uppercase" }}>fy</Text>
          </View>
          <Text style={{ fontFamily: DISPLAY, fontWeight: "800", fontSize: 20, color: theme.text1, letterSpacing: -0.02 * 20, marginTop: 6 }}>Dados do perfil</Text>
          <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 13, color: theme.text2, marginTop: 4 }}>Gerencie sua conta, segurança e preferências.</Text>
        </View>

        {!user?.emailVerifiedAt ? (
          <ConfigGroup title="Conta">
            <ConfigRow
              icon="mail-unread-outline"
              title="Confirmar e-mail"
              subtitle={resendingVerification ? "Enviando..." : "Reenviar e-mail de verificação"}
              onPress={resendingVerification ? undefined : () => void handleResendVerificationEmail()}
            />
          </ConfigGroup>
        ) : null}

        {/* Privacidade e segurança */}
        <ConfigGroup title="Privacidade e segurança">
          <ConfigRow
            icon="shield-checkmark-outline"
            title="Verificação em duas etapas"
            subtitle="Em breve"
            badge="Em breve"
            onPress={() => showToast("Essa função ainda não está disponível para clientes.", "info")}
          />
          <ConfigRow
            icon="lock-closed-outline"
            title="Privacidade da conta"
            subtitle="Termos e política de dados"
            onPress={() => navigation.navigate("Privacy")}
          />
          <ConfigRow
            icon="eye-outline"
            title="Segurança"
            subtitle="Senha e acesso"
            onPress={() => navigation.navigate("Security")}
          />
          <ConfigRow
            icon="download-outline"
            title="Baixar meus dados"
            subtitle="Exportar todas as suas informações"
            onPress={() => void handleExportData()}
          />
          <ConfigRow
            icon="trash-outline"
            title="Excluir minha conta"
            subtitle="Remover permanentemente todos os dados"
            onPress={handleDeleteAccount}
            danger
          />
        </ConfigGroup>

        {/* Pagamentos */}
        <ConfigGroup title="Pagamentos">
          <ConfigRow
            icon="card-outline"
            title="Métodos de pagamento"
            subtitle="Cartão, débito e PIX"
            onPress={() => navigation.navigate("ClientPaymentMethod")}
          />
        </ConfigGroup>

        {/* App */}
        <ConfigGroup title="App">
          <ConfigRow
            icon="moon-outline"
            title="Aparência"
            subtitle={lightModeEnabled ? "Modo claro ativo" : "Modo escuro ativo"}
            toggle={lightModeEnabled}
            onToggle={handleToggleLight}
          />
          <ConfigRow
            icon="notifications-outline"
            title="Notificações push"
            subtitle={pushEnabled ? "Ativadas" : "Desativadas"}
            toggle={pushEnabled}
            onToggle={setPushEnabled}
          />
          <ConfigRow
            icon="globe-outline"
            title="Idioma"
            subtitle="Português (Brasil)"
          />
        </ConfigGroup>

        {/* Suporte */}
        <ConfigGroup title="Ajuda">
          <ConfigRow
            icon="help-circle-outline"
            title="Ajuda e suporte"
            subtitle="Central de atendimento"
            onPress={() => navigation.navigate("Support")}
          />
          <ConfigRow
            icon="play-circle-outline"
            title="Como funciona o Muvify?"
            subtitle="Tour rápido pelo app"
            onPress={() => setShowHowItWorks(true)}
          />
          <ConfigRow
            icon="information-circle-outline"
            title="Sobre o app"
            subtitle={`Versão ${Constants.expoConfig?.version ?? "-"}`}
          />
          <ConfigRow
            icon="analytics-outline"
            title="Compartilhar dados de uso"
            subtitle={analyticsEnabled ? "Ativado" : "Desativado"}
            toggle={analyticsEnabled}
            onToggle={handleToggleAnalytics}
          />
        </ConfigGroup>

        {/* Sair */}
        <View style={{ borderRadius: S.cardR, borderWidth: 1, borderColor: "rgba(239,68,68,0.20)", backgroundColor: theme.cardBg, paddingHorizontal: 14 }}>
          <ConfigRow
            icon="log-out-outline"
            title="Sair da conta"
            onPress={handleSignOut}
            danger
          />
        </View>
      </ScrollView>
      </ScreenEntrance>

      {/* Modal "Como funciona o Muvify?" — reutiliza AuthOnboardingScreen com botão de fechar */}
      <Modal
        visible={showHowItWorks}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHowItWorks(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
          {/* Botão de fechar sobreposto no topo direito */}
          <View style={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}>
            <Pressable
              onPress={() => setShowHowItWorks(false)}
              accessibilityRole="button"
              accessibilityLabel="Fechar tour"
              hitSlop={12}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="close" size={18} color={theme.text1} />
            </Pressable>
          </View>
          {/* Reutiliza o onboarding — o "Começar" fecha o modal em vez de chamar completeOnboarding */}
          <AuthOnboardingScreen onDismiss={() => setShowHowItWorks(false)} />
        </View>
      </Modal>

      <MvPasswordConfirmModal
        visible={showDeletePasswordModal}
        title="Confirme sua senha"
        message="Digite sua senha para confirmar a exclusão da conta."
        confirmLabel="Excluir conta"
        loading={deletingAccount}
        onCancel={() => setShowDeletePasswordModal(false)}
        onConfirm={(password) => void handleConfirmDeleteAccount(password)}
      />
    </View>
  );
}
