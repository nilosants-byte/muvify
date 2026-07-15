import React, { useState } from "react";
import { Pressable, StatusBar, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";

type Props = NativeStackScreenProps<AuthStackParamList, "ProfileSelection">;
type RoleOption = "CLIENT" | "PROVIDER";

function PersonIcon({ color }: { color: string }) {
  return (
    <Svg width="34" height="34" viewBox="0 0 36 36">
      <Circle cx="18" cy="11" r="7" fill={color} />
      <Path d="M3 36 C3 23 9 18 18 18 C27 18 33 23 33 36 Z" fill={color} />
    </Svg>
  );
}

function CertificateIcon({ color }: { color: string }) {
  return (
    <Svg width="34" height="34" viewBox="0 0 36 36">
      <Path
        fillRule="evenodd"
        d="M7 2 Q5 2 5 4 L5 20 Q5 22 7 22 L29 22 Q31 22 31 20 L31 4 Q31 2 29 2 Z M8 7 L28 7 L28 9 L8 9 Z M8 12 L28 12 L28 14 L8 14 Z M8 17 L22 17 L22 19 L8 19 Z"
        fill={color}
      />
      <Path
        fillRule="evenodd"
        d="M11 28 A7 7 0 1 0 25 28 A7 7 0 1 0 11 28 Z M18 23 L19.3 26.2 L22.8 26.5 L20.1 28.7 L20.9 32.1 L18 30.2 L15.1 32.1 L15.9 28.7 L13.2 26.5 L16.7 26.2 Z"
        fill={color}
      />
    </Svg>
  );
}

export function AuthProfileSelectionScreen({ navigation }: Props) {
  const { theme } = useMvTheme();
  const { chooseRole, showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<RoleOption>("CLIENT");
  const [loading, setLoading] = useState(false);

  const isDark = theme.mode === "dark";
  const clientActive = selected === "CLIENT";
  const providerActive = selected === "PROVIDER";

  const aluno = {
    accent:       isDark ? "#24E66D" : "#16A34A",
    iconBg:       isDark ? "rgba(36,230,109,0.12)" : "rgba(22,163,74,0.12)",
    chipBg:       isDark ? "rgba(36,230,109,0.10)" : "rgba(22,163,74,0.10)",
    chipBorder:   isDark ? "rgba(36,230,109,0.25)" : "rgba(22,163,74,0.25)",
    bg:           isDark ? "#040E08" : "#E2F5E9",
    title:        isDark ? "#ffffff" : "#052810",
    desc:         isDark ? "rgba(255,255,255,0.50)" : "rgba(5,40,16,0.55)",
  };

  const personal = {
    accent:       isDark ? "#6EE7B7" : "#15803D",
    iconBg:       isDark ? "rgba(110,231,183,0.10)" : "rgba(21,128,61,0.10)",
    chipBg:       isDark ? "rgba(110,231,183,0.09)" : "rgba(21,128,61,0.08)",
    chipBorder:   isDark ? "rgba(110,231,183,0.22)" : "rgba(21,128,61,0.22)",
    bg:           isDark ? "#030806" : "#FAFFFE",
    title:        isDark ? "#ffffff" : "#052810",
    desc:         isDark ? "rgba(255,255,255,0.45)" : "rgba(5,40,16,0.52)",
  };

  const ctaBg         = clientActive ? aluno.accent : personal.accent;
  const ctaStripBg    = isDark ? "#030806" : (clientActive ? aluno.bg : personal.bg);
  const backIconColor = clientActive ? aluno.title : personal.title;

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

  return (
    <View style={{ flex: 1 }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} translucent backgroundColor="transparent" />

      {/* Botão voltar sobreposto */}
      <Pressable
        onPress={() => navigation.goBack()}
        style={{ position: "absolute", top: insets.top + 12, left: 16, zIndex: 10, padding: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
      >
        <Ionicons name="arrow-back" size={24} color={backIconColor} />
      </Pressable>

      {/* ── Metade Aluno ── */}
      <Pressable
        onPress={() => setSelected("CLIENT")}
        accessibilityRole="radio"
        accessibilityLabel="Selecionar perfil Aluno"
        accessibilityState={{ selected: clientActive }}
        style={{ flex: 1, backgroundColor: aluno.bg, alignItems: "center", justifyContent: "center", paddingTop: insets.top + 16, paddingHorizontal: 24 }}
      >

        {/* Badge de confirmação */}
        {clientActive && (
          <View style={{ position: "absolute", top: insets.top + 14, right: 16, width: 22, height: 22, borderRadius: 11, backgroundColor: aluno.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#000", fontSize: 11, fontWeight: "800" }}>✓</Text>
          </View>
        )}

        {/* Ícone */}
        <View style={{ width: 62, height: 62, borderRadius: 20, backgroundColor: aluno.iconBg, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
          <PersonIcon color={aluno.accent} />
        </View>

        {/* Chip */}
        <View style={{ backgroundColor: aluno.chipBg, borderWidth: 1, borderColor: aluno.chipBorder, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 7 }}>
          <Text style={{ color: aluno.accent, fontSize: 9, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase" }}>Sou aluno</Text>
        </View>

        {/* Nome do papel */}
        <Text style={{ color: aluno.title, fontSize: 23, fontWeight: "800", letterSpacing: -0.5, marginBottom: 8, textAlign: "center", opacity: clientActive ? 1 : 0.62 }}>Aluno</Text>

        {/* Descrição */}
        <Text style={{ color: aluno.desc, fontSize: 12, lineHeight: 19, textAlign: "center", maxWidth: 220, opacity: clientActive ? 1 : 0.65 }}>
          Encontre seu personal ideal, agende sessões presenciais ou online, treine pelo app e suba no ranking com amigos.
        </Text>
      </Pressable>

      {/* Divisor */}
      <View style={{ height: 1, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)" }} />

      {/* ── Metade Personal ── */}
      <Pressable
        onPress={() => setSelected("PROVIDER")}
        accessibilityRole="radio"
        accessibilityLabel="Selecionar perfil Personal Trainer"
        accessibilityState={{ selected: providerActive }}
        style={{ flex: 1, backgroundColor: personal.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
      >

        {/* Badge de confirmação */}
        {providerActive && (
          <View style={{ position: "absolute", top: 14, right: 16, width: 22, height: 22, borderRadius: 11, backgroundColor: personal.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#000", fontSize: 11, fontWeight: "800" }}>✓</Text>
          </View>
        )}

        {/* Ícone */}
        <View style={{ width: 62, height: 62, borderRadius: 20, backgroundColor: personal.iconBg, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
          <CertificateIcon color={personal.accent} />
        </View>

        {/* Chip */}
        <View style={{ backgroundColor: personal.chipBg, borderWidth: 1, borderColor: personal.chipBorder, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 7 }}>
          <Text style={{ color: personal.accent, fontSize: 9, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase" }}>Sou personal</Text>
        </View>

        {/* Nome do papel */}
        <Text style={{ color: personal.title, fontSize: 23, fontWeight: "800", letterSpacing: -0.5, marginBottom: 8, textAlign: "center", opacity: providerActive ? 1 : 0.62 }}>Personal Trainer</Text>

        {/* Descrição */}
        <Text style={{ color: personal.desc, fontSize: 12, lineHeight: 19, textAlign: "center", maxWidth: 220, opacity: providerActive ? 1 : 0.65 }}>
          Seja encontrado e contratado com facilidade, gerencie alunos e agenda, venda serviços e controle seu financeiro.
        </Text>
      </Pressable>

      {/* ── CTA ── */}
      <View style={{ backgroundColor: ctaStripBg, paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 20) }}>
        <Pressable
          onPress={() => !loading && void handleConfirm()}
          disabled={loading}
          style={{ height: 48, borderRadius: 14, backgroundColor: ctaBg, alignItems: "center", justifyContent: "center", opacity: loading ? 0.7 : 1 }}
          accessibilityRole="button"
          accessibilityLabel={clientActive ? "Continuar como Aluno" : "Continuar como Personal"}
        >
          <Text style={{ color: "#000", fontSize: 14, fontWeight: "700", letterSpacing: -0.2 }}>
            {loading ? "Confirmando..." : clientActive ? "Continuar como Aluno" : "Continuar como Personal"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
