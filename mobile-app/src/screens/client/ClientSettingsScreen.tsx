import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, ScrollView, StatusBar, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ClientStackParamList } from "../../navigation/route-types";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvCard, MvText, MvToggle } from "../../components/mv";
import { useAppState } from "../../state/AppState";

type Props = NativeStackScreenProps<ClientStackParamList, "ClientSettings">;
const CLIENT_PUSH_ENABLED_KEY = "@personalapp/clientPushEnabled";

export function ClientSettingsScreen({ navigation }: Props) {
  const { signOut } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [pushEnabled, setPushEnabled] = useState(true);
  const lightModeEnabled = !isDark;

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(CLIENT_PUSH_ENABLED_KEY)
      .then((saved) => {
        if (!active || !saved) return;
        setPushEnabled(saved !== "0");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(CLIENT_PUSH_ENABLED_KEY, pushEnabled ? "1" : "0").catch(() => {});
  }, [pushEnabled]);

  function handleSignOut() {
    Alert.alert("Sair da conta", "Tem certeza que deseja sair?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  function handleLightModeToggle(enabled: boolean) {
    if (enabled !== lightModeEnabled) {
      toggleTheme();
    }
  }

  const SettingRow = ({
    emoji, label, sub, right,
    onPress, danger = false,
  }: { emoji: string; label: string; sub?: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean }) => (
    <TouchableOpacity
      activeOpacity={onPress ? 0.8 : 1}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 12 }}
    >
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <MvText variant="semi2" style={danger ? { color: theme.mode === "dark" ? "#EF5350" : "#c62828" } : undefined}>
          {label}
        </MvText>
        {sub ? <MvText variant="body4" color="secondary">{sub}</MvText> : null}
      </View>
      {right ?? (onPress ? <Text style={{ color: theme.text3, fontSize: 16 }}>{">"}</Text> : null)}
    </TouchableOpacity>
  );

  const Divider = () => <View style={{ height: 1, backgroundColor: theme.borderSub }} />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 14, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: theme.borderSub }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: theme.backBtn, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">Configurações</MvText>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets={true} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }} showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}>
        {/* Grupo 1 - toggles */}
        <MvCard style={{ padding: 0, paddingHorizontal: 13 }}>
          <SettingRow
            emoji={isDark ? "🌙" : "☀️"}
            label="Aparência"
            sub="modo light"
            right={<MvToggle value={lightModeEnabled} onValueChange={handleLightModeToggle} />}
          />
          <Divider />
          <SettingRow
            emoji="🔔"
            label="Notificações"
            sub="Push ativado"
            right={<MvToggle value={pushEnabled} onValueChange={setPushEnabled} />}
          />
        </MvCard>

        {/* Grupo 2 - navegação */}
        <MvCard style={{ padding: 0, paddingHorizontal: 13 }}>
          <SettingRow emoji="🛡️" label="Segurança" onPress={() => navigation.navigate("Security")} />
          <Divider />
          <SettingRow emoji="💬" label="Suporte" onPress={() => navigation.navigate("Support")} />
        </MvCard>

        {/* Grupo 3 - sair */}
        <MvCard style={{ padding: 0, paddingHorizontal: 13 }}>
          <SettingRow emoji="🚪" label="Sair da conta" danger onPress={handleSignOut} />
        </MvCard>
      </ScrollView>
    </View>
  );
}
