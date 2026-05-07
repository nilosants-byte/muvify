import React from "react";
import { Platform, Pressable, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Animated from "../../utils/reanimated";
import { usePressSpring } from "../../animations";
import { AppText } from "../ui/AppText";
import { theme } from "../../theme";
import { useAppState } from "../../state/AppState";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";
import {
  IconCalendar,
  IconHeart,
  IconHome,
  IconProfile,
  IconRevenue,
  IconSearch,
  IconWorkout,
  IconBell,
  IconStar,
} from "../icons/MuvifyIcons";

type TabConfig = {
  label: string;
  icon: (props: { color: string; size: number }) => React.ReactNode;
};

const clientTabs: Record<string, TabConfig> = {
  ClientHome: { label: "Home", icon: (p) => <IconHome {...p} /> },
  Categories: { label: "Buscar", icon: (p) => <IconSearch {...p} /> },
  Promotions: { label: "Promo", icon: (p) => <IconStar color={p.color} size={p.size} /> },
  MyTraining: { label: "Treino", icon: (p) => <IconWorkout {...p} /> },
  ClientBookings: { label: "Agenda", icon: (p) => <IconCalendar {...p} /> },
  Favorites: { label: "Favoritos", icon: (p) => <IconHeart {...p} /> },
  ClientProfile: { label: "Perfil", icon: (p) => <IconProfile {...p} /> },
};

const professionalTabs: Record<string, TabConfig> = {
  ProfessionalHome: { label: "Home", icon: (p) => <IconHome {...p} /> },
  ProfessionalAgenda: { label: "Agenda", icon: (p) => <IconCalendar {...p} /> },
  ProfessionalConsultancyCenter: { label: "Consultoria", icon: (p) => <IconWorkout {...p} /> },
  PayoutStatus: { label: "Financeiro", icon: (p) => <IconRevenue {...p} /> },
  Notifications: { label: "Avisos", icon: (p) => <IconBell {...p} /> },
  ProfessionalProfileEditor: { label: "Perfil", icon: (p) => <IconProfile {...p} /> },
};


function getConfig(routeName: string) {
  return clientTabs[routeName] ?? professionalTabs[routeName];
}

export function AppBottomNav({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { themeMode } = useAppState();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    blurWrap: {
      borderTopWidth: 1,
      borderTopColor: palette.border,
      overflow: "hidden",
      ...theme.shadows.bottomNav,
    },
    outer: {
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-around",
      alignItems: "center",
      paddingHorizontal: theme.spacing.md,
      gap: 4,
    },
    itemWrap: {
      flex: 1,
      maxWidth: 82,
    },
    item: {
      minWidth: 44,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: theme.radius.md,
      alignItems: "center",
      gap: 4,
    },
    itemActive: {
      backgroundColor: palette.primaryMuted,
    },
    label: {
      fontSize: 11,
    },
  }));

  const outerStyle = [
    styles.outer,
    {
      paddingBottom: insets.bottom + 12,
      paddingTop: 12,
      backgroundColor: Platform.OS === "android" ? colors.navBg : "transparent",
    },
  ];

  const content = (
    <View style={styles.row}>
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const config = getConfig(route.name);
        if (!config) {
          return null;
        }

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const { animStyle, onPressIn, onPressOut } = usePressSpring(0.92);
        const iconColor = isFocused ? colors.primary : colors.textTertiary;
        const labelColor = isFocused ? colors.primary : colors.textTertiary;

        return (
          <Animated.View key={route.key} style={[styles.itemWrap, animStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={config.label}
              accessibilityState={isFocused ? { selected: true } : undefined}
              onPress={onPress}
              onPressIn={onPressIn}
              onPressOut={onPressOut}
              style={[
                styles.item,
                isFocused && styles.itemActive,
              ]}
            >
              {config.icon({ color: iconColor, size: 20 })}
              <AppText style={[styles.label, { color: labelColor }]} variant="caption">
                {config.label}
              </AppText>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );

  if (Platform.OS === "android") {
    return <View style={[outerStyle, theme.shadows.bottomNav]}>{content}</View>;
  }

  return (
    <View style={styles.blurWrap}>
      <BlurView intensity={80} tint={themeMode === "dark" ? "dark" : "light"} style={outerStyle}>
        {content}
      </BlurView>
    </View>
  );
}
