import React, { useMemo, useState } from "react";
import { Alert, Linking, Platform, ScrollView, Share, StatusBar, TouchableOpacity, View } from "react-native";
import { userApi } from "../../services/api/client";
import { shareExportedDataAsFile } from "../../utils/exportDataFile";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProfessionalStackParamList } from "../../navigation/route-types";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvAvatar, MvPasswordConfirmModal, MvText, MvToggle } from "../../components/mv";
import { useAppState } from "../../state/AppState";
import { ProfessionalBottomNav } from "../../components/navigation/ProfessionalBottomNav";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { extractApiMessage } from "../shared/api-helpers";

type Props = NativeStackScreenProps<ProfessionalStackParamList, "ProfessionalSettings">;

// IDs da loja — substitua pelos IDs reais quando publicar
const APP_STORE_ID = "000000000";        // Apple App Store ID
const PLAY_STORE_ID = "com.muvify.app";

function rateApp() {
  const url = Platform.OS === "ios"
    ? `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`
    : `market://details?id=${PLAY_STORE_ID}`;
  Linking.openURL(url).catch(() => {
    const fallback = Platform.OS === "ios"
      ? `https://apps.apple.com/app/id${APP_STORE_ID}`
      : `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}`;
    Linking.openURL(fallback);
  });
}

