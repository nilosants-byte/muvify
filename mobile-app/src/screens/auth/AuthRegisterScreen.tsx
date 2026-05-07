import React, { useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvInput, MvText } from "../../components/mv";
import { useAppState } from "../../state/AppState";
import { TERMS_VERSION } from "../../config/legal";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function AuthRegisterScreen({ navigation }: Props) {
  const { register, role, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isProviderRegistration = role === "PROVIDER";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const termsVersion = TERMS_VERSION;

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      showToast("Preencha todos os campos.", "error");
      return;
    }
    if (!acceptedTerms) {
      showToast("Você precisa aceitar os termos para continuar.", "error");
      return;
    }
    try {
      setLoading(true);
      await register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim(),
        termsVersion,
        consentAccepted: true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao criar conta.";
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.bg }}
      testID="screen.auth.register"
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: insets.top + 40,
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

        <MvText variant="h2" style={{ marginBottom: 6 }}>Criar conta</MvText>
        <MvText variant="body3" color="secondary" style={{ marginBottom: 28 }}>
          Preencha seus dados para começar.
        </MvText>

        <View style={{ gap: 14 }}>
          <MvInput
            label={isProviderRegistration ? "Nome do(a) Personal Trainer" : "Nome completo"}
            placeholder={isProviderRegistration ? "Seu nome profissional" : "Seu nome"}
            autoCapitalize="words"
            testID="input.auth.register.name"
            value={name}
            onChangeText={setName}
          />
          <MvInput
            label="E-mail"
            placeholder="seu@email.com"
            autoCapitalize="none"
            keyboardType="email-address"
            testID="input.auth.register.email"
            value={email}
            onChangeText={setEmail}
          />
          <MvInput
            label="Telefone"
            placeholder="(11) 99999-9999"
            keyboardType="phone-pad"
            testID="input.auth.register.phone"
            value={phone}
            onChangeText={setPhone}
          />
          <MvInput
            label="Senha"
            placeholder="Mínimo 8 caracteres"
            secureTextEntry
            testID="input.auth.register.password"
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <TouchableOpacity
          onPress={() => setAcceptedTerms((current) => !current)}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 16 }}
          activeOpacity={0.85}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              borderWidth: 1.5,
              borderColor: acceptedTerms ? "#4CAF50" : theme.border,
              backgroundColor: acceptedTerms ? "rgba(76,175,80,0.18)" : "transparent",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {acceptedTerms ? <Ionicons name="checkmark" size={13} color={theme.textGreen} /> : null}
          </View>
          <MvText variant="body4" color="secondary" style={{ flex: 1 }}>
            Li e aceito os Termos de Uso e a Política de Privacidade (v{termsVersion}).
          </MvText>
        </TouchableOpacity>

        <MvButton
          label="Criar conta"
          loading={loading}
          disabled={loading || !acceptedTerms}
          onPress={() => void handleRegister()}
          style={{ marginTop: 24 }}
          testID="button.auth.register.submit"
        />

        <TouchableOpacity
          hitSlop={8}
          onPress={() => navigation.navigate("Login")}
          style={{ alignItems: "center", marginTop: 20 }}
          testID="button.auth.register.go-login"
        >
          <MvText variant="body4" color="green">Já tenho conta · Entrar</MvText>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
