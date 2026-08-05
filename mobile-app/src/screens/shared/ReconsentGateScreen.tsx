import React, { useState } from "react";
import { StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MvButton } from "../../components/mv/MvButton";
import { MvText } from "../../components/mv/MvText";
import { C, S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";
import { TERMS_VERSION } from "../../config/legal";
import { userApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";

// Épico de Frentes, Frente 11, Lote 2: POST /me/consent nunca era chamado
// pelo app - usuário sob versão desatualizada dos termos ficava
// indefinidamente sem re-aceitar. Gate bloqueante no mesmo padrão de
// OfflineRequiredScreen/SessionExpiredScreen, renderizado direto pelo
// RootNavigator quando needsReconsent: true.
export function ReconsentGateScreen() {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const { runWithAuth, syncCurrentUser, signOut, showToast } = useAppState();
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    setSubmitting(true);
    try {
      await runWithAuth((token) => userApi.recordConsent(token));
      await syncCurrentUser();
    } catch {
      showToast("Não foi possível registrar seu aceite. Tente novamente.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: S.px,
        paddingBottom: Math.max(insets.bottom + 16, 24),
        gap: 14
      }}
    >
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 22,
          backgroundColor: C.skyDim,
          borderWidth: 1,
          borderColor: C.skyBorder,
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <Ionicons name="document-text-outline" size={40} color={C.sky} />
      </View>
      <MvText variant="h2" style={{ textAlign: "center" }}>Termos atualizados</MvText>
      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 280, lineHeight: 22 }}>
        Atualizamos os Termos de Uso e a Política de Privacidade (versão {TERMS_VERSION}). Para continuar usando o Muvify, você precisa aceitar a nova versão.
      </MvText>
      <MvButton
        label="Aceitar e continuar"
        onPress={() => void handleAccept()}
        loading={submitting}
        style={{ maxWidth: 280, width: "100%" }}
      />
      <MvButton
        label="Sair da conta"
        variant="ghost"
        onPress={() => void signOut()}
        disabled={submitting}
        style={{ maxWidth: 280, width: "100%" }}
      />
    </View>
  );
}
