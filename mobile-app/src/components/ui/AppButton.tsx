import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableStateCallbackType,
  StyleProp,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Animated from "../../utils/reanimated";
import { MaterialIcons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { AppText } from './AppText';
import { usePressSpring } from "../../animations";
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'offline';

interface AppButtonProps {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: keyof typeof MaterialIcons.glyphMap;
  iconRight?: keyof typeof MaterialIcons.glyphMap;
  variant?: AppButtonVariant;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const MIN_TOUCH_SIZE = 44;

export function AppButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  variant = 'primary',
  fullWidth = true,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const { fontScale, width: screenWidth } = useWindowDimensions();
  const { animStyle, onPressIn, onPressOut } = usePressSpring(0.97);
  const { colors } = useTheme() as { colors: any; themeMode: any };
  const styles = useThemedStyles((palette) => ({
    base: {
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    fullWidth: {
      width: '100%',
    },
    pressed: {
      opacity: 0.92,
    },
    disabled: {
      backgroundColor: palette.disabledBg,
      borderColor: palette.border,
    },
    content: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xs,
    },
    title: {
      textAlign: 'center',
      letterSpacing: 0.2,
      flexShrink: 1,
      flexWrap: 'wrap',
    },
  }));
  const containerVariants = useMemo<Record<AppButtonVariant, ViewStyle>>(
    () => ({
      primary: {
        backgroundColor: colors.primary,
        borderWidth: 0,
        ...(theme.shadows.button ?? {}),
      },
      secondary: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.borderMedium ?? colors.border,
      },
      ghost: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.borderMedium ?? colors.border,
      },
      danger: {
        backgroundColor: colors.danger,
        borderWidth: 1,
        borderColor: colors.danger,
      },
      success: {
        backgroundColor: colors.primary,
        borderWidth: 0,
      },
      offline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.borderStrong,
      },
    }),
    [colors],
  );

  const dynamicHeight = Math.max(
    MIN_TOUCH_SIZE,
    theme.layout.buttonHeight * Math.min(fontScale, 1.4),
  );

  const dynamicPaddingH = screenWidth <= 320 ? theme.spacing.md : theme.spacing.lg;

  const getContainerStyle = ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
    styles.base,
    { minHeight: dynamicHeight, paddingHorizontal: dynamicPaddingH },
    fullWidth && styles.fullWidth,
    containerVariants[variant],
    isDisabled && styles.disabled,
    pressed && !isDisabled && styles.pressed,
    style,
  ];
  const textColor = getTextColor(variant, isDisabled, colors);
  const iconColor = textColor;
  return (
    <Animated.View style={animStyle}>
      <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLiveRegion={loading ? 'polite' : 'none'}
      disabled={isDisabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={getContainerStyle}
      testID={testID}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            accessibilityLabel="Carregando"
            color={textColor}
            size="small"
          />
        ) : (
          <>
            {iconLeft ? (
              <MaterialIcons
                accessibilityElementsHidden
                color={iconColor}
                importantForAccessibility="no"
                name={iconLeft}
                size={20}
              />
            ) : null}
            <AppText
              color={textColor}
              ellipsizeMode="tail"
              numberOfLines={2}
              style={styles.title}
              variant="button"
            >
              {title}
            </AppText>
            {iconRight ? (
              <MaterialIcons
                accessibilityElementsHidden
                color={iconColor}
                importantForAccessibility="no"
                name={iconRight}
                size={20}
              />
            ) : null}
          </>
        )}
      </View>
    </Pressable>
    </Animated.View>
  );
}
function getTextColor(
  variant: AppButtonVariant,
  disabled: boolean,
  colors: ReturnType<typeof useTheme>["colors"]
): string {
  if (disabled) {
    return colors.disabledText;
  }
  if (variant === 'primary' || variant === 'success') {
    return colors.textInverse;
  }

  if (variant === 'danger') {
    return colors.white;
  }
  if (variant === 'offline') {
    return colors.textSecondary;
  }
  return colors.text;
}
