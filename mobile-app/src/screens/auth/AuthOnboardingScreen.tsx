import React, { useState } from "react";
import { Pressable, StatusBar, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvButton, MvText } from "../../components/mv";

const slides: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}> = [
  {
    icon: "barbell-outline",
    title: "Seu treino,\nseu ritmo.",
    desc: "Conecte-se com personal trainers certificados e agende sessões presenciais ou online.",
  },
  {
    icon: "document-text-outline",
    title: "Planos\npersonalizados.",
    desc: "Receba treinos montados especialmente para você, com exercícios, cargas e descansos definidos.",
  },
  {
    icon: "calendar-clear-outline",
    title: "Agende\ncom facilidade.",
    desc: "Escolha data, horário e modalidade. Pague com PIX ou cartão diretamente no app.",
  },
];

export function AuthOnboardingScreen() {
  const { completeOnboarding } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const isDark = theme.mode === "dark";

  const [idx, setIdx] = useState(0);
  const slide = slides[idx];
  const isLast = idx === slides.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Botão pular — topo direito */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 20, alignItems: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => void completeOnboarding()}
        >
          <MvText variant="body4" color="secondary">Pular</MvText>
        </Pressable>
      </View>

      {/* Área hero — ícone centralizado */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{
          width: 140,
          height: 140,
          borderRadius: 40,
          backgroundColor: isDark ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.08)",
          borderWidth: 1,
          borderColor: isDark ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.14)",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Ionicons name={slide.icon} size={58} color={theme.textGreen} />
        </View>
      </View>

      {/* Conteúdo inferior */}
      <View style={{
        paddingHorizontal: 28,
        paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 32,
        gap: 16,
      }}>
        {/* Indicadores de progresso */}
        <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
          {slides.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => setIdx(i)} hitSlop={6}>
              <View style={{
                width: i === idx ? 24 : 8,
                height: 4,
                borderRadius: 3,
                backgroundColor: i === idx ? theme.textGreen : theme.borderSub,
              }} />
            </TouchableOpacity>
          ))}
        </View>

        <MvText variant="h2" style={{ lineHeight: 32 }}>{slide.title}</MvText>
        <MvText variant="body3" color="secondary">{slide.desc}</MvText>

        <MvButton
          label={isLast ? "Começar" : "Continuar"}
          onPress={() => {
            if (isLast) {
              void completeOnboarding();
            } else {
              setIdx((current) => current + 1);
            }
          }}
          style={{ marginTop: 4 }}
        />
      </View>
    </View>
  );
}
