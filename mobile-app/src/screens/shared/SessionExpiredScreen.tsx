import React from "react";
import { StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvText } from "../../components/mv";

type Props = NativeStackScreenProps<AuthStackParamList, "SessionExpired">;

export function SessionExpiredScreen({ navigation, route }: Props) {
  const { theme } = useMvTheme();
  const isLight = theme.mode === "light";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      <View
        style={{
          width: 80, height: 80, borderRadius: 22,
          backgroundColor: isLight ? "rgba(180,83,9,0.07)" : "rgba(245,158,11,0.08)",
          borderWidth: 1,
          borderColor: isLight ? "rgba(180,83,9,0.14)" : "rgba(245,158,11,0.16)",
          alignItems: "center", justifyContent: "center",
          marginBottom: 16,
        }}
      >
        <Ionicons name="time-outline" size={40} color={isLight ? "#B45309" : "#F59E0B"} />
      </View>

      <MvText variant="h3" style={{ marginBottom: 8 }}>Sessão expirada</MvText>
      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 200, marginBottom: 24 }}>
        {route.params?.reason ?? "Por segurança, faça login novamente para continuar."}
      </MvText>

      <MvButton
        label="Entrar novamente"
        onPress={() => navigation.replace("Login")}
        style={{ maxWidth: 200, width: "100%" }}
      />
    </View>
  );
}
