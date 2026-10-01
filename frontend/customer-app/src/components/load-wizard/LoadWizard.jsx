import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Icon from '../../../../shared/ui/Icon';
import { AppButton } from '../../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';
import CargoTypeStep from './CargoTypeStep';
import CargoDetailsStep from './CargoDetailsStep';
import RouteStep from './RouteStep';
import ScheduleStep from './ScheduleStep';
import MediaStep from './MediaStep';
import ReviewStep from './ReviewStep';

const { validateStep } = require('../../utils/loadForm.cjs');

const STEP_TITLES = [
  'Yük Türü',
  'Yük Detayları',
  'Güzergah',
  'Zamanlama',
  'Fotoğraf & Tercihler',
  'Özet & Onay',
];

const TOTAL_STEPS = 6;

export default function LoadWizard({
  visible = true,
  form,
  setForm,
  routeDraft,
  onLocationsChange,
  onRouteChange,
  photos,
  setPhotos,
  onPublish,
  onClose,
  saving = false,
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [stepErrors, setStepErrors] = useState({});
  const scrollViewRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setCurrentStep(1);
      setStepErrors({});
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible]);

  useEffect(() => {
    if (visible && currentStep > 1 && !form?.cargoType) {
      setCurrentStep(1);
      setStepErrors({});
    }
  }, [visible, currentStep, form?.cargoType]);

  const handleFormChange = (field, value) => {
    setForm(current => ({ ...current, [field]: value }));
    setStepErrors(current => ({ ...current, [field]: '' }));
  };

  const handleDetailChange = (key, value) => {
    setForm(current => ({
      ...current,
      cargoDetails: {
        ...(current.cargoDetails || {}),
        [key]: value,
      },
    }));
    setStepErrors(current => ({ ...current, [key]: '' }));
  };

  const handleLocationsChangeInternal = useCallback(locationState => {
    if (onLocationsChange) {
      onLocationsChange(locationState);
    }
    setStepErrors(current => {
      if (!current.route && !current.pickup && !current.dropoff) return current;
      return { ...current, route: '', pickup: '', dropoff: '' };
    });
  }, [onLocationsChange]);

  const handleRouteDraftChangeInternal = useCallback(nextDraft => {
    if (onLocationsChange) {
      onLocationsChange({
        pickup: nextDraft?.pickup,
        dropoff: nextDraft?.dropoff,
        stops: nextDraft?.stops,
      });
    }
    if (onRouteChange && nextDraft?.route !== undefined) {
      onRouteChange(nextDraft.route);
    }
    setStepErrors(current => {
      if (!current.route && !current.pickup && !current.dropoff) return current;
      return { ...current, route: '', pickup: '', dropoff: '' };
    });
  }, [onLocationsChange, onRouteChange]);

  const scrollToTop = () => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleNext = () => {
    const draft = {
      form,
      routeDraft,
      ...form,
      pickup: routeDraft?.pickup,
      dropoff: routeDraft?.dropoff,
      stops: routeDraft?.stops || [],
      route: routeDraft?.route,
    };

    const errors = validateStep(currentStep, draft);
    if (errors && Object.keys(errors).length > 0) {
      setStepErrors(errors);
      scrollToTop();
      return;
    }

    setStepErrors({});
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(step => step + 1);
      scrollToTop();
    }
  };

  const handleBack = () => {
    setStepErrors({});
    if (currentStep > 1) {
      setCurrentStep(step => step - 1);
      scrollToTop();
    } else if (onClose) {
      onClose();
    }
  };

  const handleJumpToStep = targetStep => {
    if (targetStep >= 1 && targetStep <= TOTAL_STEPS) {
      setStepErrors({});
      setCurrentStep(targetStep);
      scrollToTop();
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <CargoTypeStep
            form={form}
            onChange={handleFormChange}
            errors={stepErrors}
          />
        );
      case 2:
        return (
          <CargoDetailsStep
            form={form}
            onFormChange={handleFormChange}
            onDetailChange={handleDetailChange}
            onChange={handleFormChange}
            errors={stepErrors}
          />
        );
      case 3:
        return (
          <RouteStep
            value={routeDraft}
            routeDraft={routeDraft}
            onLocationsChange={handleLocationsChangeInternal}
            onRouteChange={onRouteChange}
            onRouteDraftChange={handleRouteDraftChangeInternal}
            errors={stepErrors}
          />
        );
      case 4:
        return (
          <ScheduleStep
            form={form}
            onChange={handleFormChange}
            errors={stepErrors}
          />
        );
      case 5:
        return (
          <MediaStep
            form={form}
            onChange={handleFormChange}
            photos={photos}
            setPhotos={setPhotos}
            errors={stepErrors}
          />
        );
      case 6:
        return (
          <ReviewStep
            form={form}
            routeDraft={routeDraft}
            photos={photos}
            onJumpToStep={handleJumpToStep}
            onPublish={onPublish}
            saving={saving}
            errors={stepErrors}
          />
        );
      default:
        return null;
    }
  };

  if (!visible) return null;

  const progressPercent = (currentStep / TOTAL_STEPS) * 100;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleBack}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Wizard Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={currentStep === 1 ? 'Kapat' : 'Geri'}
            onPress={handleBack}
            style={styles.headerIconButton}
          >
            <Icon
              name={currentStep === 1 ? 'close' : 'arrow-back'}
              size={24}
              color={colors.ink}
            />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.headerStepText}>
              Adım {currentStep} / {TOTAL_STEPS}
            </Text>
            <Text style={styles.headerTitleText}>
              {STEP_TITLES[currentStep - 1]}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            onPress={onClose}
            style={styles.headerIconButton}
          >
            {currentStep > 1 ? (
              <Icon name="close" size={22} color={colors.textSecondary} />
            ) : (
              <View style={styles.headerIconSpacer} />
            )}
          </Pressable>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
        </View>

        {/* Step Content */}
        <KeyboardAvoidingView
          style={styles.keyboardContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 44 : 0}
        >
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderStepContent()}
          </ScrollView>

          {/* Bottom Action Bar (Steps 1 to 5) */}
          {currentStep < TOTAL_STEPS && (
            <View style={styles.bottomBar}>
              {currentStep > 1 ? (
                <AppButton
                  label="Geri"
                  variant="secondary"
                  onPress={handleBack}
                  style={styles.backButton}
                />
              ) : null}

              <AppButton
                label="Devam Et"
                icon="arrow-forward"
                onPress={handleNext}
                style={[styles.nextButton, currentStep === 1 && styles.fullWidthButton]}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 56,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  headerIconButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerIconSpacer: {
    width: 40,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
  },
  headerStepText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  headerTitleText: {
    ...typography.h4,
    color: colors.ink,
  },
  progressBarContainer: {
    backgroundColor: colors.border,
    height: 4,
    width: '100%',
  },
  progressBarFill: {
    backgroundColor: colors.primary,
    height: '100%',
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.card,
  },
  backButton: {
    flex: 1,
  },
  nextButton: {
    flex: 2,
  },
  fullWidthButton: {
    flex: 1,
  },
});
