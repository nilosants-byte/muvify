import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../theme';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { useThemedStyles } from "../../theme/useThemedStyles";

interface AppModalProps {
  visible: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel: () => void;
  loading?: boolean;
  tone?: 'default' | 'danger';
  children?: React.ReactNode;
  actionsLayout?: 'auto' | 'row' | 'col';
}

const MAX_CARD_WIDTH = 480;

export function AppModal({
  visible,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  loading = false,
  tone = 'default',
  children,
  actionsLayout = 'auto',
}: AppModalProps) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = (() => {
    try {
      return useSafeAreaInsets();
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
  })();
  const styles = useThemedStyles((palette) => ({
    keyboardAvoid: {
      flex: 1,
    },
    overlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      backgroundColor: palette.surfaceElevated,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      padding: theme.spacing.lg,
      zIndex: 1,
      ...theme.shadows.card,
    },
    title: {
      marginBottom: theme.spacing.sm,
    },
    bodyScroll: {
      flexGrow: 0,
    },
    bodyContent: {
      paddingBottom: theme.spacing.md,
    },
    description: {},
    actions: {
      marginTop: theme.spacing.sm,
    },
    actionsCol: {
      gap: theme.spacing.sm,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    actionFlex: {
      flex: 1,
    },
  }));

  const isRowLayout =
    actionsLayout === 'row' ||
    (actionsLayout === 'auto' &&
      confirmLabel.length <= 10 &&
      cancelLabel.length <= 10);

  const maxCardHeight = screenHeight * 0.85 - insets.top - insets.bottom;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        style={styles.keyboardAvoid}
      >
        <View
          style={[
            styles.overlay,
            {
              paddingTop: Math.max(theme.spacing.xl, insets.top + theme.spacing.md),
              paddingBottom: Math.max(theme.spacing.xl, insets.bottom + theme.spacing.md),
              paddingHorizontal: theme.spacing.xl,
            },
          ]}
        >
          <Pressable
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
            onPress={onCancel}
            accessibilityLabel="Fechar modal"
            accessibilityRole="button"
          />

          <View
            style={[
              styles.card,
              {
                maxHeight: maxCardHeight,
                width: '100%',
                maxWidth: MAX_CARD_WIDTH,
              },
            ]}
            accessibilityViewIsModal
            accessibilityRole="none"
            importantForAccessibility="yes"
          >
            <AppText
              style={styles.title}
              variant="title"
              accessibilityRole="header"
            >
              {title}
            </AppText>

            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            >
              {children ?? (
                description ? (
                  <AppText style={styles.description} variant="subtitle">
                    {description}
                  </AppText>
                ) : null
              )}
            </ScrollView>

            {onConfirm || onCancel ? (
              <View
                style={[
                  styles.actions,
                  isRowLayout ? styles.actionsRow : styles.actionsCol,
                ]}
              >
                <AppButton
                  onPress={onCancel}
                  title={cancelLabel}
                  variant="secondary"
                  fullWidth={!isRowLayout}
                  style={isRowLayout ? styles.actionFlex : undefined}
                />
                <AppButton
                  loading={loading}
                  onPress={onConfirm}
                  title={confirmLabel}
                  variant={tone === 'danger' ? 'danger' : 'primary'}
                  fullWidth={!isRowLayout}
                  style={isRowLayout ? styles.actionFlex : undefined}
                />
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
