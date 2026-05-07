import React, { useMemo, useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { authApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvInput, MvText } from "../../components/mv";

type Props = NativeStackScreenProps<AuthStackParamList, "ResetPassword">;

export function ResetPasswordScreen({ navigation, route }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState(route.params?.token ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    if (token.trim().length < 6) return false;
    if (newPassword.length < 8) return false;
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return false;
    return confirmPassword === newPassword;
  }, [confirmPassword, newPassword, token]);

  async function handleSubmit() {
    if (!canSubmit) {
      showToast("Revise o token e a senha antes de confirmar.", "error");
      return;
    }
    try {
      setLoading(true);
      await authApi.resetPassword({ token: token.trim(), newPassword: newPassword.trim() });
      showToast("Senha redefinida com sucesso. Faça login.", "success");
      navigation.navigate("Login");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao redefinir senha.";
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }} testID="screen.auth.reset-password">
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60, gap: 16 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        <MvText variant="h3" style={{ textAlign: "center", marginTop: 24 }}>Nova senha</MvText>
        <MvText variant="body3" color="secondary" style={{ textAlign: "center" }}>
          Informe o código recebido por e-mail e defina sua nova senha.
        </MvText>

        <View style={{ gap: 14, marginTop: 8 }}>
          <MvInput
            autoCapitalize="none"
            testID="input.auth.reset.token"
            label="Código de recuperação"
            placeholder="Cole o código recebido"
            value={token}
            onChangeText={setToken}
          />
          <MvInput
            label="Nova senha"
            placeholder="Mínimo 8 caracteres"
            secureTextEntry
            testID="input.auth.reset.password"
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <MvInput
            label="Confirmar nova senha"
            placeholder="Repita a nova senha"
            secureTextEntry
            testID="input.auth.reset.confirm-password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onSubmitEditing={() => void handleSubmit()}
          />

          <View style={{ borderRadius: 11, borderWidth: 1, borderColor: theme.inputBorder, backgroundColor: theme.inputBg, padding: 12 }}>
            <MvText variant="body4" color="secondary">A senha deve conter letras e números.</MvText>
          </View>
        </View>

        <MvButton
          disabled={!canSubmit}
          loading={loading}
          label="Confirmar nova senha"
          onPress={() => void handleSubmit()}
          style={{ marginTop: 8 }}
          testID="button.auth.reset.submit"
        />
      </ScrollView>
    </View>
  );
}
