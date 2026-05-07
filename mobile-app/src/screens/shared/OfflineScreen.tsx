import React from "react";
import { StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvText } from "../../components/mv";

type Props = NativeStackScreenProps<ClientStackParamList, "Offline">;

export function OfflineScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isLight = theme.mode === "light";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", padding: 32 }}>
      <StatusBar barStyle={isLight ? "dark-content" : "light-content"} backgroundColor={theme.bg} />

      <View style={{
        width: 80, height: 80, borderRadius: 22,
        backgroundColor: isLight ? "rgba(2,132,199,0.07)" : "rgba(56,189,248,0.08)",
        borderWidth: 1,
        borderColor: isLight ? "rgba(2,132,199,0.14)" : "rgba(56,189,248,0.16)",
        alignItems: "center", justifyContent: "center",
        marginBottom: 24,
      }}>
        <Ionicons name="cellular-outline" size={40} color={isLight ? "#0284C7" : "#38BDF8"} />
      </View>

      <MvText variant="h3" style={{ textAlign: "center", marginBottom: 10 }}>Sem internet</MvText>
      <MvText variant="body3" color="secondary" style={{ textAlign: "center", maxWidth: 220, marginBottom: 32, lineHeight: 22 }}>
        Verifique sua conexão para continuar usando o aplicativo e sincronizar seus dados.
      </MvText>

      <MvButton
        label="Tentar novamente"
        onPress={() => navigation.goBack()}
        style={{ maxWidth: 220, width: "100%" }}
      />
    </View>
  );
}
