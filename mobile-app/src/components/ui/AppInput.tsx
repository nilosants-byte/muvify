import React, { forwardRef, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
  // useWindowDimensions permite reagir a mudancas de tamanho de tela
  // (rotacao, janela dividida no Android) em vez de ler Dimensions uma unica vez.
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { AppText } from './AppText';
import { useTheme } from "../../theme/useTheme";
import { useThemedStyles } from "../../theme/useThemedStyles";

// Apple HIG: 44 x 44 pt  |  Material: 48 x 48 dp
const MIN_TOUCH_SIZE = 44;

interface AppInputProps extends TextInputProps {
  label?: string;
  hint?: string;
  accessibilityRequired?: boolean;
  error?: string;
  success?: string;
  offline?: boolean;
  leftIcon?: keyof typeof MaterialIcons.glyphMap;
  rightIcon?: keyof typeof MaterialIcons.glyphMap;
  onPressRightIcon?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  multiline?: boolean;
}

export const AppInput = forwardRef<TextInput, AppInputProps>(function AppInput(
  {
    label,
    hint,
    accessibilityRequired = false,
    error,
    success,
    offline = false,
    leftIcon,
    rightIcon,
    onPressRightIcon,
    editable = true,
    containerStyle,
    onFocus,
    onBlur,
    style: inputStyle,
    multiline = false,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const trackFocusVisualState = Platform.OS !== "ios";
  const { colors } = useTheme();
  const styles = useThemedStyles((palette) => ({
    label: {
      marginBottom: 6,
      marginLeft: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    wrapper: {
      borderWidth: 1,
      backgroundColor: palette.inputBg,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
    },
    wrapperMultiline: {
      alignItems: 'flex-start',
    },
    defaultBorder: {
      borderColor: palette.border,
    },
    focused: {
      borderColor: palette.primary,
      backgroundColor: palette.inputBg,
      shadowColor: palette.primary,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 3,
    },
    error: {
      borderColor: palette.danger,
    },
    success: {
      borderColor: palette.primary,
    },
    offline: {
      borderColor: palette.border,
      opacity: 0.72,
    },
    leftIcon: {
      marginRight: theme.spacing.xs,
    },
    rightAction: {
      paddingLeft: theme.spacing.sm,
      minWidth: MIN_TOUCH_SIZE,
      minHeight: MIN_TOUCH_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconTop: {
      marginTop: 12,
      alignSelf: 'flex-start',
    },
    input: {
      flex: 1,
      color: palette.text,
      fontSize: theme.fontSize.md,
    },
    inputWithLeftIcon: {
      paddingLeft: 0,
    },
    inputMultiline: {
      minHeight: 100,
      textAlignVertical: 'top',
    },
    helperText: {
      marginTop: 4,
      marginLeft: 2,
    },
  }));

  const { fontScale } = useWindowDimensions();

  const dynamicMinHeight = Math.max(
    theme.layout.inputHeight,
    MIN_TOUCH_SIZE * Math.min(fontScale, 1.5),
  );

  const stateStyle = useMemo(() => {
    if (!editable || offline) return styles.offline;
    if (error) return styles.error;
    if (success) return styles.success;
    if (focused) return styles.focused;
    return styles.defaultBorder;
  }, [editable, error, focused, offline, success]);

  const helperText = error ?? success ?? hint;
  const accessibilityHintText = accessibilityRequired
    ? hint
      ? `${hint} Campo obrigatório.`
      : "Campo obrigatório."
    : hint;
  const helperColor = error
    ? colors.danger
    : success
      ? colors.primary
      : colors.textSecondary;

  const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
    if (trackFocusVisualState) {
      setFocused(true);
    }
    onFocus?.(event);
  };

  const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
    if (trackFocusVisualState) {
      setFocused(false);
    }
    onBlur?.(event);
  };

  const wrapperRadius = theme.radius.md;

  return (
    <View style={containerStyle}>
      {label ? (
        <AppText style={styles.label} variant="label">
          {label}
        </AppText>
      ) : null}

      <View
        style={[
          styles.wrapper,
          stateStyle,
          { minHeight: dynamicMinHeight, borderRadius: wrapperRadius },
          multiline && styles.wrapperMultiline,
        ]}
      >
        {leftIcon ? (
          <MaterialIcons
            color={focused ? colors.primary : colors.textSecondary}
            name={leftIcon}
            size={20}
            style={[styles.leftIcon, multiline && styles.iconTop]}
          />
        ) : null}

        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          showSoftInputOnFocus={rest.showSoftInputOnFocus ?? true}
          editable={editable && !offline}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholderTextColor={colors.inputPlaceholder}
          selectionColor={colors.primary}
          accessibilityLabel={label ?? (rest.placeholder as string | undefined)}
          accessibilityHint={accessibilityHintText}
          accessibilityState={{
            disabled: !editable || offline,
          }}
          style={[
            styles.input,
            leftIcon ? styles.inputWithLeftIcon : undefined,
            { paddingVertical: Math.max(10, 11 * fontScale) },
            multiline && styles.inputMultiline,
            inputStyle as StyleProp<TextStyle>,
          ]}
        />

        {rightIcon ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onPressRightIcon}
            style={[styles.rightAction, multiline && styles.iconTop]}
          >
            <MaterialIcons
              color={focused ? colors.primary : colors.textSecondary}
              name={rightIcon}
              size={20}
            />
          </Pressable>
        ) : null}
      </View>

      {helperText ? (
        <AppText color={helperColor} style={styles.helperText} variant="caption">
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
});
