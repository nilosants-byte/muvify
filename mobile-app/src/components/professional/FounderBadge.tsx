import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";

// Bloco 7 (programa 100 Fundadores): mesmo dourado já usado no selo de
// "Minha Assinatura" (MySubscriptionScreen.tsx) — deliberadamente fora do
// MvTheme, é só o acento visual do selo, não faz parte da paleta semântica
// do app (sucesso/aviso/erro).
const FOUNDER_GOLD = "#E8B84B";
const FOUNDER_GOLD_SUBTLE = "rgba(232,184,75,0.13)";
const FOUNDER_GOLD_BORDER = "rgba(232,184,75,0.28)";
// Raio-X pós-épico (achado baixo): FOUNDER_GOLD como cor do ícone/texto
// sobre FOUNDER_GOLD_SUBTLE (13% opacidade) dava contraste ~1,75:1 no tema
// claro (fundo quase branco) — bem abaixo do mínimo 4,5:1 do WCAG AA pra
// texto pequeno. No escuro o contraste já era ótimo (~11:1), problema só no
// claro. Mesmo tom, versão escurecida só pro texto/ícone em cima do claro.
const FOUNDER_GOLD_ON_LIGHT = "#8A6116";

interface FounderBadgeProps {
  // Card de busca/lista: espaço apertado, só ícone + "FUNDADOR". Perfil
  // completo: pill maior, texto por extenso "FUNDADOR MUVIFY".
  compact?: boolean;
}

export function FounderBadge({ compact }: FounderBadgeProps) {
  const { theme } = useMvTheme();
  const goldFg = theme.mode === "light" ? FOUNDER_GOLD_ON_LIGHT : FOUNDER_GOLD;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 3 : 6,
        alignSelf: "flex-start",
        paddingHorizontal: compact ? 7 : 10,
        paddingVertical: compact ? 3 : 5,
        borderRadius: 99,
        backgroundColor: FOUNDER_GOLD_SUBTLE,
        borderWidth: 1,
        borderColor: FOUNDER_GOLD_BORDER
      }}
    >
      <Ionicons name="star" size={compact ? 9 : 12} color={goldFg} />
      <Text
        style={{
          fontFamily: "DMSans_700Bold",
          fontSize: compact ? 8.5 : 10.5,
          letterSpacing: 0.3,
          color: goldFg
        }}
      >
        {compact ? "FUNDADOR" : "FUNDADOR MUVIFY"}
      </Text>
    </View>
  );
}
