import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { isOfferableLoadStatus } from '../../../shared/loadStatus';
import Icon from '../../../shared/ui/Icon';
import { AppButton, ListSkeleton, ScreenState, SectionCard } from '../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../shared/ui/theme';
import ActiveJobCard from '../components/driver/ActiveJobCard';
import DeliveryCompletionCard from '../components/driver/DeliveryCompletionCard';
import DriverDashboardHeader from '../components/driver/DriverDashboardHeader';
import DriverJobCard from '../components/driver/DriverJobCard';
import DriverJobSummary from '../components/driver/DriverJobSummary';
import DriverLoadDetails from '../components/driver/DriverLoadDetails';
import DriverOfferCard from '../components/driver/DriverOfferCard';
import DriverOfferForm from '../components/driver/DriverOfferForm';
import DriverRouteSection from '../components/driver/DriverRouteSection';
import DriverStatCards from '../components/driver/DriverStatCards';
import { driverStatusAction, loadStatusLabel, toFiniteNumber } from '../utils/presentation';

const FILTER_OPTIONS = [
  { id: 'all', label: 'Tümü', icon: 'apps-outline' },
  { id: 'nearby', label: 'Yakın (<50 km)', icon: 'navigate-outline' },
  { id: 'today', label: 'Bugün / Acil', icon: 'flash-outline' },
  { id: 'ev_esyasi', label: 'Ev Eşyası', icon: 'home-outline' },
  { id: 'commercial', label: 'Ticari & Palet', icon: 'cube-outline' },
  { id: 'high_price', label: 'Yüksek Fiyat', icon: 'trending-up-outline' },
];

export function DriverJobs({
  loading,
  error,
  jobs = [],
  selected,
  selectedOffer,
  form,
  setForm,
  formErrors,
  setFormErrors,
  saving,
  deliverySaving,
  onOpen,
  onClose,
  onAdjust,
  onSaveOffer,
  onStatus,
  onCompleteDelivery,
  retry,
  onShowOffers,
  myOffers = [],
  user,
}) {
  const [activeFilter, setActiveFilter] = useState('all');

  // Find any active job assigned to this driver
  const activeJob = useMemo(() => {
    const activeStatuses = ['driver_selected', 'driver_en_route', 'at_pickup', 'picked_up', 'en_route_to_delivery', 'delivered'];
    const inJobs = jobs.find(j => activeStatuses.includes(j.status) && (j.assignedDriverId === user?.id || !j.assignedDriverId));
    if (inJobs) return inJobs;
    const acceptedOffer = myOffers.find(o => o.offer?.status === 'accepted' && activeStatuses.includes(o.load?.status));
    if (acceptedOffer?.load) return acceptedOffer.load;
    return null;
  }, [jobs, myOffers, user?.id]);

  // Active pending offers count
  const pendingOffersCount = useMemo(() => {
    return myOffers.filter(o => o.offer?.status === 'pending').length;
  }, [myOffers]);

  // Filter jobs
  const filteredJobs = useMemo(() => {
    let list = [...jobs];
    list = list.filter(j => !['completed', 'cancelled', 'draft'].includes(j.status));

    switch (activeFilter) {
      case 'nearby':
        return list.filter(j => toFiniteNumber(j.estimatedKm, toFiniteNumber(j.routeDistanceMeters) / 1000) <= 50);
      case 'today':
        return list.filter(j => j.urgencyType === 'immediate' || j.urgencyType === 'today');
      case 'ev_esyasi':
        return list.filter(j => ['ev_esyasi', 'mobilya', 'beyaz_esya'].includes(j.cargoType));
      case 'commercial':
        return list.filter(j => ['ticari_yuk', 'paletli_yuk', 'parsiyel_yuk'].includes(j.cargoType));
      case 'high_price':
        return list.sort((a, b) => {
          const priceA = toFiniteNumber(a.pricing?.recommendedPrice || a.basePriceTl || a.agreedPriceTl);
          const priceB = toFiniteNumber(b.pricing?.recommendedPrice || b.basePriceTl || b.agreedPriceTl);
          return priceB - priceA;
        });
      default:
        return list;
    }
  }, [jobs, activeFilter]);

  // If a job is selected for detail view
  if (selected) {
    const statusAction = driverStatusAction(selected.status);
    const isAssigned = selected.assignedDriverId === user?.id || (statusAction && selected.status !== 'published');

    return (
      <View style={styles.detailContainer}>
        <AppButton
          label="İşlere dön"
          icon="arrow-back"
          variant="ghost"
          compact
          fullWidth={false}
          onPress={onClose}
          style={styles.backButton}
        />

        <DriverJobSummary load={selected} />

        <DriverRouteSection load={selected} />

        <DriverLoadDetails load={selected} />

        {/* Operation Action or Offer Form */}
        {isAssigned && statusAction?.nextStatus === 'completed' ? (
          <DeliveryCompletionCard
            load={selected}
            saving={deliverySaving}
            onComplete={onCompleteDelivery}
          />
        ) : isAssigned && statusAction ? (
          <SectionCard
            title="Operasyon Adımı"
            description="Sıradaki operasyon adımını onaylayarak süreci ilerletin."
            icon="navigate-circle-outline"
          >
            <AppButton
              label={statusAction.label}
              icon={statusAction.icon}
              onPress={() => onStatus(selected, statusAction.nextStatus)}
              style={styles.primaryActionBtn}
            />
          </SectionCard>
        ) : isOfferableLoadStatus(selected.status) ? (
          <DriverOfferForm
            form={form}
            setForm={setForm}
            formErrors={formErrors}
            setFormErrors={setFormErrors}
            onAdjust={onAdjust}
            saving={saving}
            onSaveOffer={onSaveOffer}
            isEdit={Boolean(selectedOffer)}
          />
        ) : (
          <SectionCard
            title="Operasyon Durumu"
            description={loadStatusLabel(selected.status)}
            icon="information-circle-outline"
          />
        )}
      </View>
    );
  }

  return (
    <>
      {/* Welcome Greeting */}
      <DriverDashboardHeader user={user} />

      {/* 3 Compact Stat Cards */}
      <DriverStatCards
        jobsCount={jobs.length}
        activeOffersCount={pendingOffersCount}
        activeJobsCount={activeJob ? 1 : 0}
        onOffersPress={onShowOffers}
        onActiveJobPress={() => activeJob && onOpen(activeJob)}
      />

      {/* Active Job Card if assigned */}
      {activeJob ? (
        <ActiveJobCard
          load={activeJob}
          onPress={onOpen}
          onAction={onStatus}
        />
      ) : null}

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Yakındaki İşler</Text>
        <Text style={styles.sectionSubtitle}>Teklif verebileceğiniz uygun taşıma talepleri</Text>
      </View>

      {/* Horizontal Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        {FILTER_OPTIONS.map(opt => {
          const isSelected = activeFilter === opt.id;
          return (
            <Pressable
              key={opt.id}
              accessibilityRole="button"
              onPress={() => setActiveFilter(opt.id)}
              style={[styles.filterChip, isSelected && styles.filterChipSelected]}
            >
              <Icon
                name={opt.icon}
                size={13}
                color={isSelected ? colors.primaryDark : colors.textSecondary}
              />
              <Text style={[styles.filterText, isSelected && styles.filterTextSelected]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Job List */}
      {loading && !jobs.length ? (
        <ListSkeleton count={3} />
      ) : error ? (
        <ScreenState type="error" title="İşler yüklenemedi" message={error} onRetry={retry} />
      ) : !filteredJobs.length ? (
        <ScreenState
          title="Uygun ilan bulunamadı"
          message={
            activeFilter !== 'all'
              ? 'Seçtiğiniz filtreye uygun ilan bulunmuyor. Farklı bir filtre deneyebilirsiniz.'
              : 'Yeni yayınlanan uygun yükler burada görüntülenecektir.'
          }
        />
      ) : (
        filteredJobs.map(load => (
          <DriverJobCard
            key={load.id}
            load={load}
            onPress={() => onOpen(load)}
          />
        ))
      )}
    </>
  );
}

