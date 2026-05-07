import React from "react";
import {
  Ionicons,
  MaterialCommunityIcons,
  MaterialIcons,
} from "@expo/vector-icons";
import { Pressable, View, useWindowDimensions } from "react-native";
import { theme } from "../../theme";
import { AppText } from "../ui/AppText";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

const MIN_TOUCH_SIZE = 44;
const COLUMNS = 3;

type IconFamily = "material" | "community" | "ion";

export type HomeShortcutItem = {
  key: string;
  label: string;
  icon: string;
  iconFamily?: IconFamily;
  onPress: () => void;
};

type HomeShortcutsProps = {
  items: HomeShortcutItem[];
};

export function HomeShortcuts({ items }: HomeShortcutsProps) {
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    grid: {},
    row: {
      flexDirection: "row",
    },
    item: {
      alignItems: "center",
      gap: theme.spacing.xs,
      borderRadius: theme.radius.md,
    },
    itemPressed: {
      backgroundColor: palette.chipBg,
      transform: [{ scale: 0.96 }],
    },
    circle: {
      backgroundColor: palette.surfaceElevated,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      ...theme.shadows.card,
    },
    label: {},
  }));

  const columnGap = Math.round(theme.spacing.sm * Math.min(fontScale, 1.2));
  const rowGap = Math.round(theme.spacing.sm * Math.min(fontScale, 1.2));

  const itemWidth =
    (screenWidth -
      theme.layout.screenHorizontalPadding * 2 -
      columnGap * (COLUMNS - 1)) /
    COLUMNS;

  const circleSize = Math.round(52 * Math.min(fontScale, 1.25));
  const iconSize = Math.round(20 * Math.min(fontScale, 1.25));
  const itemPaddingV = Math.max(6, Math.round(4 * Math.min(fontScale, 1.3)));
  const rows: (HomeShortcutItem | null)[][] = [];
  const safeItems = items.slice(0, 12);

  for (let i = 0; i < safeItems.length; i += COLUMNS) {
    const row: (HomeShortcutItem | null)[] = [...safeItems.slice(i, i + COLUMNS)];
    while (row.length < COLUMNS) row.push(null);
    rows.push(row);
  }

  function renderIcon(item: HomeShortcutItem) {
    const iconProps = {
      color: colors.primary,
      name: item.icon as any,
      size: iconSize,
      importantForAccessibility: "no" as const,
      accessibilityElementsHidden: true,
    };

    if (item.iconFamily === "community") {
      return <MaterialCommunityIcons {...iconProps} />;
    }
    if (item.iconFamily === "ion") {
      return <Ionicons {...iconProps} />;
    }
    return <MaterialIcons {...iconProps} />;
  }

  return (
    <View style={[styles.grid, { rowGap }]}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={[styles.row, { gap: columnGap }]}>
          {row.map((item, colIndex) =>
            item === null ? (
              <View key={`placeholder-${colIndex}`} style={{ width: itemWidth }} />
            ) : (
              <Pressable
                key={item.key}
                accessibilityLabel={item.label}
                accessibilityRole="button"
                accessibilityHint={`Atalho para ${item.label}`}
                onPress={item.onPress}
                style={({ pressed }) => [
                  styles.item,
                  {
                    width: itemWidth,
                    paddingVertical: itemPaddingV,
                    minHeight: MIN_TOUCH_SIZE + circleSize,
                  },
                  pressed && styles.itemPressed,
                ]}
              >
                <View
                  style={[
                    styles.circle,
                    { width: circleSize, height: circleSize, borderRadius: circleSize / 2 },
                  ]}
                >
                  {renderIcon(item)}
                </View>

                <AppText
                  align="center"
                  style={styles.label}
                  variant="caption"
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {item.label}
                </AppText>
              </Pressable>
            ),
          )}
        </View>
      ))}
    </View>
  );
}
