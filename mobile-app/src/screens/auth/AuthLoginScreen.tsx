import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { MvButton } from "../../components/mv/MvButton";
import { MvInput } from "../../components/mv/MvInput";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { AppLogoText } from "../../components/ui/AppLogoText";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

const REMEMBER_ME_KEY = "@muvify/rememberMeEmail";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function AuthLoginScreen({ navigation }: Props) {
  const { login, showToast, clearToast, isAuthenticated } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const submittingRef = useRef(false);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const passwordRef = useRef<any>(null);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    AsyncStorage.getItem(REMEMBER_ME_KEY).then((saved) => {
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    }).catch(() => {});
  }, []);

  async function handleLogin() {
    if (submittingRef.current) return;
    if (!email.trim() || !password.trim()) {
      showToast("Preencha e-mail e senha.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showToast("Digite um e-mail válido.", "error");
      return;
    }
    submittingRef.current = true;
    try {
      setLoading(true);
      clearToast();
      if (rememberMe) {
        await AsyncStorage.setItem(REMEMBER_ME_KEY, email.trim().toLowerCase());
      } else {
        await AsyncStorage.removeItem(REMEMBER_ME_KEY);
      }
      const result = await login({ email: email.trim().toLowerCase(), password });
      if (result?.requiresTwoFactor) {
        navigation.navigate("TwoFactor", { challengeToken: result.challengeToken });
        return;
      }
      clearToast();
    } catch (error) {
      if (isAuthenticatedRef.current) return;
      const message = error instanceof Error ? error.message : "Falha ao fazer login.";
      showToast(message, "error");
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.auth.login"
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: S.px,
          paddingTop: insets.top + 52,
          paddingBottom: Math.max(insets.bottom + 24, 32),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo da marca — elemento de brand com dois tons de cor */}
        <View style={{ marginBottom: 36 }}>
          <AppLogoText size={28} />
        </View>

        <MvText variant="display" style={{ marginBottom: 6 }}>Bem-vindo</MvText>
        <MvText variant="body3" color="secondary" style={{ marginBottom: 28, lineHeight: 22 }}>
          Entre na sua conta para continuar.
        </MvText>

        <View style={{ gap: 12 }}>
          <MvInput
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            testID="input.auth.login.email"
          />
          <MvInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="done"
            onSubmitEditing={() => void handleLogin()}
            testID="input.auth.login.password"
          />
        </View>

        {/* Lembrar e-mail + Esqueci senha */}
        <View style={{
          flexDirection: "row", alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12, marginBottom: 20,
        }}>
          <PressableScale
            onPress={() => setRememberMe((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityLabel="Lembrar e-mail"
            style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingRight: 8 }}
          >
            <View style={{
              width: 20, height: 20, borderRadius: 6,
              borderWidth: 1.5,
              borderColor: rememberMe ? theme.primary : theme.border,
              backgroundColor: rememberMe ? theme.primarySubtle : "transparent",
              alignItems: "center", justifyContent: "center",
            }}>
              {rememberMe ? <Ionicons name="checkmark" size={13} color={theme.primary} /> : null}
            </View>
            <MvText variant="label" color="secondary">Lembrar e-mail</MvText>
          </PressableScale>

          <PressableScale
            onPress={() => navigation.navigate("ForgotPassword")}
            accessibilityRole="button"
            accessibilityLabel="Esqueci minha senha"
            testID="button.auth.login.forgot-password"
            style={{ minHeight: 44, paddingLeft: 8, justifyContent: "center" }}
          >
            <MvText variant="label" style={{ color: theme.primary }}>Esqueci minha senha</MvText>
          </PressableScale>
        </View>

        <MvButton
          label={loading ? "Entrando..." : "Entrar"}
          disabled={loading}
          loading={loading}
          onPress={() => void handleLogin()}
          testID="button.auth.login.submit"
        />

        {/* Divider */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 16 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
          <MvText variant="caption" color="tertiary">ou</MvText>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.border }} />
        </View>

        <MvButton
          variant="outline"
          label="Criar conta"
          onPress={() => navigation.navigate("ProfileSelection")}
          testID="button.auth.login.go-register"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