export function ProfessionalSettingsScreen({ navigation }: Props) {
  const {
    signOut, user, runWithAuth, analyticsEnabled, setAnalyticsPreference,
    pushNotificationsEnabled, setPushNotificationsPreference, setThemePreference
  } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const [showDeletePasswordModal, setShowDeletePasswordModal] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const lightModeEnabled = !isDark;
  const isLight = theme.mode === "light";

  function handleAnalyticsToggle(enabled: boolean) {
    void setAnalyticsPreference(enabled);
  }

  const fullName = useMemo(() => {
    return user?.providerProfile?.displayName?.trim() || user?.name?.trim() || "Profissional";
  }, [user?.name, user?.providerProfile?.displayName]);

  const initials = useMemo(() => {
    const parts = fullName.trim().split(/\s+/);
    return parts.length === 1
      ? (parts[0]?.slice(0, 2) ?? "PR").toUpperCase()
      : `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }, [fullName]);

  const photoUrl = user?.providerProfile?.photoUrl ?? user?.photoUrl ?? null;

  function handleSignOut() {
    Alert.alert("Sair da conta", "Tem certeza que deseja sair?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void signOut() },
    ]);
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
      Alert.alert("Erro", extractApiMessage(error, "Não foi possível excluir a conta."));
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleExportData() {
    try {
      const data = await runWithAuth((token) => userApi.exportMyData(token));
      await shareExportedDataAsFile(data);
    } catch {
      Alert.alert("Erro", "Não foi possível exportar seus dados.");
    }
  }

  function handleLightModeToggle(enabled: boolean) {
    if (enabled !== lightModeEnabled) {
      toggleTheme();
      void setThemePreference(enabled ? "light" : "dark");
    }
  }

  function handleShareApp() {
    void Share.share({
      message: "Conheça o Muvify, o app para personal trainers gerenciarem seus alunos e agenda!",
      title: "Muvify",
    });
  }

  const bg = theme.bg;
  const cardBg = theme.cardBg;
  const border = theme.border;
  const borderSub = theme.borderSub;
  const green = theme.textGreen;
  const text1 = theme.text1;
  const text2 = theme.text2;
  const text3 = theme.text3;

  const Divider = () => (
    <View style={{ height: 1, backgroundColor: borderSub }} />
  );

  const MenuItem = ({
    icon,
    label,
    sub,
    right,
    onPress,
    danger = false,
    isFirst = false,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    sub?: string;
    right?: React.ReactNode;
    onPress?: () => void;
    danger?: boolean;
    isFirst?: boolean;
  }) => (
    <TouchableOpacity
      activeOpacity={onPress ? 0.78 : 1}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 14,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: borderSub,
      }}
    >
      <View style={{
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: danger ? theme.dangerSubtle : "rgba(156,163,175,0.10)",
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name={icon} size={18} color={danger ? theme.danger : text2} />
      </View>
      <View style={{ flex: 1 }}>
        <MvText variant="semi2" style={{ color: danger ? theme.danger : text1 }} numberOfLines={1}>
          {label}
        </MvText>
        {sub ? <MvText variant="body4" color="secondary" numberOfLines={1}>{sub}</MvText> : null}
      </View>
      {right ?? (onPress && !danger ? <Ionicons name="chevron-forward" size={16} color={text3} /> : null)}
    </TouchableOpacity>
  );

  // Navegar dentro do stack do profissional
  function goToStack(screen: string) {
    navigation.navigate(screen as never);
  }

  // Navegar para telas que são tabs (ProfessionalProfileEditor é uma tab dentro de ProfessionalTabs)
  function goToTab(screen: string) {
    (navigation as any).navigate("ProfessionalTabs", { screen });
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }} testID="screen.professional.settings">
      <StatusBar barStyle={isLight ? "dark-content" : "light-content"} backgroundColor={bg} />

      <ProfessionalScreenHeader title="Mais" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>

        {/* ── PERFIL ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20, alignItems: "center", gap: 12 }}>
          <MvAvatar initials={initials} photoUri={photoUrl} size={72} borderRadius={36} color="green" />
          <View style={{ alignItems: "center", gap: 4 }}>
            <MvText variant="semi1" style={{ fontSize: 20 }}>{fullName}</MvText>
            <MvText variant="body4" color="secondary">Personal Trainer</MvText>
            <View style={{ marginTop: 4, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder }}>
              <MvText variant="badge" style={{ color: green, fontSize: 11 }}>Profissional</MvText>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => goToTab("ProfessionalProfileEditor")}
            style={{ paddingHorizontal: 20, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: border, backgroundColor: cardBg }}
          >
            <MvText variant="semi3" color="secondary">Editar perfil</MvText>
          </TouchableOpacity>
        </View>

        {/* ── FINANCEIRO (destaque no topo) ── */}
        <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, backgroundColor: cardBg, borderColor: border, overflow: "hidden", marginBottom: 12 }}>
          <MenuItem
            icon="wallet-outline"
            label="Financeiro"
            sub="Saldo, repasses, receitas e despesas"
            onPress={() => goToStack("PayoutStatus")}
            isFirst
          />
        </View>

        {/* ── CONTA ── */}
        <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, backgroundColor: cardBg, borderColor: border, overflow: "hidden", marginBottom: 12 }}>
          <MenuItem
            icon="person-outline"
            label="Meu perfil"
            onPress={() => goToTab("ProfessionalProfileEditor")}
            isFirst
          />
          <MenuItem
            icon="notifications-outline"
            label="Notificações"
            right={<MvToggle value={pushNotificationsEnabled} onValueChange={(v) => void setPushNotificationsPreference(v)} />}
          />
          <MenuItem
            icon={lightModeEnabled ? "sunny-outline" : "moon-outline"}
            label="Aparência"
            sub={lightModeEnabled ? "Modo claro ativo" : "Modo escuro ativo"}
            right={<MvToggle value={lightModeEnabled} onValueChange={handleLightModeToggle} />}
          />
          <MenuItem
            icon="analytics-outline"
            label="Compartilhar dados de uso"
            sub={analyticsEnabled ? "Ativado" : "Desativado"}
            right={<MvToggle value={analyticsEnabled} onValueChange={handleAnalyticsToggle} />}
          />
        </View>

        {/* ── DOCUMENTOS ── */}
        <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, backgroundColor: cardBg, borderColor: border, overflow: "hidden", marginBottom: 12 }}>
          <MenuItem icon="card-outline" label="Conta de recebimento" sub="Mercado Pago" onPress={() => goToStack("ConnectPayoutAccount")} isFirst />
          <MenuItem icon="alert-circle-outline" label="Pendências" sub="Valores a pagar de disputas já resolvidas" onPress={() => goToStack("ProviderDebts")} />
          {/* Frente 6 (segunda camada), Lote 10: só o cliente tinha um
            lugar central pra acompanhar disputas ainda em análise — o
            profissional só descobria abrindo agendamento por agendamento. */}
          <MenuItem icon="git-compare-outline" label="Minhas disputas" sub="Casos ainda em análise" onPress={() => goToStack("MyDisputes")} />
          <MenuItem icon="shield-checkmark-outline" label="CREF e documentos" onPress={() => goToStack("ProfessionalCredentials")} />
          <MenuItem icon="star-outline" label="Minhas avaliações" onPress={() => goToStack("ProfessionalReviews")} />
          <MenuItem icon="lock-closed-outline" label="Segurança" onPress={() => goToStack("Security")} />
          <MenuItem icon="document-text-outline" label="Privacidade" onPress={() => goToStack("Privacy")} />
          <MenuItem icon="download-outline" label="Baixar meus dados" sub="Exportar todas as suas informações" onPress={() => void handleExportData()} />
          <MenuItem icon="trash-outline" label="Excluir minha conta" sub="Remover permanentemente todos os dados" onPress={handleDeleteAccount} danger />
        </View>

        {/* ── SUPORTE ── */}
        <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, backgroundColor: cardBg, borderColor: border, overflow: "hidden", marginBottom: 12 }}>
          <MenuItem icon="help-circle-outline" label="Suporte" onPress={() => goToStack("Support")} isFirst />
          <MenuItem icon="share-social-outline" label="Indicar o app" onPress={handleShareApp} />
          <MenuItem icon="star-outline" label="Avalie o app" onPress={rateApp} />
        </View>

        {/* ── SAIR ── */}
        <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, backgroundColor: cardBg, borderColor: border, overflow: "hidden", marginBottom: 12 }}>
          <MenuItem icon="log-out-outline" label="Sair" onPress={handleSignOut} danger isFirst />
        </View>
      </ScrollView>

{/* Settings accessed via home drawer — no bottom nav needed */}

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
