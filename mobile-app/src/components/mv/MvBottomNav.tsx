import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../theme/MvThemeContext";
import { shadows } from "../../theme/tokens";

interface NavItem {
  key: string;
  icon: string; // nome do ícone Ionicons
  label: string;
}

interface MvBottomNavProps {
  items: NavItem[];
  activeKey: string;
  onPress?: (key: string) => void;
}

export function MvBottomNav({ items, activeKey, onPress }: MvBottomNavProps) {
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="nav.bottom"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: theme.navBg,
        borderTopWidth: 1,
        borderTopColor: theme.borderSub,
        flexDirection: "row",
        paddingHorizontal: 8,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
        paddingTop: 8,
        height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
        ...shadows.bottomNav,
      }}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        const iconColor = isActive ? theme.textGreen : theme.text3;

        return (
          <TouchableOpacity
            key={item.key}
            activeOpacity={0.8}
            onPress={() => onPress?.(item.key)}
            testID={`nav.bottom.${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={isActive ? { selected: true } : undefined}
            style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 2 }}
          >
            <Ionicons name={item.icon as any} size={22} color={iconColor} />
            {/* Indicador dot verde para aba ativa */}
            <View style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: isActive ? theme.textGreen : "transparent",
            }} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
