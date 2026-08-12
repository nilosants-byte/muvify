import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { authApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { MvButton } from "../../components/mv/MvButton";
import { MvInput } from "../../components/mv/MvInput";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { C, S } from "../../theme/v2tokens";
import { hapticCta } from "../../utils/haptics";
import { useMvTheme } from "../../theme/MvThemeContext";
import { extractApiMessage } from "../shared/api-helpers";

type Props = NativeStackScreenProps<AuthStackParamList, "ResetPassword">;

export function ResetPasswordScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState(route.params?.token ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    if (token.trim().length < 6) return false;
    if (newPassword.length < 8 || newPassword.length > 72) return false;
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return false;
    return confirmPassword === newPassword;
  }, [confirmPassword, newPassword, token]);

  async function handleSubmit() {
    if (!token.trim()) { showToast("Token inválido. Solicite um novo link.", "error"); return; }
    if (newPassword.length > 72) { showToast("A senha não pode ter mais de 72 caracteres.", "error"); return; }
    if (!canSubmit) { showToast("Revise o token e a senha antes de confirmar.", "error"); return; }
    try {
      setLoading(true);
      hapticCta();
      await authApi.resetPassword({ token: token.trim(), newPassword: newPassword.trim() });
      showToast("Senha redefinida com sucesso. Faça login.", "success");
      navigation.navigate("Login");
    } catch (error) {
      showToast(extractApiMessage(error, "Falha ao redefinir senha."), "error");
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.auth.reset-password"
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 14, paddingHorizontal: S.px, paddingBottom: 10,
        flexDirection: "row", alignItems: "center",
        borderBottomWidth: 1, borderBottomColor: theme.border,
      }}>
        <PressableScale
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1, borderColor: theme.border,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text1} />
        </PressableScale>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingHorizontal: S.px,
          paddingBottom: Math.max(insets.bottom + 24, 40),
          paddingTop: 32,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 22,
            backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="key-outline" size={32} color={theme.primary} />
          </View>
          <MvText variant="display" style={{ textAlign: "center" }}>Nova senha</MvText>
          <MvText variant="body3" color="secondary" style={{ textAlign: "center", lineHeight: 22 }}>
            Informe o código recebido por e-mail e defina sua nova senha.
          </MvText>
        </View>

        <MvInput
          value={token}
          onChangeText={setToken}
          placeholder="Código de recuperação"
          autoCapitalize="none"
          testID="input.auth.reset.token"
        />
        <MvInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Nova senha (mínimo 8 caracteres)"
          secureTextEntry
          testID="input.auth.reset.password"
        />
        <MvInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirmar nova senha"
          secureTextEntry
          testID="input.auth.reset.confirm-password"
          onSubmitEditing={() => void handleSubmit()}
        />

        {/* Critérios de senha com feedback em tempo real */}
        {newPassword.length > 0 && (
          <View style={{ gap: 4 }}>
            {[
              { ok: token.trim().length >= 6, label: "Código com 6+ caracteres" },
              { ok: newPassword.length >= 8, label: "Senha com 8+ caracteres" },
              { ok: /[A-Za-z]/.test(newPassword), label: "Contém letras" },
              { ok: /\d/.test(newPassword), label: "Contém números" },
              { ok: confirmPassword === newPassword && confirmPassword.length > 0, label: "Senhas coincidem" },
            ].map((c) => (
              <View key={c.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name={c.ok ? "checkmark-circle" : "ellipse-outline"} size={14} color={c.ok ? theme.primary : theme.text3} />
                <MvText variant="caption" style={{ color: c.ok ? theme.primary : theme.text3 }}>{c.label}</MvText>
              </View>
            ))}
          </View>
        )}

        <MvButton
          label={loading ? "Confirmando..." : "Confirmar nova senha"}
          disabled={!canSubmit || loading}
          loading={loading}
          onPress={() => void handleSubmit()}
          testID="button.auth.reset.submit"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
