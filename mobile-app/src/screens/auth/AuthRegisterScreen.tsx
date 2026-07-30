import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { TERMS_VERSION } from "../../config/legal";
import { MvButton } from "../../components/mv/MvButton";
import { MvInput } from "../../components/mv/MvInput";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { AppLogoText } from "../../components/ui/AppLogoText";
import { C, S, DISPLAY } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

function ApelidoInput({
  value,
  onChangeText,
  testID,
}: {
  value: string;
  onChangeText: (t: string) => void;
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);
  const { theme } = useMvTheme();
  return (
    <View style={{
      flexDirection: "row", alignItems: "center",
      borderWidth: 1, borderRadius: 11,
      paddingHorizontal: 13, paddingVertical: 11,
      backgroundColor: theme.inputBg,
      borderColor: focused ? theme.primarySubtleBorder : theme.borderMid,
      gap: 4,
    }}>
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 15, color: theme.primary }}>@</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="como seus amigos vão te encontrar"
        placeholderTextColor={theme.text3}
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={theme.primary}
        testID={testID}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ flex: 1, fontFamily: "DMSans_400Regular", fontSize: 15, color: theme.inputText, padding: 0 }}
      />
    </View>
  );
}

export function AuthRegisterScreen({ navigation }: Props) {
  const { register, role, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isProviderRegistration = role === "PROVIDER";

  const [name, setName] = useState("");
  const [apelido, setApelido] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const termsVersion = TERMS_VERSION;

  const emailRef = useRef<any>(null);
  const phoneRef = useRef<any>(null);
  const passwordRef = useRef<any>(null);
  const confirmPasswordRef = useRef<any>(null);

  const apelidoValid = apelido.length === 0 || /^[a-z0-9_]{3,30}$/.test(apelido);
  const apelidoError = apelido.length > 0 && !apelidoValid;

  function handleApelidoChange(text: string) {
    setApelido(text.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30));
  }

  function handlePhoneChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 11);
    let masked = digits;
    if (digits.length > 6) {
      masked = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    } else if (digits.length > 2) {
      masked = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    } else if (digits.length > 0) {
      masked = `(${digits}`;
    }
    setPhone(masked);
  }

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      showToast("Preencha todos os campos.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showToast("Digite um e-mail válido.", "error");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      showToast("Digite um telefone válido com DDD.", "error");
      return;
    }
    if (password.length < 8) {
      showToast("A senha deve ter pelo menos 8 caracteres.", "error");
      return;
    }
    if (password.length > 72) {
      showToast("A senha não pode ter mais de 72 caracteres.", "error");
      return;
    }
    // Frente 3 (Cadastro/onboarding), Lote 5: o backend já exige letra+
    // número (e recusa senhas comuns), mas o app só validava tamanho -
    // usuário só descobria a regra real depois de um "Erro de validação."
    // genérico. Espelha a mesma regra aqui pra dar feedback imediato.
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      showToast("A senha precisa ter letras e números.", "error");
      return;
    }
    if (apelidoError) {
      showToast("Apelido inválido. Use letras minúsculas, números e _.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showToast("As senhas não coincidem.", "error");
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
        apelido: apelido.trim() || undefined,
        email: email.trim().toLowerCase(),
        password,
        phone: phone.replace(/\D/g, ""),
        termsVersion,
        consentAccepted: true,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message.toLowerCase() : "";
      const message = raw.includes("email") && (raw.includes("already") || raw.includes("exists") || raw.includes("duplicate") || raw.includes("exist") || raw.includes("em uso") || raw.includes("cadastrado"))
        ? "Este e-mail já está cadastrado. Tente fazer login ou use outro e-mail."
        : error instanceof Error ? error.message : "Falha ao criar conta.";
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
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: S.px,
          paddingTop: insets.top + 32,
          paddingBottom: Math.max(insets.bottom + 24, 32),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo da marca */}
        <View style={{ marginBottom: 28 }}>
          <AppLogoText size={28} />
        </View>

        <MvText variant="display" style={{ marginBottom: 6 }}>Criar conta</MvText>
        <MvText variant="body3" color="secondary" style={{ marginBottom: 24, lineHeight: 22 }}>
          Preencha seus dados para começar.
        </MvText>

        <View style={{ gap: 12 }}>
          <MvInput
            value={name}
            onChangeText={setName}
            placeholder={isProviderRegistration ? "Seu nome profissional" : "Seu nome completo"}
            autoCapitalize="words"
            textContentType="name"
            autoComplete="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            testID="input.auth.register.name"
          />

          <View style={{ gap: 4 }}>
            <ApelidoInput
              value={apelido}
              onChangeText={handleApelidoChange}
              testID="input.auth.register.apelido"
            />
            {apelidoError ? (
              <MvText variant="body4" color="danger" style={{ paddingLeft: 4 }}>
                Apenas letras minúsculas, números e _ · mínimo 3 caracteres
              </MvText>
            ) : apelido.length === 0 ? (
              <MvText variant="body4" color="tertiary" style={{ paddingLeft: 4 }}>
                Opcional · gerado automaticamente se não informado
              </MvText>
            ) : (
              <MvText variant="body4" style={{ color: theme.primary, paddingLeft: 4 }}>
                @{apelido} ✓
              </MvText>
            )}
          </View>

          <MvInput
            ref={emailRef}
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => phoneRef.current?.focus()}
            testID="input.auth.register.email"
          />
          <MvInput
            ref={phoneRef}
            value={phone}
            onChangeText={handlePhoneChange}
            placeholder="(11) 99999-9999"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            testID="input.auth.register.phone"
          />
          <MvInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 8 caracteres"
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            onSubmitEditing={() => confirmPasswordRef.current?.focus()}
            testID="input.auth.register.password"
          />
          <MvInput
            ref={confirmPasswordRef}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirme sua senha"
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="done"
            onSubmitEditing={() => void handleRegister()}
            testID="input.auth.register.confirm-password"
          />
        </View>

        {/* Aceitar termos */}
        <PressableScale
          onPress={() => setAcceptedTerms((c) => !c)}
          accessibilityRole="checkbox"
          accessibilityLabel="Aceitar termos de uso e política de privacidade"
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 18, minHeight: 44 }}
        >
          <View style={{
            width: 20, height: 20, borderRadius: 6,
            borderWidth: 1.5,
            borderColor: acceptedTerms ? theme.primary : theme.border,
            backgroundColor: acceptedTerms ? theme.primarySubtle : "transparent",
            alignItems: "center", justifyContent: "center",
            marginTop: 2,
            flexShrink: 0,
          }}>
            {acceptedTerms ? <Ionicons name="checkmark" size={13} color={theme.primary} /> : null}
          </View>
          <MvText variant="body4" color="secondary" style={{ flex: 1, lineHeight: 20 }}>
            Li e aceito os Termos de Uso e a Política de Privacidade (v{termsVersion}).
          </MvText>
        </PressableScale>

        <MvButton
          label={loading ? "Criando conta..." : "Criar conta"}
          disabled={loading || !acceptedTerms}
          loading={loading}
          onPress={() => void handleRegister()}
          testID="button.auth.register.submit"
          style={{ marginTop: 22 }}
        />

        <PressableScale
          onPress={() => navigation.navigate("Login")}
          accessibilityRole="button"
          accessibilityLabel="Já tenho conta, ir para login"
          testID="button.auth.register.go-login"
          style={{ alignItems: "center", marginTop: 18, minHeight: 44, justifyContent: "center" }}
        >
          <MvText variant="semi3" style={{ color: theme.primary }}>
            Já tenho conta · Entrar
          </MvText>
        </PressableScale>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
