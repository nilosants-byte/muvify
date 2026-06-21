import React, { useMemo, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../ui/AppText";
import { theme } from "../../theme";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";
import { captureException } from "../../observability/sentry";

const MIN_TOUCH_SIZE = 44;

export type TopLeftMenuItem = {
  key: string;
  label: string;
  onPress: () => void | Promise<void>;
  destructive?: boolean;
};

type TopLeftMenuProps = {
  title?: string;
  subtitle?: string;
  items: TopLeftMenuItem[];
};

const MASCOT = require("../../../assets/branding/muvify-mascot.png");
const MASCOT_ASPECT_RATIO = 28 / 46;

export function TopLeftMenu({ items }: TopLeftMenuProps) {
  const [open, setOpen] = useState(false);
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const insets = (() => {
    try {
      return useSafeAreaInsets();
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
  })();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    menuTrigger: {
      // minWidth/minHeight aplicados inline para garantir 44×44
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceElevated,
      alignItems: "center",
      justifyContent: "center",
    },
    menuTriggerPressed: {
      opacity: 0.75,
      transform: [{ scale: 0.96 }],
    },
    barsWrap: {
      width: 16,
      gap: 4,
    },
    bar: {
      height: 2,
      borderRadius: theme.radius.pill,
      backgroundColor: palette.text,
    },
    barLong: {
      width: 16,
    },
    barShort: {
      width: 10,
    },
    overlay: {
      flex: 1,
      backgroundColor: palette.overlaySoft,
      justifyContent: "flex-start",
    },
    sheet: {
      height: "100%",
      backgroundColor: "rgba(10, 19, 15, 0.92)",
      borderRightWidth: 0.8,
      borderRightColor: palette.chipBorder,
      paddingHorizontal: theme.spacing.md,
      zIndex: 1,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      marginBottom: theme.spacing.lg,
    },
    items: {},
    item: {
      paddingHorizontal: theme.spacing.xs,
      borderRadius: theme.radius.md,
      borderWidth: 0.8,
      borderColor: "transparent",
    },
    itemPressed: {
      borderColor: palette.border,
      backgroundColor: palette.chipBg,
    },
    itemDestructive: {
      backgroundColor: "rgba(111, 31, 41, 0.28)",
      borderColor: "rgba(141, 46, 58, 0.65)",
    },
  }));

  const safeItems = useMemo(() => items.slice(0, 12), [items]);

  function close() {
    setOpen(false);
  }

  // Largura do drawer responsiva
  const sheetWidth = (() => {
    if (screenWidth <= 320) return Math.max(220, screenWidth * 0.75);
    if (screenWidth <= 480) return Math.min(280, Math.max(220, screenWidth * 0.55));
    return 280;
  })();

  const mascotHeight = Math.round(Math.min(52, sheetWidth * 0.2));
  const mascotWidth = Math.round(mascotHeight * MASCOT_ASPECT_RATIO);

  const sheetPaddingTop = Math.max(46, insets.top + theme.spacing.md);
  const itemPaddingV = Math.max(12, Math.round(12 * Math.min(fontScale, 1.2)));
  const itemsGap = Math.max(4, Math.round(4 * Math.min(fontScale, 1.3)));

  return (
    <View>
      {/* Botão que abre o menu */}
      <Pressable
        accessibilityHint="Abre o menu de navegação lateral"
        accessibilityLabel="Abrir menu"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
        style={({ pressed }) => [
          styles.menuTrigger,
          { minWidth: MIN_TOUCH_SIZE, minHeight: MIN_TOUCH_SIZE },
          pressed && styles.menuTriggerPressed,
        ]}
        onPress={() => setOpen(true)}
      >
        <View style={styles.barsWrap}>
          <View style={[styles.bar, styles.barLong]} />
          <View style={[styles.bar, styles.barShort]} />
        </View>
      </Pressable>

      {/* Drawer lateral */}
      <Modal
        animationType="fade"
        statusBarTranslucent
        transparent
        visible={open}
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          {/* Área de overlay fecha ao toque */}
          <Pressable
            accessibilityLabel="Fechar menu"
            accessibilityRole="button"
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
            onPress={close}
          />

          {/* Sheet */}
          <View
            accessibilityViewIsModal
            importantForAccessibility="yes"
            style={[
              styles.sheet,
              {
                width: sheetWidth,
                paddingTop: sheetPaddingTop,
                paddingBottom: Math.max(
                  theme.spacing.xl,
                  insets.bottom + theme.spacing.md
                ),
              },
              Platform.OS === "web"
                ? ({ backdropFilter: "blur(10px)" } as any)
                : null,
            ]}
          >
            {/* Cabeçalho com mascote */}
            <View style={styles.sheetHeader}>
              <Image
                accessibilityLabel="Mascote Muvify"
                accessibilityRole="image"
                resizeMode="contain"
                source={MASCOT}
                style={{ width: mascotWidth, height: mascotHeight }}
              />
            </View>

            {/* Itens do menu */}
            <View style={[styles.items, { gap: itemsGap }]}>
              {safeItems.map((item) => (
                <Pressable
                  key={item.key}
                  accessibilityHint={item.destructive ? "Ação destrutiva" : undefined}
                  accessibilityLabel={item.label}
                  accessibilityRole="menuitem"
                  style={({ pressed }) => [
                    styles.item,
                    { paddingVertical: itemPaddingV },
                    item.destructive && styles.itemDestructive,
                    pressed && styles.itemPressed,
                  ]}
                  onPress={() => {
                    close();
                    Promise.resolve(item.onPress()).catch((err) => {
                      if (__DEV__) {
                        console.warn(
                          `[TopLeftMenu] Erro no item "${item.key}":`,
                          err
                        );
                      }
                      captureException(err, { stage: "top_left_menu", itemKey: item.key });
                    });
                  }}
                >
                  <AppText
                    color={item.destructive ? colors.danger : colors.text}
                    ellipsizeMode="tail"
                    numberOfLines={1}
                    variant="bodyStrong"
                  >
                    {item.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