export function DriverOffers({ loading, error, items = [], onOpen, onWithdraw, retry }) {
  const validItems = items.filter(item => item?.offer && item?.load);

  return (
    <>
      <View style={styles.offersHeader}>
        <Text style={styles.sectionTitle}>Tekliflerim</Text>
        <Text style={styles.sectionSubtitle}>
          Gönderdiğiniz tekliflerin durumunu takip edin ve bekleyenleri düzenleyin.
        </Text>
      </View>

      {loading && !validItems.length ? (
        <ListSkeleton count={3} />
      ) : error ? (
        <ScreenState type="error" title="Teklifler yüklenemedi" message={error} onRetry={retry} />
      ) : !validItems.length ? (
        <ScreenState
          title="Henüz teklifiniz yok"
          message="Yakındaki işlerden birine teklif verdiğinizde durumunu buradan takip edebilirsiniz."
        />
      ) : (
        validItems.map(item => (
          <DriverOfferCard
            key={item.offer.id}
            item={item}
            onOpen={onOpen}
            onWithdraw={onWithdraw}
          />
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  filterScroll: {
    gap: 6,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
    paddingVertical: 2,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: '#E2E8F0',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    ...shadows.card,
  },
  filterChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  filterText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  filterTextSelected: {
    color: colors.primaryDark,
    fontWeight: '800',
  },
  detailContainer: {
    paddingBottom: spacing.md,
  },
  backButton: {
    marginBottom: spacing.sm,
    marginLeft: -spacing.sm,
  },
  primaryActionBtn: {
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  offersHeader: {
    marginBottom: spacing.md,
    paddingHorizontal: 2,
  },
});
