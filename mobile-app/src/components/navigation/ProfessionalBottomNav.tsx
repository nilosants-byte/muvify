import React, { useMemo } from "react";
import { hapticCta } from "../../utils/haptics";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";

export type ProfessionalBottomNavKey =
  | "home"
  | "agenda"
  | "consultoria"
  | "alunos"
  | "financeiro";

type BottomItem = {
  key: ProfessionalBottomNavKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const ITEMS: BottomItem[] = [
  { key: "home",        label: "Início",      icon: "home-outline" },
  { key: "agenda",      label: "Agenda",      icon: "calendar-outline" },
  { key: "consultoria", label: "Consultoria", icon: "school-outline" },
  { key: "alunos",      label: "Alunos",      icon: "people-outline" },
  { key: "financeiro",  label: "Financeiro",  icon: "wallet-outline" },
];

interface ProfessionalBottomNavProps {
  activeKey: ProfessionalBottomNavKey;
  onPress: (key: ProfessionalBottomNavKey) => void;
}

export function ProfessionalBottomNav({ activeKey, onPress }: ProfessionalBottomNavProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  const bottomPadding = useMemo(() => (insets.bottom > 0 ? insets.bottom : 8), [insets.bottom]);

  return (
    <View
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 12,
        flexDirection: "row",
        backgroundColor: theme.navBg,
        borderRadius: 26,
        paddingTop: 8,
        paddingBottom: Math.max(10, bottomPadding),
        paddingHorizontal: 4,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
        elevation: 16,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      {ITEMS.map((item) => {
        const isActive = item.key === activeKey;

        return (
          <TouchableOpacity
            key={item.key}
            testID={`nav.bottom.${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={isActive ? { selected: true } : undefined}
            activeOpacity={0.75}
            onPress={() => { if (!isActive) hapticCta(); onPress(item.key); }}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              minHeight: 52,
              paddingVertical: 4,
              position: "relative",
            }}
          >
            {/* Dot ativo acima do ícone */}
            {isActive && (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.textGreen,
                  shadowColor: theme.textGreen,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 4,
                }}
              />
            )}

            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Ionicons
                name={item.icon}
                size={isActive ? 22 : 20}
                color={isActive ? theme.textGreen : theme.text3}
              />
            </View>

            <Text
              numberOfLines={1}
              style={{
                color: isActive ? theme.textGreen : theme.text3,
                textAlign: "center",
                fontSize: 10,
                fontFamily: isActive ? "DMSans_700Bold" : "DMSans_500Medium",
                letterSpacing: 0.1,
              }}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
