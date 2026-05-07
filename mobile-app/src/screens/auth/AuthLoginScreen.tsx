import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useMvTheme } from "../../theme/MvThemeContext";
import { typography } from "../../theme/MvTypography";
import { MvButton, MvInput, MvText } from "../../components/mv";
import { useAppState } from "../../state/AppState";

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

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // Load saved email on mount
  useEffect(() => {
    AsyncStorage.getItem(REMEMBER_ME_KEY).then((saved) => {
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    });
  }, []);

  async function handleLogin() {
    if (submittingRef.current) {
      return;
    }
    if (!email.trim() || !password.trim()) {
      showToast("Preencha e-mail e senha.", "error");
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
      await login({ email: email.trim().toLowerCase(), password });
      clearToast();
    } catch (error) {
      // If another concurrent submit already authenticated the user, ignore stale errors.
      if (isAuthenticatedRef.current) {
        return;
      }
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
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />
      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: insets.top + 52,
          paddingBottom: 32,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      >
        {/* Logo muvify */}
        <View style={{ marginBottom: 36 }}>
          <Text style={{ fontFamily: "Syne-Bold", fontSize: 28, letterSpacing: -1.4, lineHeight: 32 }}>
            <Text style={{ color: theme.mode === "dark" ? "#ddeae0" : "#111111" }}>muvi</Text>
            <Text style={{ color: theme.textGreen }}>fy</Text>
          </Text>
        </View>

        <MvText variant="h2" style={{ marginBottom: 6 }}>Bem-vindo</MvText>
        <MvText variant="body3" color="secondary" style={{ marginBottom: 28 }}>
          Entre na sua conta para continuar.
        </MvText>

        <View style={{ gap: 14 }}>
          <MvInput
            label="E-mail"
            placeholder="seu@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            testID="input.auth.login.email"
            value={email}
            onChangeText={setEmail}
          />
          <MvInput
            label="Senha"
            placeholder="••••••••"
            secureTextEntry
            testID="input.auth.login.password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void handleLogin()}
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 20 }}>
          {/* Lembrar de mim */}
          <TouchableOpacity
            hitSlop={8}
            onPress={() => setRememberMe((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            activeOpacity={0.7}
          >
            <View style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              borderWidth: 1.5,
              borderColor: rememberMe ? "rgba(76,175,80,0.70)" : theme.border,
              backgroundColor: rememberMe ? "rgba(76,175,80,0.15)" : "transparent",
              alignItems: "center",
              justifyContent: "center",
            }}>
              {rememberMe ? <Ionicons name="checkmark" size={13} color={theme.textGreen} /> : null}
            </View>
            <MvText variant="body4" color="secondary">Lembrar e-mail</MvText>
          </TouchableOpacity>

          <TouchableOpacity
            hitSlop={8}
            onPress={() => navigation.navigate("ForgotPassword")}
            testID="button.auth.login.forgot-password"
          >
            <MvText variant="semi3" color="green">Esqueci minha senha</MvText>
          </TouchableOpacity>
        </View>

        <MvButton
          label="Entrar"
          loading={loading}
          onPress={() => void handleLogin()}
          testID="button.auth.login.submit"
        />

        {/* Divider */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 16 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.borderSub }} />
          <Text style={[typography.body4, { color: theme.text3, fontSize: 10 }]}>ou</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.borderSub }} />
        </View>

        <MvButton
          label="Criar conta"
          variant="outline"
          onPress={() => navigation.navigate("Register")}
          testID="button.auth.login.go-register"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
