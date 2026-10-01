import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../../shared/ui/theme';

export default function DriverDashboardHeader({ user }) {
  const firstName = user?.name ? user.name.split(' ')[0] : 'Şoför';

  return (
    <View style={styles.container}>
      <View style={styles.textWrap}>
        <Text style={styles.greeting}>Merhaba, {firstName}</Text>
        <Text style={styles.subtitle}>
          Yakındaki uygun işleri ve aktif taşımanı buradan yönetebilirsin.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
    paddingTop: spacing.xs,
  },
  textWrap: {
    flexDirection: 'column',
  },
  greeting: {
    ...typography.h1,
    color: colors.ink,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  subtitle: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 3,
  },
});
