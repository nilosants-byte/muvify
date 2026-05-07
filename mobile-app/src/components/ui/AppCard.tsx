import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  StyleProp,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Animated from "../../utils/reanimated";
import { theme } from '../../theme';
import { usePressSpring } from "../../animations";
import { useTheme } from "../../theme/useTheme";

const MIN_TOUCH_SIZE = 44;

interface AppCardBaseProps {
  children: React.ReactNode;
  selected?: boolean;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  testID?: string;
}

interface AppCardPressableProps extends AppCardBaseProps {
  onPress: () => void;
  onLongPress?: () => void;
}

interface AppCardStaticProps extends AppCardBaseProps {
  onPress?: never;
  onLongPress?: never;
}

type AppCardProps = AppCardPressableProps | AppCardStaticProps;

export function AppCard({
  children,
  selected = false,
  elevated = false,
  style,
  contentStyle,
  disabled,
  accessibilityHint,
  accessibilityLabel,
  testID,
  onPress,
  onLongPress,
  ...rest
}: AppCardProps) {
  const { fontScale } = useWindowDimensions();
  const dynamicPadding = Math.round(12 * Math.min(fontScale, 1.33));
  const { animStyle, onPressIn, onPressOut } = usePressSpring(0.98);
  const { colors } = useTheme() as { colors: any; themeMode: any };
  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          backgroundColor: colors.surfaceStrong,
          borderRadius: theme.radius.card,
          borderWidth: 1,
          borderColor: colors.border,
        },
        elevated: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.borderMedium ?? colors.border,
          ...theme.shadows.card,
        },
        selected: {
          borderColor: colors.primary,
          backgroundColor: colors.chipBg,
        },
        pressed: {
          opacity: 0.88,
        },
        disabled: {
          opacity: 0.62,
        },
      }),
    [colors],
  );

  const baseStyle: StyleProp<ViewStyle> = [
    styles.base,
    { padding: dynamicPadding },
    elevated && styles.elevated,
    selected && styles.selected,
    disabled && styles.disabled,
    style,
  ];

  const content = contentStyle ? (
    <View style={contentStyle}>{children}</View>
  ) : children;

  if (!onPress) {
    return (
      <View
        {...rest}
        style={baseStyle}
        testID={testID}
        accessibilityState={selected ? { selected: true } : undefined}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </View>
    );
  }

  return (
    <Animated.View style={animStyle}>
      <Pressable
        {...rest}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{
          selected,
          disabled: !!disabled,
        }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={({ pressed }: { pressed?: boolean }) => [
          baseStyle,
          { minHeight: MIN_TOUCH_SIZE },
          pressed && !disabled ? styles.pressed : undefined,
        ]}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}
