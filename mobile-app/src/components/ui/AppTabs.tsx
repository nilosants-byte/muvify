import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { theme } from '../../theme';
import { AppText } from './AppText';
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

const MIN_TOUCH_SIZE = 44;

export interface AppTabItem {
  key: string;
  label: string;
}

interface AppTabsProps {
  items: AppTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function AppTabs({ items, activeKey, onChange }: AppTabsProps) {
  const scrollRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    wrapper: {
      position: 'relative',
      padding: 4,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceElevated,
    },
    content: {
      paddingRight: 24,
    },
    tab: {
      borderRadius: theme.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      overflow: 'hidden',
    },
    tabActive: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    tabInactive: {
      backgroundColor: palette.surfaceElevated,
      borderColor: palette.border,
    },
    tabPressed: {
      opacity: 0.8,
      transform: [{ scale: 0.97 }],
    },
    fadeRight: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 48,
      backgroundColor: 'transparent',
    },
  }));

  const { fontScale, width: screenWidth } = useWindowDimensions();

  const dynamicTabHeight = Math.max(MIN_TOUCH_SIZE, 32 * Math.min(fontScale, 1.35));
  const dynamicPaddingH = Math.round(16 * Math.min(fontScale, 1.2));

  useEffect(() => {
    const layout = tabLayouts.current[activeKey];
    if (!layout || !scrollRef.current) return;

    const scrollToX = Math.max(0, layout.x - screenWidth / 2 + layout.width / 2);
    scrollRef.current.scrollTo({ x: scrollToX, animated: true });
  }, [activeKey, screenWidth]);

  return (
    <View style={[styles.wrapper, { minHeight: dynamicTabHeight }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        contentContainerStyle={[
          styles.content,
          { gap: Math.round(theme.spacing.xs * Math.min(fontScale, 1.2)) },
        ]}
        showsHorizontalScrollIndicator={false}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              onLayout={(e) => {
                tabLayouts.current[item.key] = {
                  x: e.nativeEvent.layout.x,
                  width: e.nativeEvent.layout.width,
                };
              }}
              onPress={() => onChange(item.key)}
              style={({ pressed }) => [
                styles.tab,
                {
                  minHeight: dynamicTabHeight,
                  paddingHorizontal: dynamicPaddingH,
                  paddingVertical: Math.max(6, 6 * Math.min(fontScale, 1.2)),
                },
                active ? styles.tabActive : styles.tabInactive,
                pressed ? styles.tabPressed : undefined
              ]}
            >
              <AppText
                color={active ? colors.textInverse : colors.textSecondary}
                variant="captionStrong"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <View pointerEvents="none" style={styles.fadeRight} />
    </View>
  );
}
