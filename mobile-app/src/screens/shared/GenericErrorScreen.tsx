import React from "react";
import { StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MvButton } from "../../components/mv/MvButton";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { C, S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

type Props = NativeStackScreenProps<any, "GenericError">;

export function GenericErrorScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const message = route?.params?.message as string | undefined;

  return (
    <View style={{
      flex: 1, backgroundColor: theme.bg,
      alignItems: "center", justifyContent: "center",
      paddingHorizontal: S.px,
      paddingBottom: Math.max(insets.bottom + 16, 24),
      gap: 14,
    }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View style={{
        width: 80, height: 80, borderRadius: 22,
        backgroundColor: "rgba(239,68,68,0.08)",
        borderWidth: 1, borderColor: "rgba(239,68,68,0.16)",
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
      </View>

      <MvText variant="h2" style={{ textAlign: "center" }}>Algo deu errado</MvText>

      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 220, lineHeight: 22 }}>
        {message ?? "Ocorreu um erro inesperado."}
      </MvText>

      <MvButton
        label="Tentar novamente"
        onPress={() => navigation.goBack()}
        style={{ maxWidth: 240, width: "100%" }}
      />

      <PressableScale
        onPress={() => navigation.popToTop?.()}
        accessibilityRole="button"
        accessibilityLabel="Voltar ao início"
        style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
      >
        <MvText variant="body4" color="tertiary" style={{ textAlign: "center" }}>
          Voltar ao início
        </MvText>
      </PressableScale>
    </View>
  );
}
