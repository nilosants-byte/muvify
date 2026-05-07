import React from 'react';
import { Pressable, useWindowDimensions } from 'react-native';
import Animated from "../../utils/reanimated";
import { theme } from '../../theme';
import { AppText } from './AppText';
import { usePressSpring } from "../../animations";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

const MIN_TOUCH_SIZE = 44;

interface AppChipProps {
  label: string;
  accessibilityLabel?: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  selectionMode?: 'radio' | 'checkbox';
}

export function AppChip({
  label,
  accessibilityLabel,
  selected = false,
  onPress,
  disabled = false,
  selectionMode = 'radio',
}: AppChipProps) {
  const { fontScale } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    base: {
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    selected: {
      backgroundColor: palette.primary,
      borderColor: palette.primary,
    },
    unselected: {
      backgroundColor: palette.surfaceElevated,
      borderColor: palette.border,
    },
    pressed: {
      opacity: 0.8,
    },
    disabled: {
      opacity: 0.45,
    },
  }));

  const dynamicHeight = Math.max(
    MIN_TOUCH_SIZE,
    34 * Math.min(fontScale, 1.35),
  );

  const dynamicPaddingH = Math.round(14 * Math.min(fontScale, 1.2));
  const { animStyle, onPressIn, onPressOut } = usePressSpring(0.95);

  return (
    <Animated.View style={animStyle}>
      <Pressable
        accessibilityRole={selectionMode === 'checkbox' ? 'checkbox' : 'radio'}
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={accessibilityLabel ?? label}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={({ pressed }) => [
          styles.base,
          {
            minHeight: dynamicHeight,
            paddingHorizontal: dynamicPaddingH,
            paddingVertical: Math.max(6, 6 * Math.min(fontScale, 1.2)),
          },
          selected ? styles.selected : styles.unselected,
          pressed && !disabled ? styles.pressed : undefined,
          disabled ? styles.disabled : undefined,
        ]}
      >
        <AppText
          color={selected ? colors.textInverse : colors.textSecondary}
          variant="captionStrong"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}
