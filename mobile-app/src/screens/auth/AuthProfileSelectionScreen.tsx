import React, { useState } from "react";
import { ScrollView, StatusBar, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { MvBadge } from "../../components/mv/MvBadge";
import { MvButton } from "../../components/mv/MvButton";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

type Props = NativeStackScreenProps<AuthStackParamList, "ProfileSelection">;
type RoleOption = "CLIENT" | "PROVIDER";

function RoleCard({
  icon,
  title,
  description,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useMvTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`Selecionar perfil ${title}`}
      accessibilityState={{ selected: active }}
      style={{
        borderRadius: S.cardR,
        padding: S.cardPad,
        borderWidth: active ? 1.5 : 1,
        backgroundColor: active ? theme.primarySubtle : theme.cardBg,
        borderColor: active ? theme.primarySubtleBorder : theme.border,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{
            width: 44, height: 44, borderRadius: 12,
            backgroundColor: active ? theme.primarySubtle : theme.inputBg,
            alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name={icon} size={24} color={active ? theme.primary : theme.text2} />
          </View>
          <MvText variant="semi2">{title}</MvText>
        </View>
        {active ? <MvBadge label="Selecionado" variant="green" /> : null}
      </View>
      <MvText variant="body4" color="secondary" style={{ lineHeight: 20 }}>{description}</MvText>
    </PressableScale>
  );
}

export function AuthProfileSelectionScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { chooseRole, showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<RoleOption>("CLIENT");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    try {
      setLoading(true);
      await chooseRole(selected);
      navigation.navigate("Register");
    } catch {
      showToast("Falha ao definir perfil.", "error");
      setLoading(false);
    }
  }

  const confirmLabel = loading
    ? "Confirmando..."
    : selected === "CLIENT"
    ? "Confirmar como Aluno"
    : "Confirmar como Personal";

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Botão voltar */}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={{
          position: "absolute",
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
          padding: 8,
        }}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
      >
        <Ionicons name="arrow-back" size={24} color={theme.text1} />
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: S.px,
          paddingTop: insets.top + 72,
          paddingBottom: Math.max(insets.bottom + 24, 32),
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        <MvText variant="display" style={{ marginBottom: 6 }}>Como quer usar o app?</MvText>
        <MvText variant="body3" color="secondary" style={{ marginBottom: 28, lineHeight: 22 }}>
          Escolha seu perfil para criar a conta. Após o cadastro, o perfil não pode ser alterado sem contato com o suporte.
        </MvText>

        <View style={{ gap: 10, marginBottom: 32 }}>
          <RoleCard
            icon="walk-outline"
            title="Aluno"
            description="Encontre profissionais, agende sessões e acompanhe seus treinos."
            active={selected === "CLIENT"}
            onPress={() => setSelected("CLIENT")}
          />
          <RoleCard
            icon="barbell-outline"
            title="Personal Trainer"
            description="Gerencie alunos, agenda e seus serviços profissionais."
            active={selected === "PROVIDER"}
            onPress={() => setSelected("PROVIDER")}
          />
        </View>

        <MvButton
          label={confirmLabel}
          disabled={loading}
          loading={loading}
          onPress={() => void handleConfirm()}
        />
      </ScrollView>
    </View>
  );
}
