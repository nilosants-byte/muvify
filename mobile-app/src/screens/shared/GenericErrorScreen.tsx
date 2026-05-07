import React from "react";
import { StatusBar, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvText } from "../../components/mv";

type Props = NativeStackScreenProps<any, "GenericError">;

export function GenericErrorScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";
  const message = route?.params?.message as string | undefined;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <View style={{
        width: 80, height: 80, borderRadius: 22,
        backgroundColor: isLight ? "rgba(220,38,38,0.06)" : "rgba(239,68,68,0.08)",
        borderWidth: 1,
        borderColor: isLight ? "rgba(220,38,38,0.12)" : "rgba(239,68,68,0.16)",
        alignItems: "center", justifyContent: "center",
      }}>
        <Ionicons name="alert-circle-outline" size={40} color={isLight ? "#DC2626" : "#EF4444"} />
      </View>
      <MvText variant="h3">Algo deu errado</MvText>
      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 200 }}>
        {message ?? "Ocorreu um erro inesperado."}
      </MvText>
      <MvButton
        label="Tentar novamente"
        onPress={() => navigation.goBack()}
        style={{ maxWidth: 200, width: "100%" }}
      />
      <MvText
        variant="body3"
        color="tertiary"
        style={{ textAlign: "center" }}
        onPress={() => navigation.popToTop?.()}
      >
        Voltar ao início
      </MvText>
    </View>
  );
}
