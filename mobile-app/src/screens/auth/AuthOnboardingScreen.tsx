import React, { useState } from "react";
import { StatusBar, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useAppState } from "../../state/AppState";
import { MvButton } from "../../components/mv/MvButton";
import { MvText } from "../../components/mv/MvText";
import { PressableScale } from "../../components/polish/PressableScale";
import { C, S } from "../../theme/v2tokens";
import { useMvTheme } from "../../theme/MvThemeContext";

const slides: Array<{
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  title: string;
  desc: string;
  cta: string;
}> = [
  {
    icon: "people-outline",
    label: "Encontre seu personal",
    title: "Personais\nperto de você.",
    desc: "Conecte-se com personal trainers certificados e agende sessões presenciais ou online, direto pelo app.",
    cta: "Continuar",
  },
  {
    icon: "document-text-outline",
    label: "Plano personalizado",
    title: "Treinos feitos\npara você.",
    desc: "Receba planos montados especialmente para seu perfil, com exercícios, cargas e descansos definidos pelo seu personal.",
    cta: "Continuar",
  },
  {
    icon: "location-outline",
    label: "Comece agora",
    title: "Seu personal\nideal está aqui.",
    desc: "Ative sua localização para ver os profissionais mais próximos de você e começar a treinar hoje.",
    cta: "Ativar e começar",
  },
];

interface AuthOnboardingScreenProps {
  onDismiss?: () => void;
}

export function AuthOnboardingScreen({ onDismiss }: AuthOnboardingScreenProps = {}) {
  const { theme } = useMvTheme();
  const { completeOnboarding, showToast } = useAppState();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const slide = slides[idx]!;
  const isLast = idx === slides.length - 1;

  const finish = async () => {
    if (onDismiss) { onDismiss(); return; }
    try {
      setRequesting(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        showToast("Localização não ativada. Você pode habilitá-la depois em Configurações do celular.", "info");
      }
    } catch { /* best effort */ }
    finally { setRequesting(false); }
    void completeOnboarding();
  };

  // Frente 8 (segunda camada), Lote 7: "Pular" (visível nos slides 1 e 2)
  // chamava a mesma finish() do CTA final "Ativar e começar" — pedia
  // permissão de localização mesmo pra quem nunca chegou no terceiro slide
  // (o único que explica esse pedido). Pular deveria pular também o pedido
  // de permissão atrelado ao conteúdo pulado, não só o tutorial visual.
  const skip = () => {
    if (onDismiss) { onDismiss(); return; }
    void completeOnboarding();
  };

  const handleNext = async () => {
    if (isLast) {
      await finish();
    } else {
      setIdx((c) => c + 1);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.bg} />

      {/* Botão pular */}
      {!isLast ? (
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: S.px, alignItems: "flex-end" }}>
          <PressableScale
            onPress={skip}
            accessibilityRole="button"
            accessibilityLabel="Pular onboarding"
            style={{ paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: "center" }}
          >
            <MvText variant="body4" color="secondary">Pular</MvText>
          </PressableScale>
        </View>
      ) : (
        <View style={{ paddingTop: insets.top + 14 }} />
      )}

      {/* Hero */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <View style={{
          width: 140, height: 140, borderRadius: 44,
          backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
          alignItems: "center", justifyContent: "center",
          shadowColor: theme.primary, shadowOpacity: 0.3, shadowRadius: 30, elevation: 10,
        }}>
          <Ionicons name={slide.icon} size={60} color={theme.primary} />
        </View>

        <View style={{
          backgroundColor: theme.primarySubtle, borderWidth: 1, borderColor: theme.primarySubtleBorder,
          borderRadius: S.chipR, paddingHorizontal: 12, paddingVertical: 5,
        }}>
          <MvText variant="badge" style={{ color: theme.primary }}>{slide.label}</MvText>
        </View>
      </View>

      {/* Conteúdo inferior */}
      <View style={{ paddingHorizontal: S.px, paddingBottom: Math.max(insets.bottom + 24, 40), gap: 16 }}>
        {/* Indicadores de progresso */}
        <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
          {slides.map((_, i) => (
            <PressableScale
              key={i}
              onPress={() => setIdx(i)}
              accessibilityRole="button"
              accessibilityLabel={`Ir para slide ${i + 1}`}
              style={{ padding: 8, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
            >
              <View style={{
                width: i === idx ? 24 : 8,
                height: 4, borderRadius: 3,
                backgroundColor: i === idx ? theme.primary : "rgba(255,255,255,0.20)",
              }} />
            </PressableScale>
          ))}
        </View>

        <MvText variant="hero" style={{ lineHeight: 36 }}>
          {slide.title}
        </MvText>

        <MvText variant="body2" color="secondary" style={{ lineHeight: 24 }}>
          {slide.desc}
        </MvText>

        <MvButton
          label={requesting ? "Ativando..." : slide.cta}
          disabled={requesting}
          loading={requesting}
          onPress={() => void handleNext()}
          style={{ marginTop: 4 }}
        />
      </View>
    </View>
  );
}
