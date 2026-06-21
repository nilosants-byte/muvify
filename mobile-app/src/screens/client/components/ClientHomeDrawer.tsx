import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMvTheme } from "../../../theme/MvThemeContext";
import { MvAvatar, MvText } from "../../../components/mv";

const SCREEN_W = Dimensions.get("window").width;
const DRAWER_W = Math.min(SCREEN_W * 0.82, 320);

export type SideMenuItem = {
  key: string;
  label: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  sectionHeader?: string;
};

type Props = {
  visible: boolean;
  items: SideMenuItem[];
  onDismiss: () => void;
  insetTop: number;
  isLight: boolean;
  displayName: string;
  initials: string;
  photoUri: string | null;
};

export function ClientHomeDrawer({
  visible,
  items,
  onDismiss,
  insetTop,
  isLight,
  displayName,
  initials,
  photoUri,
}: Props) {
  const { theme } = useMvTheme();
  const { bottom: insetBottom } = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-DRAWER_W)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 220,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -DRAWER_W,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, slideAnim]);

  if (!mounted) return null;

  const drawerText = theme.text1;
  const drawerSub = theme.text2;
  const drawerMuted = theme.text3;
  const drawerDivider = theme.border;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
      {/* Backdrop transparente — apenas captura toque para fechar */}
      <Pressable
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "transparent" }}
        onPress={onDismiss}
      />

      {/* Painel lateral deslizante */}
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: DRAWER_W,
          borderRightWidth: 1,
          borderRightColor: isLight ? "rgba(22,163,74,0.12)" : "rgba(34,197,94,0.14)",
          transform: [{ translateX: slideAnim }],
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.28,
          shadowRadius: 24,
          shadowOffset: { width: 10, height: 0 },
          elevation: 20,
        }}
      >
        <BlurView
          intensity={isLight ? 60 : 72}
          tint={isLight ? "light" : "dark"}
          style={{ flex: 1 }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insetBottom + 24 }}
          >
            {/* ── Perfil do usuário ── */}
            <View
              style={{
                paddingTop: insetTop + 20,
                paddingHorizontal: 20,
                paddingBottom: 20,
                borderBottomWidth: 1,
                borderBottomColor: isLight ? "rgba(21,128,61,0.12)" : "rgba(34,197,94,0.12)",
                alignItems: "center",
                gap: 10,
              }}
            >
              <MvAvatar
                initials={initials}
                photoUri={photoUri}
                size={64}
                borderRadius={32}
                color="green"
              />
              <View style={{ alignItems: "center", gap: 3 }}>
                <MvText variant="semi1" style={{ fontSize: 17, color: drawerText }}>
                  {displayName}
                </MvText>
                <View
                  style={{
                    marginTop: 4,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 20,
                    backgroundColor: theme.primarySubtle,
                    borderWidth: 1,
                    borderColor: theme.primarySubtleBorder,
                  }}
                >
                  <MvText variant="badge" style={{ color: theme.textGreen, fontSize: 10 }}>
                    Cliente
                  </MvText>
                </View>
              </View>
            </View>

            {/* ── Itens do menu ── */}
            {items.map((item) => (
              <React.Fragment key={item.key}>
                {item.sectionHeader ? (
                  <MvText
                    variant="caption"
                    style={{
                      color: drawerMuted,
                      paddingHorizontal: 20,
                      paddingTop: 18,
                      paddingBottom: 4,
                      letterSpacing: 0.8,
                    }}
                  >
                    {item.sectionHeader}
                  </MvText>
                ) : null}

                <TouchableOpacity
                  onPress={item.onPress}
                  disabled={Boolean(item.right) || !item.onPress}
                  activeOpacity={item.right ? 1 : 0.75}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    paddingHorizontal: 20,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: drawerDivider,
                    ...(item.danger ? { marginTop: 12 } : {}),
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      backgroundColor: item.danger
                        ? "rgba(239,68,68,0.10)"
                        : theme.primarySubtle,
                      borderWidth: 1,
                      borderColor: item.danger
                        ? "rgba(239,68,68,0.25)"
                        : theme.primarySubtleBorder,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={item.icon}
                      size={16}
                      color={item.danger ? theme.danger : theme.textGreen}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <MvText
                      variant="semi2"
                      style={{ color: item.danger ? theme.danger : drawerText }}
                    >
                      {item.label}
                    </MvText>
                    {item.subtitle ? (
                      <MvText
                        variant="caption"
                        style={{ color: drawerSub, marginTop: 1 }}
                      >
                        {item.subtitle}
                      </MvText>
                    ) : null}
                  </View>

                  {item.right
                    ? item.right
                    : item.danger
                    ? null
                    : <Ionicons name="chevron-forward" size={15} color={drawerMuted} />}
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </ScrollView>
        </BlurView>
      </Animated.View>
    </View>
  );
}
