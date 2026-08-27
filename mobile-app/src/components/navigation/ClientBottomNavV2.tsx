import React from "react";
import { hapticCta } from "../../utils/haptics";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { S, UI } from "../../theme/v2tokens";
import { MvText } from "../mv";
import { useMvTheme } from "../../theme/MvThemeContext";

// Bloco 3 (exclusividade de marketplace): "agenda" virou "meuPersonal" — a
// aba passou a mostrar o card do plano contratado além das sessões
// presenciais, então nem "Agenda" nem "Plano" descreviam bem as duas coisas
// juntas (ver debate no épico do aluno externo).
export type ClientV2Tab = "home" | "meuPersonal" | "trainings" | "community" | "profile";

interface NavItem {
  key: ClientV2Tab;
  label: string;
  family: "ionicons" | "mci";
  icon: string;
  iconActive: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "home",        label: "Início",       family: "ionicons", icon: "home-outline",     iconActive: "home" },
  // Ícone de bíceps flexionado (não é Ionicons — precisa da família
  // MaterialCommunityIcons, já disponível em @expo/vector-icons).
  { key: "meuPersonal", label: "Meu Personal", family: "mci",      icon: "arm-flex-outline", iconActive: "arm-flex" },
  { key: "trainings",   label: "Treino",       family: "ionicons", icon: "barbell-outline",  iconActive: "barbell" },
  { key: "community",   label: "Comunidade",   family: "ionicons", icon: "people-outline",   iconActive: "people" },
  { key: "profile",     label: "Perfil",       family: "ionicons", icon: "person-outline",   iconActive: "person" },
];

interface ClientBottomNavV2Props {
  activeTab: ClientV2Tab;
  onNavigate: (tab: ClientV2Tab) => void;
  badges?: Partial<Record<ClientV2Tab, number>>;
}

export function ClientBottomNavV2({ activeTab, onNavigate, badges }: ClientBottomNavV2Props) {
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
      testID="nav.client.v2"
      pointerEvents="box-none"
    >
      {Platform.OS === "ios" ? (
        <BlurView intensity={isDark ? 80 : 60} tint={isDark ? "dark" : "light"} style={pillStyle}>
          <NavContent activeTab={activeTab} onNavigate={onNavigate} theme={theme} badges={badges} />
        </BlurView>
      ) : (
        <View style={[pillStyle, { backgroundColor: theme.navBg }]}>
          <NavContent activeTab={activeTab} onNavigate={onNavigate} theme={theme} badges={badges} />
        </View>
      )}
    </View>
  );
}

function NavContent({ activeTab, onNavigate, theme, badges }: ClientBottomNavV2Props & { theme: ReturnType<typeof useMvTheme>["theme"] }) {
  return (
    <View style={styles.row}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.key === activeTab;
        const color = isActive ? theme.primary : theme.text3;
        const badgeCount = badges?.[item.key] ?? 0;

        return (
          <TouchableOpacity
            key={item.key}
            onPress={() => { if (item.key !== activeTab) hapticCta(); onNavigate(item.key); }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={isActive ? { selected: true } : undefined}
            testID={`nav.client.v2.${item.key}`}
            style={styles.tabItem}
          >
            {/* Dot acima do ícone quando ativo */}
            <View style={styles.dotSlot}>
              {isActive && (
                <View style={[styles.dot, { backgroundColor: theme.primary, shadowColor: theme.primary }]} />
              )}
            </View>

            {/* Ícone com badge opcional */}
            <View style={{ position: "relative" }}>
              {item.family === "mci" ? (
                <MaterialCommunityIcons
                  name={(isActive ? item.iconActive : item.icon) as React.ComponentProps<typeof MaterialCommunityIcons>["name"]}
                  size={isActive ? 22 : 20}
                  color={color}
                />
              ) : (
                <Ionicons
                  name={(isActive ? item.iconActive : item.icon) as React.ComponentProps<typeof Ionicons>["name"]}
                  size={isActive ? 22 : 20}
                  color={color}
                />
              )}
              {badgeCount > 0 && (
                <View style={{ position: "absolute", top: -4, right: -6, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
                  <MvText style={{ fontFamily: "DMSans_700Bold", fontSize: 8, color: "#fff", lineHeight: 12 }}>
                    {badgeCount > 9 ? "9+" : String(badgeCount)}
                  </MvText>
                </View>
              )}
            </View>

            <MvText
              style={{
                fontFamily: UI,
                fontSize: 10,
                fontWeight: isActive ? "700" : "500",
                color,
                marginTop: 2,
                letterSpacing: -0.1,
              }}
            >
              {item.label}
            </MvText>
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
    height: S.navH,
    alignItems: "center",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: S.touchMin,
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
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 2,
  },
});
