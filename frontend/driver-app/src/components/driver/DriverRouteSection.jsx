import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import Icon from '../../../../shared/ui/Icon';
import { RouteTimeline } from '../../../../shared/ui/listing';
import { AppButton } from '../../../../shared/ui/primitives';
import { colors, radius, spacing, typography } from '../../../../shared/ui/theme';
import { toFiniteNumber } from '../../utils/presentation';
import DriverRouteMap from '../DriverRouteMap';

export default function DriverRouteSection({ load }) {
  const [showMap, setShowMap] = useState(false);

  if (!load) return null;

  const distanceKm = toFiniteNumber(load.estimatedKm, toFiniteNumber(load.routeDistanceMeters) / 1000);
  const durationMins = Math.round(toFiniteNumber(load.routeDurationSeconds) / 60);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Icon name="navigate-outline" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Rota</Text>
            {distanceKm > 0 ? (
              <Text style={styles.headerSubtitle}>
                {distanceKm.toFixed(1)} km{durationMins > 0 ? ` · Yaklaşık ${durationMins} dk` : ''}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.timelineContainer}>
        <RouteTimeline
          pickup={load.pickup?.address}
          delivery={load.delivery?.address}
          stops={load.stops}
        />
      </View>

      <View style={styles.mapToggleRow}>
        <AppButton
          label={showMap ? 'Haritayı Gizle' : 'Rotayı Haritada Gör'}
          icon={showMap ? 'map' : 'map-outline'}
          variant="secondary"
          compact
          onPress={() => setShowMap(prev => !prev)}
        />
      </View>

      {showMap ? (
        <View style={styles.mapWrapper}>
          <DriverRouteMap load={load} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: '#E2E8F0',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.ink,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  timelineContainer: {
    marginTop: spacing.xs,
  },
  mapToggleRow: {
    marginTop: spacing.md,
  },
  mapWrapper: {
    marginTop: spacing.md,
  },
});
