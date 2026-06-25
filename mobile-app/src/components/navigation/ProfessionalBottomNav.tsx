import React from "react";
import { hapticCta } from "../../utils/haptics";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
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
  const { theme, isDark } = useMvTheme();
  const insets = useSafeAreaInsets();
  const bottomOffset = Math.max(8, insets.bottom);

  const pillStyle = {
    borderRadius: 26,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: isDark ? 0.65 : 0.18,
    shadowRadius: 30,
    elevation: 24,
  };

  return (
    <View
      style={[styles.wrapper, { bottom: bottomOffset }]}
      testID="nav.professional"
      pointerEvents="box-none"
    >
      {Platform.OS === "ios" ? (
        <BlurView intensity={isDark ? 80 : 60} tint={isDark ? "dark" : "light"} style={pillStyle}>
          <NavContent activeKey={activeKey} onPress={onPress} theme={theme} />
        </BlurView>
      ) : (
        <View style={[pillStyle, { backgroundColor: theme.navBg }]}>
          <NavContent activeKey={activeKey} onPress={onPress} theme={theme} />
        </View>
      )}
    </View>
  );
}

function NavContent({ activeKey, onPress, theme }: ProfessionalBottomNavProps & { theme: ReturnType<typeof useMvTheme>["theme"] }) {
  return (
    <View style={styles.row}>
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
            style={styles.tabItem}
          >
            {/* Dot acima do ícone quando ativo */}
            <View style={styles.dotSlot}>
              {isActive && (
                <View style={[styles.dot, { backgroundColor: theme.textGreen, shadowColor: theme.textGreen }]} />
              )}
            </View>

            <Ionicons
              name={item.icon}
              size={isActive ? 22 : 20}
              color={isActive ? theme.textGreen : theme.text3}
            />

            <Text
              numberOfLines={1}
              style={{
                color: isActive ? theme.textGreen : theme.text3,
                textAlign: "center",
                fontSize: 10,
                fontFamily: isActive ? "DMSans_700Bold" : "DMSans_500Medium",
                letterSpacing: 0.1,
                marginTop: 2,
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

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 50,
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: "center",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    paddingVertical: 4,
    gap: 2,
  },
  dotSlot: {
    height: 6,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
});
