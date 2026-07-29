import React, { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvCard, MvInput, MvText } from "../../components/mv";
import { PressableScale } from "../../components/polish/PressableScale";
import { ScreenEntrance } from "../../components/polish/ScreenEntrance";
import { ProfessionalScreenHeader } from "../../components/navigation/ProfessionalScreenHeader";
import { useAppState } from "../../state/AppState";
import { authApi, userApi } from "../../services/api/client";
import { useAuthQuery } from "../../hooks/useAuthQuery";
import { queryKeys } from "../../lib/queryKeys";

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
    <PressableScale
      scale={0.98}
      onPress={onPress}
      disabled={!onPress}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 12 }}
    >
      <View style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        backgroundColor: `${iconColor ?? theme.textGreen}18`,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <Ionicons name={icon} size={18} color={iconColor ?? theme.textGreen} />
      </View>
      <View style={{ flex: 1 }}>
        <MvText variant="semi3">{title}</MvText>
        <MvText variant="body4" color="secondary">{subtitle}</MvText>
      </View>
      {badge ? <MvBadge label={badge.label} variant={badge.variant} /> : null}
      {onPress && !badge ? <Ionicons name="chevron-forward" size={16} color={theme.text3} /> : null}
    </PressableScale>
  );
}

export function SecurityScreen({ navigation }: { navigation?: any }) {
  const { theme } = useMvTheme();
  const { runWithAuth, showToast, user, setCurrentUser } = useAppState();
  const queryClient = useQueryClient();

  const recoveryEmailQuery = useAuthQuery(
    queryKeys.user.recoveryEmail(),
    (t) => userApi.getRecoveryEmail(t),
  );
  const accountEmail = recoveryEmailQuery.data?.accountEmail ?? "";
  const customRecoveryEmail = recoveryEmailQuery.data?.custom ?? false;
  const recoveryLoading = recoveryEmailQuery.isLoading;

  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [recoveryModalVisible, setRecoveryModalVisible] = useState(false);
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [editRecoveryEmail, setEditRecoveryEmail] = useState("");

  // Raio-X de pagamentos, Rodada 4, Lote 12: o backend de 2FA (setup/confirm/
  // disable) já existia inteiro — só a UI ficava travada num "Em breve"
  // permanente. Vira pré-requisito real pra tela admin ganhar o aviso de
  // "configure 2FA obrigatório".
  const [twoFactorSetupVisible, setTwoFactorSetupVisible] = useState(false);
  const [settingUpTwoFactor, setSettingUpTwoFactor] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [manualEntryKey, setManualEntryKey] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmingTwoFactor, setConfirmingTwoFactor] = useState(false);
  const [backupCodesVisible, setBackupCodesVisible] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  const [disableTwoFactorVisible, setDisableTwoFactorVisible] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disablingTwoFactor, setDisablingTwoFactor] = useState(false);

  async function startTwoFactorSetup() {
    try {
      setSettingUpTwoFactor(true);
      const result = await runWithAuth((token) => authApi.setupTwoFactor(token));
      setQrCodeDataUrl(result.qrCodeDataUrl);
      setManualEntryKey(result.manualEntryKey);
      setConfirmCode("");
      setTwoFactorSetupVisible(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao iniciar configuração de 2FA.";
      showToast(message, "error");
    } finally {
      setSettingUpTwoFactor(false);
    }
  }

  async function submitTwoFactorConfirm() {
    if (confirmCode.trim().length !== 6) {
      showToast("Informe o código de 6 dígitos do seu app autenticador.", "error");
      return;
    }
    try {
      setConfirmingTwoFactor(true);
      const result = await runWithAuth((token) => authApi.confirmTwoFactor(token, confirmCode.trim()));
      setTwoFactorSetupVisible(false);
      setBackupCodes(result.backupCodes);
      setBackupCodesVisible(true);
      if (user) setCurrentUser({ ...user, twoFactorEnabled: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Código inválido.";
      showToast(message, "error");
    } finally {
      setConfirmingTwoFactor(false);
    }
  }

  async function submitDisableTwoFactor() {
    if (!disablePassword || disableCode.trim().length !== 6) {
      showToast("Informe sua senha e o código de 6 dígitos.", "error");
      return;
    }
    try {
      setDisablingTwoFactor(true);
      await runWithAuth((token) => authApi.disableTwoFactor(token, disablePassword, disableCode.trim()));
      showToast("Autenticação em dois fatores desativada.", "success");
      setDisableTwoFactorVisible(false);
      setDisablePassword("");
      setDisableCode("");
      if (user) setCurrentUser({ ...user, twoFactorEnabled: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao desativar 2FA.";
      showToast(message, "error");
    } finally {
      setDisablingTwoFactor(false);
    }
  }

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
    const normalized = editRecoveryEmail.trim().toLowerCase();
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
      queryClient.setQueryData(queryKeys.user.recoveryEmail(), payload);
      showToast("E-mail de recuperação atualizado.", "success");
      setRecoveryModalVisible(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao atualizar e-mail de recuperação.";
      showToast(message, "error");
    } finally {
      setRecoverySaving(false);
    }
  }

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
        <ProfessionalScreenHeader title="Segurança" onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined} />

        <ScreenEntrance>
        <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false}>
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
            {/* Raio-X de pagamentos, Rodada 4, Lote 11: essa ação sempre lançava
                "Mudança de e-mail temporariamente indisponível" — não existe
                endpoint dedicado ainda. Mesmo tratamento "Em breve" já usado
                pra 2FA, em vez de deixar o usuário preencher o formulário só
                pra descobrir que não funciona. */}
            <ActionRow
              icon="at-outline"
              title="Alterar e-mail de login"
              subtitle={accountEmail ? `Atual: ${accountEmail}` : "Defina o e-mail usado para entrar no app"}
              badge={{ label: "Em breve", variant: "gray" }}
            />
            <View style={{ height: 1, backgroundColor: theme.borderSub }} />
            <ActionRow
              icon="mail-outline"
              title="E-mail de recuperação"
              subtitle={recoveryLoading
                ? "Carregando..."
                : `Recebimento em: ${recoveryEmailQuery.data?.recoveryEmail || accountEmail || "não definido"}`}
              badge={{ label: customRecoveryEmail ? "Personalizado" : "Conta", variant: customRecoveryEmail ? "orange" : "green" }}
              onPress={() => {
                setEditRecoveryEmail(recoveryEmailQuery.data?.recoveryEmail ?? "");
                setRecoveryModalVisible(true);
              }}
            />
          </MvCard>

          <MvCard>
            <MvText variant="semi2" style={{ marginBottom: 4 }}>Autenticação em dois fatores</MvText>
            <View style={{ height: 1, backgroundColor: theme.borderSub, marginBottom: 4 }} />
            <ActionRow
              icon="shield-checkmark-outline"
              title="App autenticador (Google Authenticator, Authy, etc.)"
              subtitle={user?.twoFactorEnabled ? "Ativo — toque para desativar" : "Aumenta a segurança do login"}
              badge={user?.twoFactorEnabled ? { label: "Ativo", variant: "green" } : undefined}
              onPress={user?.twoFactorEnabled ? () => setDisableTwoFactorVisible(true) : () => void startTwoFactorSetup()}
              iconColor="#FF9800"
            />
          </MvCard>

          <MvText variant="body4" color="tertiary" style={{ textAlign: "center" }}>
            Em caso de acesso não autorizado, entre em contato via Suporte imediatamente.
          </MvText>
        </ScrollView>
        </ScreenEntrance>
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
              value={editRecoveryEmail}
              onChangeText={setEditRecoveryEmail}
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

      <Modal
        transparent
        animationType="fade"
        visible={twoFactorSetupVisible}
        onRequestClose={() => setTwoFactorSetupVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 }}>
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setTwoFactorSetupVisible(false)}
          />
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 10 }}>
            <MvText variant="semi1">Configurar autenticação em dois fatores</MvText>
            <MvText variant="body4" color="secondary">
              Escaneie o QR code com seu app autenticador (Google Authenticator, Authy, etc.) e digite o código de 6
              dígitos gerado.
            </MvText>
            {qrCodeDataUrl ? (
              <View style={{ alignItems: "center", paddingVertical: 8 }}>
                <Image source={{ uri: qrCodeDataUrl }} style={{ width: 180, height: 180 }} />
              </View>
            ) : null}
            {manualEntryKey ? (
              <MvText variant="caption" color="secondary" style={{ textAlign: "center" }}>
                Não consegue escanear? Digite manualmente: {manualEntryKey}
              </MvText>
            ) : null}
            <MvInput
              label="Código de 6 dígitos"
              value={confirmCode}
              onChangeText={(t) => setConfirmCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="numeric"
              maxLength={6}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvButton
                variant="outline"
                style={{ flex: 1 }}
                label="Cancelar"
                onPress={() => setTwoFactorSetupVisible(false)}
              />
              <MvButton
                style={{ flex: 1 }}
                label="Confirmar"
                loading={confirmingTwoFactor}
                onPress={() => void submitTwoFactorConfirm()}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={backupCodesVisible}
        onRequestClose={() => setBackupCodesVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 }}>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 10 }}>
            <MvText variant="semi1">Dois fatores ativado</MvText>
            <MvText variant="body4" color="secondary">
              Guarde estes códigos de recuperação em um lugar seguro — cada um só pode ser usado uma vez, caso você
              perca acesso ao seu app autenticador.
            </MvText>
            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: theme.borderSub, padding: 10, gap: 4 }}>
              {backupCodes.map((code) => (
                <MvText key={code} variant="body3" style={{ fontFamily: "monospace" as any }}>{code}</MvText>
              ))}
            </View>
            <MvButton label="Concluir" onPress={() => setBackupCodesVisible(false)} />
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={disableTwoFactorVisible}
        onRequestClose={() => setDisableTwoFactorVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 }}>
          <Pressable
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            onPress={() => setDisableTwoFactorVisible(false)}
          />
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardBg, padding: 16, gap: 10 }}>
            <MvText variant="semi1">Desativar dois fatores</MvText>
            <MvInput
              label="Senha atual"
              value={disablePassword}
              onChangeText={setDisablePassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <MvInput
              label="Código de 6 dígitos"
              value={disableCode}
              onChangeText={(t) => setDisableCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="numeric"
              maxLength={6}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <MvButton
                variant="outline"
                style={{ flex: 1 }}
                label="Cancelar"
                onPress={() => setDisableTwoFactorVisible(false)}
              />
              <MvButton
                variant="danger"
                style={{ flex: 1 }}
                label="Desativar"
                loading={disablingTwoFactor}
                onPress={() => void submitDisableTwoFactor()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
