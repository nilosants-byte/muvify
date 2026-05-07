import React from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { AppText } from './AppText';
import { theme } from '../../theme';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
  align?: 'flex-start' | 'center' | 'auto';
}

export function SectionHeader({
  title,
  subtitle,
  rightAction,
  align = 'auto',
}: SectionHeaderProps) {
  const { fontScale } = useWindowDimensions();

  const resolvedAlign: 'flex-start' | 'center' =
    align === 'auto'
      ? subtitle ? 'flex-start' : 'center'
      : align;

  const subtitleMarginTop = Math.max(2, Math.round(2 * Math.min(fontScale, 1.3)));

  return (
    <View
      style={[styles.row, { alignItems: resolvedAlign }]}
      accessibilityRole="header"
    >
      <View style={styles.texts}>
        <AppText
          variant="label"
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText
            style={[styles.subtitle, { marginTop: subtitleMarginTop }]}
            variant="caption"
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {rightAction ? (
        <View style={styles.rightAction}>
          {rightAction}
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    justifyContent: 'space-between',
  },
  texts: {
    flex: 1,
  },
  subtitle: {
  },
  rightAction: {
    flexShrink: 0,
    flexGrow: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
