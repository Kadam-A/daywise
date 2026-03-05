/**
 * StatsCard - Reusable stat display component
 *
 * Shows a single stat with icon, value, and label.
 * Supports different sizes and optional trend indicator.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppColors } from '@/contexts/ThemeContext';

interface StatsCardProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  value: string | number;
  label: string;
  sublabel?: string;
  size?: 'small' | 'medium' | 'large';
  color?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export default function StatsCard({
  icon,
  value,
  label,
  sublabel,
  size = 'medium',
  color,
  trend,
  trendValue,
}: StatsCardProps) {
  const appColors = useAppColors();
  const resolvedColor = color || appColors.gradientStart;

  const sizeStyles = {
    small: {
      card: styles.cardSmall,
      icon: 20,
      iconWrapper: styles.iconWrapperSmall,
      value: styles.valueSmall,
      label: styles.labelSmall,
    },
    medium: {
      card: styles.cardMedium,
      icon: 24,
      iconWrapper: styles.iconWrapperMedium,
      value: styles.valueMedium,
      label: styles.labelMedium,
    },
    large: {
      card: styles.cardLarge,
      icon: 28,
      iconWrapper: styles.iconWrapperLarge,
      value: styles.valueLarge,
      label: styles.labelLarge,
    },
  };

  const currentSize = sizeStyles[size];

  return (
    <Surface style={[styles.card, currentSize.card, { backgroundColor: appColors.surface }]} elevation={1}>
      <View style={[styles.iconWrapper, currentSize.iconWrapper, { backgroundColor: `${resolvedColor}15` }]}>
        <MaterialCommunityIcons name={icon} size={currentSize.icon} color={resolvedColor} />
      </View>

      <Text style={[styles.value, currentSize.value, { color: appColors.textPrimary }]}>{value}</Text>
      <Text style={[styles.label, currentSize.label, { color: appColors.textSecondary }]}>{label}</Text>

      {sublabel && (
        <Text style={[styles.sublabel, { color: appColors.textTertiary }]}>{sublabel}</Text>
      )}

      {trend && trendValue && (
        <View style={styles.trendContainer}>
          <MaterialCommunityIcons
            name={trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'minus'}
            size={14}
            color={trend === 'up' ? appColors.success : trend === 'down' ? appColors.warning : appColors.textTertiary}
          />
          <Text
            style={[
              styles.trendValue,
              {
                color: trend === 'up' ? appColors.success : trend === 'down' ? appColors.warning : appColors.textTertiary,
              },
            ]}
          >
            {trendValue}
          </Text>
        </View>
      )}
    </Surface>
  );
}

/**
 * Grid layout helper for displaying multiple StatsCards
 */
export function StatsGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSmall: {
    padding: 12,
    minWidth: 80,
  },
  cardMedium: {
    padding: 16,
    minWidth: 100,
  },
  cardLarge: {
    padding: 20,
    minWidth: 120,
  },

  iconWrapper: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  iconWrapperSmall: {
    width: 36,
    height: 36,
  },
  iconWrapperMedium: {
    width: 44,
    height: 44,
  },
  iconWrapperLarge: {
    width: 52,
    height: 52,
  },

  value: {
    fontWeight: '700',
    textAlign: 'center',
  },
  valueSmall: {
    fontSize: 20,
    marginBottom: 2,
  },
  valueMedium: {
    fontSize: 26,
    marginBottom: 4,
  },
  valueLarge: {
    fontSize: 32,
    marginBottom: 4,
  },

  label: {
    textAlign: 'center',
  },
  labelSmall: {
    fontSize: 11,
  },
  labelMedium: {
    fontSize: 12,
  },
  labelLarge: {
    fontSize: 14,
  },

  sublabel: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },

  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 2,
  },
  trendValue: {
    fontSize: 11,
    fontWeight: '500',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});
