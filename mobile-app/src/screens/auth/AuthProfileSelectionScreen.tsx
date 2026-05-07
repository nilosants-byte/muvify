import React, { useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvBadge, MvButton, MvText } from "../../components/mv";
import { useAppState } from "../../state/AppState";

type RoleOption = "CLIENT" | "PROVIDER";

export function AuthProfileSelectionScreen() {
  const { chooseRole, showToast } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<RoleOption>("CLIENT");
  const [loading, setLoading] = useState(false);
  const isLight = theme.mode === "light";

  async function handleConfirm() {
    try {
      setLoading(true);
      await chooseRole(selected);
    } catch {
      showToast("Falha ao definir perfil.", "error");
    } finally {
      setLoading(false);
    }
  }

  const RoleCard = ({
    role, icon, title, description,
  }: { role: RoleOption; icon: keyof typeof Ionicons.glyphMap; title: string; description: string }) => {
    const active = selected === role;
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setSelected(role)}
        style={{
          borderRadius: 12,
          padding: 16,
          borderWidth: active ? 1.5 : 1,
          backgroundColor: active
            ? (isLight ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.08)")
            : theme.cardBg,
          borderColor: active
            ? (isLight ? "rgba(34,197,94,0.30)" : "rgba(34,197,94,0.38)")
            : theme.border,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{
              width: 44, height: 44, borderRadius: 12,
              backgroundColor: active
                ? (isLight ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.16)")
                : (isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)"),
              alignItems: "center", justifyContent: "center",
            }}>
              <Ionicons name={icon} size={24} color={active ? theme.textGreen : theme.text3} />
            </View>
            <MvText variant="semi1">{title}</MvText>
          </View>
          {active && (
            <MvBadge
              label="Selecionado"
              variant={isLight ? "green" : "greenDark"}
            />
          )}
        </View>
        <MvText variant="body4" color="secondary">{description}</MvText>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />
      <ScrollView automaticallyAdjustKeyboardInsets={true}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 52,
          paddingBottom: 32,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false} pinchGestureEnabled maximumZoomScale={3}
      >
        <MvText variant="h2" style={{ marginBottom: 6 }}>Como quer usar o app?</MvText>
        <MvText variant="body3" color="secondary" style={{ marginBottom: 28 }}>
          Escolha seu perfil para continuar.
        </MvText>

        <View style={{ gap: 10, marginBottom: 32 }}>
          <RoleCard
            role="CLIENT"
            icon="walk-outline"
            title="Aluno"
            description="Encontre profissionais, agende sessões e acompanhe seus treinos."
          />
          <RoleCard
            role="PROVIDER"
            icon="barbell-outline"
            title="Personal Trainer"
            description="Gerencie alunos, agenda e seus serviços profissionais."
          />
        </View>

        <MvButton
          label={selected === "CLIENT" ? "Confirmar como Aluno" : "Confirmar como Personal"}
          loading={loading}
          onPress={() => void handleConfirm()}
        />
      </ScrollView>
    </View>
  );
}
