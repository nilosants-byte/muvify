import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { authApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvInput, MvText } from "../../components/mv";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const { showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    if (!email.trim()) {
      showToast("Informe seu e-mail.", "error");
      return;
    }

    try {
      setLoading(true);
      await authApi.forgotPassword({
        email: email.trim().toLowerCase(),
        channel: "EMAIL",
      });
      showToast("Código enviado! Verifique seu e-mail e cole o código na próxima tela.", "success");
      navigation.navigate("ResetPassword", undefined);
    } catch {
      showToast("Não foi possível enviar o código.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.auth.forgot-password"
    >
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      >
        {/* \u00CDcone tem\u00E1tico */}
        <View style={{ alignSelf: "center", width: 80, height: 80, borderRadius: 22, backgroundColor: theme.chipBg, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
          <Ionicons name="lock-open-outline" size={38} color={theme.textGreen} />
        </View>
        <MvText variant="h3" style={{ textAlign: "center", marginBottom: 8 }}>
          Recuperar senha
        </MvText>
        <MvText variant="body3" color="secondary" style={{ textAlign: "center", marginBottom: 24 }}>
          Informe seu e-mail para receber o código de recuperação.
        </MvText>

        <MvInput
          label="E-mail"
          placeholder="seu@email.com"
          autoCapitalize="none"
          keyboardType="email-address"
          testID="input.auth.forgot.email"
          value={email}
          onChangeText={setEmail}
          style={{ marginBottom: 24 }}
        />

        <MvButton
          label="Enviar código"
          loading={loading}
          onPress={() => void handleSend()}
          testID="button.auth.forgot.submit"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

