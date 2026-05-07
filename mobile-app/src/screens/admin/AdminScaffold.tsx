import { Ionicons } from "@expo/vector-icons";
import React, { ReactNode, useMemo, useState } from "react";
import { Pressable, StatusBar, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MvText } from "../../components/mv";
import type { AdminStackParamList } from "../../navigation/route-types";
import { useAppState } from "../../state/AppState";
import { useMvTheme } from "../../theme/MvThemeContext";

type AdminScreenKey = keyof AdminStackParamList;

type AdminScaffoldProps = {
  title: string;
  navigation: {
    navigate: (screen: string, params?: unknown) => void;
  };
  currentScreen: AdminScreenKey;
  children: ReactNode;
};

export function AdminScaffold({
  title,
  navigation,
  currentScreen,
  children
}: AdminScaffoldProps) {
  const insets = useSafeAreaInsets();
  const { signOut, setThemePreference } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const menuItems = useMemo(
    () => [
      {
        key: "AdminHome" as const,
        label: "Painel Geral",
        icon: "grid-outline" as const,
        action: () => navigation.navigate("AdminHome")
      },
      {
        key: "AdminCrefValidation" as const,
        label: "Validacao de CREF",
        icon: "shield-checkmark-outline" as const,
        action: () => navigation.navigate("AdminCrefValidation")
      },
      {
        key: "AdminSupport" as const,
        label: "Suporte",
        icon: "help-circle-outline" as const,
        action: () => navigation.navigate("AdminSupport")
      },
      {
        key: "AdminChatAudit" as const,
        label: "Auditoria de chats",
        icon: "chatbubbles-outline" as const,
        action: () => navigation.navigate("AdminChatAudit")
      },
      {
        key: "toggleTheme" as const,
        label: isDark ? "Modo claro" : "Modo escuro",
        icon: (isDark ? "sunny-outline" : "moon-outline") as keyof typeof Ionicons.glyphMap,
        action: () => {
          toggleTheme();
          void setThemePreference(isDark ? "light" : "dark");
        }
      },
      {
        key: "logout" as const,
        label: "Sair",
        icon: "log-out-outline" as const,
        danger: true,
        action: () => {
          void signOut();
        }
      }
    ],
    [isDark, navigation, setThemePreference, signOut, toggleTheme]
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.bg}
      />

      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: theme.border
        }}
      >
        <TouchableOpacity
          testID="button.admin.menu-toggle"
          onPress={() => setMenuOpen((current) => !current)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: theme.backBtn,
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Ionicons name="menu-outline" size={20} color={theme.text2} />
        </TouchableOpacity>
        <MvText variant="h4">{title}</MvText>
        <View style={{ width: 36, height: 36 }} />
      </View>

      {children}

      {menuOpen ? (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            style={{
              position: "absolute",
              top: insets.top + 60,
              left: 12,
              width: 240,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.mode === "dark" ? "#0d1a0d" : "#ffffff",
              overflow: "hidden",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 12
            }}
          >
            {menuItems.map((item, index) => {
              const active =
                (item.key === "AdminHome" ||
                  item.key === "AdminCrefValidation" ||
                  item.key === "AdminSupport" ||
                  item.key === "AdminChatAudit") &&
                item.key === currentScreen;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => {
                    setMenuOpen(false);
                    item.action();
                  }}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderColor: theme.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    backgroundColor: active
                      ? theme.mode === "dark"
                        ? "rgba(76,175,80,0.12)"
                        : "rgba(76,175,80,0.1)"
                      : "transparent"
                  }}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={item.danger ? "#f44336" : theme.text2}
                  />
                  <MvText variant="semi2" color={item.danger ? "danger" : "primary"}>
                    {item.label}
                  </MvText>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}
