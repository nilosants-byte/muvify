import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
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

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!email.trim()) { showToast("Informe seu e-mail.", "error"); return; }
    try {
      setLoading(true);
      hapticCta();
      await authApi.forgotPassword({ email: email.trim().toLowerCase(), channel: "EMAIL" });
    } catch {
      // Silenciar erro — não revelar se email existe ou não (segurança)
    } finally { setLoading(false); }
    // Sempre navegar e mostrar mensagem genérica, independente do resultado
    showToast("Se o e-mail estiver cadastrado, você receberá as instruções em breve.", "success");
    setEmail("");
    navigation.navigate("ResetPassword", undefined);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.auth.forgot-password"
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
          paddingTop: 40,
          paddingBottom: Math.max(insets.bottom + 24, 40),
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          alignSelf: "center", width: 80, height: 80, borderRadius: 24,
          backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
          alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name="lock-open-outline" size={36} color={theme.primary} />
        </View>

        <View style={{ alignItems: "center", gap: 8 }}>
          <MvText variant="display" style={{ textAlign: "center" }}>Recuperar senha</MvText>
          <MvText variant="body3" color="secondary" style={{ textAlign: "center", lineHeight: 22 }}>
            Informe seu e-mail para receber o código de recuperação.
          </MvText>
        </View>

        <MvInput
          value={email}
          onChangeText={setEmail}
          placeholder="seu@email.com"
          autoCapitalize="none"
          keyboardType="email-address"
          testID="input.auth.forgot.email"
        />

        <MvButton
          label={loading ? "Enviando..." : "Enviar código"}
          disabled={loading}
          loading={loading}
          onPress={() => void handleSend()}
          testID="button.auth.forgot.submit"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
