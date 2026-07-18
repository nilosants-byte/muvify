import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "../mv";

export type ConsultancyTabKey = "dashboard" | "offers" | "requests";

const TABS: Array<{ key: ConsultancyTabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: "dashboard", label: "Painel", icon: "speedometer-outline" },
  { key: "offers", label: "Vitrine", icon: "pricetag-outline" },
  { key: "requests", label: "Pedidos", icon: "chatbubbles-outline" },
];

// As 3 áreas de Consultoria (Painel/Vitrine/Pedidos) vivem numa única tela —
// trocar de aba aqui só troca um estado local, sem navegação nem transição.
export function ConsultancyTabSwitcher({
  active,
  onNavigate,
}: {
  active: ConsultancyTabKey;
  onNavigate: (key: ConsultancyTabKey) => void;
}) {
  const { theme } = useMvTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: theme.mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", borderRadius: 14, padding: 3, gap: 3 }}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            activeOpacity={0.7}
            onPress={() => { if (!selected) onNavigate(tab.key); }}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 11,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? theme.primarySubtle : "transparent",
              borderWidth: selected ? 1 : 0,
              borderColor: theme.primarySubtleBorder,
            }}
          >
            <Ionicons name={tab.icon} size={13} color={selected ? theme.textGreen : theme.text3} />
            <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 12, color: selected ? theme.textGreen : theme.text3, marginLeft: 4 }}>
              {tab.label}
            </MvText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
