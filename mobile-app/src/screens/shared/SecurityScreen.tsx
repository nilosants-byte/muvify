import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { useAppState } from "../../state/AppState";
import { userApi } from "../../services/api/client";

function ActionRow({
  icon,
  title,
  subtitle,
  badge,
  onPress,
  iconColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  badge?: { label: string; variant: "green" | "orange" | "gray" };
  onPress?: () => void;
  iconColor?: string;
}) {
  const { theme } = useMvTheme();
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.8 : 1}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 }}
    >
      <View style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: `${iconColor ?? theme.textGreen}18`,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      >
        <Ionicons name={icon} size={18} color={iconColor ?? theme.textGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <MvText variant="semi3">{title}</MvText>
        <MvText variant="body4" color="secondary">{subtitle}</MvText>
      </View>
      {badge ? <MvBadge label={badge.label} variant={badge.variant} /> : null}
      {onPress && !badge ? <Ionicons name="chevron-forward" size={16} color={theme.text3} /> : null}
    </TouchableOpacity>
  );
}

export function SecurityScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { refreshSession, runWithAuth, showToast } = useAppState();

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [recoveryModalVisible, setRecoveryModalVisible] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [customRecoveryEmail, setCustomRecoveryEmail] = useState(false);
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [newAccountEmail, setNewAccountEmail] = useState("");
  const [confirmAccountEmail, setConfirmAccountEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);

  const loadRecoveryEmail = useCallback(async () => {
    try {
      setRecoveryLoading(true);
      const payload = await runWithAuth((token) => userApi.getRecoveryEmail(token));
      setAccountEmail(payload.accountEmail);
      setRecoveryEmail(payload.recoveryEmail);
      setCustomRecoveryEmail(payload.custom);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar e-mail de recuperação.";
      showToast(message, "error");
    } finally {
      setRecoveryLoading(false);
    }
  }, [runWithAuth, showToast]);

  useEffect(() => {
    void loadRecoveryEmail();
  }, [loadRecoveryEmail]);

  async function submitPasswordChange() {
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      showToast("Preencha senha atual, nova senha e confirmação.", "error");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showToast("A confirmação da nova senha não confere.", "error");
      return;
    }
    if (newPassword.length < 8) {
      showToast("A nova senha precisa ter pelo menos 8 caracteres.", "error");
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      showToast("A nova senha precisa ter letras e números.", "error");
      return;
    }

    try {
      setPasswordSaving(true);
      await runWithAuth((token) => userApi.changePassword(token, {
        currentPassword,
        newPassword,
        confirmNewPassword,
      }));
      showToast("Senha alterada com sucesso.", "success");
      setPasswordModalVisible(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao alterar senha.";
      showToast(message, "error");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function submitRecoveryEmail() {
    const normalized = recoveryEmail.trim().toLowerCase();
    if (!normalized) {
      showToast("Informe o e-mail de recuperação.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      showToast("E-mail de recuperação inválido.", "error");
      return;
    }

    try {
      setRecoverySaving(true);
      const payload = await runWithAuth((token) => userApi.upsertRecoveryEmail(token, normalized));
      setAccountEmail(payload.accountEmail);
      setRecoveryEmail(payload.recoveryEmail);
      setCustomRecoveryEmail(payload.custom);
      showToast("E-mail de recuperação atualizado.", "success");
      setRecoveryModalVisible(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao atualizar e-mail de recuperação.";
      showToast(message, "error");
    } finally {
      setRecoverySaving(false);
    }
  }

  async function submitAccountEmailChange() {
    const normalized = newAccountEmail.trim().toLowerCase();
    const normalizedConfirm = confirmAccountEmail.trim().toLowerCase();

    if (!normalized || !normalizedConfirm) {
      showToast("Informe e confirme o novo e-mail.", "error");
      return;
    }
    if (normalized !== normalizedConfirm) {
      showToast("A confirmação do e-mail não confere.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      showToast("E-mail inválido.", "error");
      return;
    }
    if (accountEmail && normalized === accountEmail.toLowerCase()) {
      showToast("O novo e-mail é igual ao e-mail atual.", "info");
      return;
    }

    try {
      setEmailSaving(true);
      await runWithAuth((token) => userApi.updateMe(token, { email: normalized }));
      await Promise.all([loadRecoveryEmail(), refreshSession()]);
      showToast("E-mail de login atualizado.", "success");
      setEmailModalVisible(false);
      setNewAccountEmail("");
      setConfirmAccountEmail("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao atualizar e-mail de login.";
      showToast(message, "error");
    } finally {
      setEmailSaving(false);
    }
  }

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

        <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
          {navigation?.canGoBack?.() ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="chevron-back" size={20} color={theme.text2} />
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }}>
            <MvText variant="semi1">Segurança</MvText>
            <MvText variant="body4" color="secondary">Proteja sua conta</MvText>
          </View>
        </View>

        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 4 }}>Acesso à conta</MvText>
            <View style={{ height: 1, backgroundColor: theme.borderSub, marginBottom: 4 }} />
            <ActionRow
              icon="lock-closed-outline"
              title="Alterar senha"
              subtitle="Confirma a senha atual antes de salvar"
              onPress={() => setPasswordModalVisible(true)}
            />
            <View style={{ height: 1, backgroundColor: theme.borderSub }} />
            <ActionRow
              icon="at-outline"
              title="Alterar e-mail de login"
              subtitle={accountEmail ? `Atual: ${accountEmail}` : "Defina o e-mail usado para entrar no app"}
              onPress={() => {
                setNewAccountEmail("");
                setConfirmAccountEmail("");
                setEmailModalVisible(true);
              }}
            />
            <View style={{ height: 1, backgroundColor: theme.borderSub }} />
            <ActionRow
              icon="mail-outline"
              title="E-mail de recuperação"
              subtitle={recoveryLoading
                ? "Carregando..."
                : `Recebimento em: ${recoveryEmail || accountEmail || "não definido"}`}
              badge={{ label: customRecoveryEmail ? "Personalizado" : "Conta", variant: customRecoveryEmail ? "orange" : "green" }}
              onPress={() => setRecoveryModalVisible(true)}
            />
          </MvCard>

          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 4 }}>Autenticação em dois fatores</MvText>
            <View style={{ height: 1, backgroundColor: theme.borderSub, marginBottom: 4 }} />
            <ActionRow
              icon="shield-checkmark-outline"
              title="Verificação por SMS / app autenticador"
              subtitle="Aumenta a segurança do login"
              badge={{ label: "Em breve", variant: "gray" }}
              iconColor="#FF9800"
            />
          </MvCard>

          <MvText variant="body4" color="tertiary" style={{ textAlign: "center" }}>
            Em caso de acesso não autorizado, entre em contato via Suporte imediatamente.
          </MvText>
        </ScrollView>
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={passwordModalVisible}
        onRequestClose={() => setPasswordModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 }}>
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setPasswordModalVisible(false)}
          />
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 10 }}>
            <MvText variant="semi1">Alterar senha</MvText>
            <MvInput
              label="Senha atual"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <MvInput
              label="Nova senha"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <MvInput
              label="Confirmar nova senha"
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvButton
                variant="outline"
                style={{ flex: 1 }}
                label="Cancelar"
                onPress={() => setPasswordModalVisible(false)}
              />
              <MvButton
                style={{ flex: 1 }}
                label="Alterar senha"
                loading={passwordSaving}
                onPress={() => void submitPasswordChange()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={emailModalVisible}
        onRequestClose={() => setEmailModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 }}>
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setEmailModalVisible(false)}
          />
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 10 }}>
            <MvText variant="semi1">Alterar e-mail de login</MvText>
            <MvText variant="body4" color="secondary">
              E-mail atual: {accountEmail || "não informado"}
            </MvText>
            <MvInput
              label="Novo e-mail"
              value={newAccountEmail}
              onChangeText={setNewAccountEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <MvInput
              label="Confirmar novo e-mail"
              value={confirmAccountEmail}
              onChangeText={setConfirmAccountEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvButton
                variant="outline"
                style={{ flex: 1 }}
                label="Cancelar"
                onPress={() => setEmailModalVisible(false)}
              />
              <MvButton
                style={{ flex: 1 }}
                label="Salvar e-mail"
                loading={emailSaving}
                onPress={() => void submitAccountEmailChange()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={recoveryModalVisible}
        onRequestClose={() => setRecoveryModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 }}>
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setRecoveryModalVisible(false)}
          />
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 10 }}>
            <MvText variant="semi1">E-mail de recuperação</MvText>
            <MvText variant="body4" color="secondary">
              Defina qual e-mail deve receber confirmações de recuperação de senha.
            </MvText>
            <MvInput
              label="E-mail de recuperação"
              value={recoveryEmail}
              onChangeText={setRecoveryEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder={accountEmail || "email@exemplo.com"}
            />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvButton
                variant="outline"
                style={{ flex: 1 }}
                label="Cancelar"
                onPress={() => setRecoveryModalVisible(false)}
              />
              <MvButton
                style={{ flex: 1 }}
                label="Salvar e-mail"
                loading={recoverySaving}
                onPress={() => void submitRecoveryEmail()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
