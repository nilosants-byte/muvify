import React, { useCallback, useMemo, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chatApi } from "../../services/api/client";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";
import { MvText } from "../mv";

export type ProfessionalBottomNavKey =
  | "home"
  | "agenda"
  | "conversas"
  | "alunos"
  | "financeiro";

type BottomItem = {
  key: ProfessionalBottomNavKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const ITEMS: BottomItem[] = [
  { key: "home",       label: "Início",     icon: "home-outline" },
  { key: "agenda",     label: "Agenda",     icon: "calendar-outline" },
  { key: "conversas",  label: "Conversas",  icon: "chatbubbles-outline" },
  { key: "alunos",     label: "Alunos",     icon: "people-outline" },
  { key: "financeiro", label: "Financeiro", icon: "wallet-outline" },
];

interface ProfessionalBottomNavProps {
  activeKey: ProfessionalBottomNavKey;
  onPress: (key: ProfessionalBottomNavKey) => void;
}

export function ProfessionalBottomNav({ activeKey, onPress }: ProfessionalBottomNavProps) {
  const { runWithAuth } = useAppState();
  const { theme } = useMvTheme();
  const insets = useSafeAreaInsets();
  const [unreadClientsCount, setUnreadClientsCount] = useState(0);

  const refreshUnreadClients = useCallback(async () => {
    try {
      const chats = await runWithAuth((token) => chatApi.myChats(token));
      const uniqueClients = new Set(
        chats
          .filter((item) => item.unreadCount > 0)
          .map((item) => item.clientId || item.bookingId)
      );
      setUnreadClientsCount(uniqueClients.size);
    } catch {
      // best effort
    }
  }, [runWithAuth]);

  useFocusEffect(
    useCallback(() => {
      void refreshUnreadClients();
      const timer = setInterval(() => {
        void refreshUnreadClients();
      }, 12000);
      return () => clearInterval(timer);
    }, [refreshUnreadClients])
  );

  const bottomPadding = useMemo(() => (insets.bottom > 0 ? insets.bottom : 8), [insets.bottom]);

  const isDark = theme.mode === "dark";
  const activeColor = theme.textGreen;
  const inactiveColor = theme.text3;
  const navBg = isDark ? theme.navBg : "#FFFFFF";
  const borderTopColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)";

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        backgroundColor: navBg,
        borderTopWidth: 1,
        borderTopColor,
        paddingTop: 10,
        paddingBottom: bottomPadding,
        paddingHorizontal: 4,
      }}
    >
      {ITEMS.map((item) => {
        const isActive = item.key === activeKey;
        const hasBadge = item.key === "conversas" && unreadClientsCount > 0;

        return (
          <TouchableOpacity
            key={item.key}
            testID={`nav.bottom.${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={isActive ? { selected: true } : undefined}
            activeOpacity={0.75}
            onPress={() => onPress(item.key)}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              minHeight: 50,
              paddingVertical: 2,
            }}
          >
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Ionicons
                name={item.icon}
                size={22}
                color={isActive ? activeColor : inactiveColor}
              />
              {hasBadge ? (
                <View
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -10,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: "#EF4444",
                    borderWidth: 1.5,
                    borderColor: navBg,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 3,
                  }}
                >
                  <MvText
                    style={{
                      color: "#fff",
                      fontSize: 9,
                      lineHeight: 11,
                      fontFamily: "SpaceGrotesk-Bold",
                    }}
                  >
                    {unreadClientsCount > 99 ? "99+" : String(unreadClientsCount)}
                  </MvText>
                </View>
              ) : null}
            </View>
            <MvText
              variant="navLabel"
              numberOfLines={1}
              style={{
                color: isActive ? activeColor : inactiveColor,
                textAlign: "center",
                fontSize: 10,
                letterSpacing: 0.2,
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
