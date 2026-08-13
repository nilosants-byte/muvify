import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { MvButton } from "../../components/mv/MvButton";
import { MvInput } from "../../components/mv/MvInput";
import { MvText } from "../../components/mv/MvText";
import { useMvTheme } from "../../theme/MvThemeContext";
import { extractApiMessage } from "../shared/api-helpers";
import { captureException } from "../../observability/sentry";

type Props = NativeStackScreenProps<AuthStackParamList, "TwoFactor">;

export function AuthTwoFactorScreen({ route, navigation }: Props) {
  const { challengeToken } = route.params;
  const { completeTwoFactorLogin, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  async function handleVerify() {
    const trimmed = code.trim();
    if (!trimmed) {
      showToast("Informe o código de verificação.", "error");
      return;
    }
    try {
      setLoading(true);
      await completeTwoFactorLogin(challengeToken, trimmed);
    } catch (error) {
      // Frente 13 (segunda camada), Lote 10: verificação de 2FA nunca
      // capturava falha — um erro real (500/bug), não só "código errado",
      // nunca chegava ao Sentry.
      captureException(error, { screen: "AuthTwoFactorScreen" });
      showToast(extractApiMessage(error, "Código inválido ou expirado."), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 48, gap: 24 }}>
        <View style={{ gap: 8 }}>
          <MvText variant="h2">
            {useBackup ? "Código de backup" : "Autenticação em dois fatores"}
          </MvText>
          <MvText variant="body2" color="secondary">
            {useBackup
              ? "Digite um dos seus códigos de backup de 16 caracteres."
              : "Digite o código de 6 dígitos gerado pelo seu app autenticador."}
          </MvText>
        </View>

        <MvInput
          label={useBackup ? "Código de backup" : "Código TOTP"}
          value={code}
          onChangeText={setCode}
          placeholder={useBackup ? "xxxxxxxxxxxxxxxx" : "000000"}
          keyboardType={useBackup ? "default" : "number-pad"}
          maxLength={useBackup ? 16 : 6}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
        />

        <MvButton
          label="Verificar"
          onPress={handleVerify}
          loading={loading}
          disabled={code.trim().length < 6}
        />

        <MvButton
          label={useBackup ? "Usar app autenticador" : "Usar código de backup"}
          variant="ghost"
          onPress={() => { setUseBackup(!useBackup); setCode(""); }}
        />

        <MvButton
          label="Voltar ao login"
          variant="ghost"
          onPress={() => navigation.navigate("Login")}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
