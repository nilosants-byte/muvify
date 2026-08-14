import { Ionicons } from "@expo/vector-icons";
import React, { ReactNode, useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Alert, Pressable, ScrollView, StatusBar, TouchableOpacity, useWindowDimensions, View } from "react-native";
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
  const { height: windowHeight } = useWindowDimensions();
  const { signOut, setThemePreference, user } = useAppState();
  const { theme, isDark, toggleTheme } = useMvTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    return () => setMenuOpen(false);
  }, []));

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
        label: "Validação de CREF",
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
        key: "AdminModeration" as const,
        label: "Moderação de denúncias",
        icon: "flag-outline" as const,
        action: () => navigation.navigate("AdminModeration")
      },
      {
        key: "AdminChatAudit" as const,
        label: "Auditoria de chats",
        icon: "chatbubbles-outline" as const,
        action: () => navigation.navigate("AdminChatAudit")
      },
      {
        key: "AdminConsultas" as const,
        label: "Consultas",
        icon: "search-outline" as const,
        action: () => navigation.navigate("AdminConsultas")
      },
      {
        key: "AdminExercises" as const,
        label: "Banco de exercícios",
        icon: "barbell-outline" as const,
        action: () => navigation.navigate("AdminExercises")
      },
      {
        key: "AdminDisputes" as const,
        label: "Casos de disputa",
        icon: "warning-outline" as const,
        action: () => navigation.navigate("AdminDisputes")
      },
      {
        key: "AdminDebts" as const,
        label: "Pendências financeiras",
        icon: "cash-outline" as const,
        action: () => navigation.navigate("AdminDebts")
      },
      {
        key: "AdminUserSearch" as const,
        label: "Buscar usuário",
        icon: "person-outline" as const,
        action: () => navigation.navigate("AdminUserSearch")
      },
      {
        key: "AdminNoShowReports" as const,
        label: "Reincidência de falta",
        icon: "alert-circle-outline" as const,
        action: () => navigation.navigate("AdminNoShowReports")
      },
      {
        key: "AdminDataRetention" as const,
        label: "Retenção de dados",
        icon: "shield-outline" as const,
        action: () => navigation.navigate("AdminDataRetention")
      },
      // Segunda camada, Frente 1, Lote 4 (fechamento): Security/
      // ConnectedDevices só eram alcançáveis pelo banner de 2FA acima, que
      // some assim que o admin ativa 2FA - depois disso não sobrava nenhum
      // caminho na UI pra rever configurações de segurança ou desconectar
      // um aparelho. Os outros 2 perfis já têm "Segurança" fixa no menu.
      {
        key: "Security" as const,
        label: "Segurança",
        icon: "lock-closed-outline" as const,
        action: () => navigation.navigate("Security")
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
          Alert.alert(
            "Sair",
            "Deseja encerrar a sessão de administrador?",
            [
              { text: "Cancelar", style: "cancel" },
              { text: "Sair", style: "destructive", onPress: () => void signOut() },
            ]
          );
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
          accessibilityRole="button"
          accessibilityLabel={menuOpen ? "Fechar menu" : "Abrir menu de navegação"}
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
        <View style={{ flex: 1, alignItems: "center" }}>
          <MvText variant="h1">{title}</MvText>
          {user?.email ? (
            <MvText variant="caption" color="secondary" numberOfLines={1}>{user.email}</MvText>
          ) : null}
        </View>
        <View style={{ width: 36, height: 36 }} />
      </View>

      {/* Raio-X de pagamentos, Rodada 4, Lote 12: a conta admin (allowlist de
          e-mail) é a mais sensível do sistema e podia ficar protegida só por
          senha. Não bloqueamos o login em si (travaria o admin pra sempre,
          já que ativar 2FA exige estar logado primeiro) — em vez disso, um
          aviso persistente em toda tela admin até configurar.
          Épico de Frentes, Frente 10, Lote 7: reconfirmado nesta auditoria
          como decisão de produto intencional, não um gap esquecido -
          mantido como banner (não bloqueio) por enquanto. */}
      {user?.role === "ADMIN" && !user?.twoFactorEnabled ? (
        <TouchableOpacity
          onPress={() => navigation.navigate("Security")}
          style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            marginHorizontal: 16, marginTop: 10,
            borderRadius: 12, borderWidth: 1, borderColor: theme.warningSubtleBorder,
            backgroundColor: theme.warningSubtle,
            paddingHorizontal: 13, paddingVertical: 10,
          }}
        >
          <Ionicons name="shield-outline" size={16} color={theme.warning} />
          <MvText variant="caption" style={{ flex: 1, color: theme.warning, fontFamily: "DMSans_700Bold" }}>
            Configure a autenticação em dois fatores — obrigatória para contas de administrador
          </MvText>
          <Ionicons name="chevron-forward" size={14} color={theme.warning} />
        </TouchableOpacity>
      ) : null}

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
              // Segunda camada, Frente 1, Lote 4 (fechamento): a lista de
              // itens só crescia (12 rotas + tema + sair, agora 13) sem
              // nenhum limite de altura nem rolagem - em aparelhos menores
              // os últimos itens (inclusive "Sair") podiam ficar fora da
              // área visível, sem como alcançar.
              maxHeight: windowHeight - insets.top - 60 - insets.bottom - 24,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.mode === "dark" ? "#0d1a0d" : "#ffffff",
              overflow: "hidden",
              shadowColor: theme.textOnPrimary,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 12
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
            {menuItems.map((item, index) => {
              const active =
                (item.key === "AdminHome" ||
                  item.key === "AdminCrefValidation" ||
                  item.key === "AdminSupport" ||
                  item.key === "AdminModeration" ||
                  item.key === "AdminChatAudit" ||
                  item.key === "AdminConsultas" ||
                  item.key === "AdminExercises" ||
                  item.key === "AdminDisputes" ||
                  item.key === "AdminDebts" ||
                  item.key === "AdminUserSearch" ||
                  item.key === "AdminNoShowReports" ||
                  item.key === "AdminDataRetention" ||
                  item.key === "Security") &&
                item.key === currentScreen;
              return (
                <TouchableOpacity
                  key={item.key}
                  testID={`button.admin.menu.${item.key}`}
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
                    backgroundColor: active ? theme.primarySubtle : "transparent"
                  }}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={item.danger ? theme.danger : theme.text2}
                  />
                  <MvText variant="semi2" color={item.danger ? "danger" : "primary"}>
                    {item.label}
                  </MvText>
                </TouchableOpacity>
              );
            })}
            </ScrollView>
          </View>
        </>
      ) : null}
    </View>
  );
}
