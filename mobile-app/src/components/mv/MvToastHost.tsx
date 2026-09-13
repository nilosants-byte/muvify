import React from "react";
import { Modal, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { C } from "../../theme/v2tokens";

// Frente 10 (segunda camada), Lote 11: migrado de components/primitives.tsx
// (sistema de design legado, removido) — único componente de lá com uso
// real, em root-stack.tsx.
export function MvToastHost({
  message,
  type = "info",
}: {
  message: string;
  type?: "info" | "success" | "error";
}) {
  const insets = useSafeAreaInsets();
  const { theme: mvTheme } = useMvTheme();

  const bg =
    type === "success" ? mvTheme.primary
    : type === "error"  ? mvTheme.danger
    : C.surface1;
  const textColor = type === "success" ? mvTheme.textOnPrimary : C.white;
  const hasBorder = type === "info";

  // Um <Modal> do React Native sempre renderiza numa camada nativa
  // propria, acima de QUALQUER outra view da arvore -- nenhum zIndex
  // daqui alcanca por cima disso. Resultado: um toast disparado enquanto
  // uma tela tem um modal proprio aberto (ex: bottom sheet de "novo
  // horario") ficava escondido atras dele, parecendo que o app nao
  // respondeu ao toque. Envolver o proprio toast num Modal transparente
  // resolve isso -- ele nasce depois do modal da tela (ja aberto), entao
  // fica por cima. pointerEvents="box-none" deixa toques fora do balao
  // do toast passarem direto pro que estiver embaixo.
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={() => {}}>
    <View style={{ flex: 1 }} pointerEvents="box-none">
    <View
      style={{
        position: "absolute",
        alignSelf: "center",
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 999,
        maxWidth: 480,
        bottom: Math.max(24, insets.bottom + 16),
        backgroundColor: bg,
        borderWidth: hasBorder ? 1 : 0,
        borderColor: "rgba(255,255,255,0.14)",
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
      }}
      accessibilityLiveRegion="polite"
      accessibilityRole={type === "error" ? "alert" : "text"}
    >
      <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color: textColor, textAlign: "center" }}>
        {message}
      </Text>
    </View>
    </View>
    </Modal>
  );
}
