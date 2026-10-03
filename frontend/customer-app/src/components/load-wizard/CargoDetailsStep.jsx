import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '../../../../shared/ui/Icon';
import { SectionCard, SegmentedControl, TextField } from '../../../../shared/ui/primitives';
import { colors, radius, shadows, spacing, typography } from '../../../../shared/ui/theme';

const HOME_SIZE_OPTIONS = [
  { value: '1+0', label: '1+0' },
  { value: '1+1', label: '1+1' },
  { value: '2+1', label: '2+1' },
  { value: '3+1', label: '3+1' },
  { value: '4+1', label: '4+1' },
  { value: '5+1+', label: '5+1+' },
  { value: 'diger', label: 'Diğer' },
];

const MOTORCYCLE_TYPES = [
  'Scooter', 'Touring', 'Enduro / Cross', 'Chopper / Cruiser', 'Spor / Racing', 'Diğer',
];

const PALLET_SIZES = [
  { value: 'euro', label: 'Euro (80×120 cm)' },
  { value: 'industrial', label: 'Endüstriyel (100×120 cm)' },
  { value: 'custom', label: 'Özel Ölçü' },
];

const FURNITURE_CATALOG = [
  'Koltuk', 'Kanepe', 'Yatak', 'Baza', 'Dolap', 'Masa', 'Sandalye', 'TV Ünitesi', 'Diğer',
];

const APPLIANCE_CATALOG = [
  'Buzdolabı', 'Çamaşır Makinesi', 'Bulaşık Makinesi', 'Kurutma Makinesi', 'Fırın', 'Derin Dondurucu', 'Televizyon', 'Diğer',
];

const yesNoOptions = [
  { value: true, label: 'Evet', icon: 'checkmark-circle-outline' },
  { value: false, label: 'Hayır', icon: 'close-circle-outline' },
];

const responsibilityOptions = [
  { value: 'customer', label: 'Müşteri', icon: 'person-outline' },
  { value: 'driver', label: 'Şoför / Ekip', icon: 'car-outline' },
];

const helperOptions = [
  { value: false, label: 'Gerekmiyor', icon: 'person-outline' },
  { value: true, label: 'Gerekli', icon: 'people-outline' },
];

function ItemCounterGrid({ catalog = [], selectedItems = [], onChange }) {
  const getItemCount = name => {
    const found = selectedItems.find(i => i.name === name);
    return found ? found.count : 0;
  };

  const updateCount = (name, delta) => {
    const current = getItemCount(name);
    const nextCount = Math.max(0, current + delta);
    let nextItems;
    if (nextCount === 0) {
      nextItems = selectedItems.filter(i => i.name !== name);
    } else if (current === 0) {
      nextItems = [...selectedItems, { name, count: nextCount }];
    } else {
      nextItems = selectedItems.map(i => i.name === name ? { ...i, count: nextCount } : i);
    }
    onChange(nextItems);
  };

  return (
    <View style={styles.counterGrid}>
      {catalog.map(name => {
        const count = getItemCount(name);
        const isSelected = count > 0;
        return (
          <View key={name} style={[styles.counterItem, isSelected && styles.counterItemSelected]}>
            <Text style={[styles.counterItemName, isSelected && styles.counterItemNameSelected]}>
              {name}
            </Text>
            <View style={styles.counterControls}>
              {count > 0 ? (
                <>
                  <Pressable
                    style={styles.counterBtn}
                    onPress={() => updateCount(name, -1)}
                    hitSlop={6}
                    accessibilityLabel={`${name} azalt`}
                  >
                    <Icon name="remove" size={16} color={colors.primary} />
                  </Pressable>
                  <Text style={styles.counterValue}>{count}</Text>
                </>
              ) : null}
              <Pressable
                style={[styles.counterBtn, count === 0 && styles.counterBtnAdd]}
                onPress={() => updateCount(name, 1)}
                hitSlop={6}
                accessibilityLabel={`${name} artır`}
              >
                <Icon name="add" size={16} color={count === 0 ? colors.textSecondary : colors.primary} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function PhysicalAccessSection({ form, onFormChange, cargoDetails = {}, onDetailChange, errors = {} }) {
  return (
    <SectionCard
      title="Bina Erişim ve Kat Bilgileri"
      description="Taşıma sürecinin aksamaması için kat ve asansör durumunu belirtin."
      icon="business-outline"
    >
      <View style={styles.fieldRow}>
        <TextField
          containerStyle={styles.flexField}
          label="Çıkış Katı"
          required
          value={form.pickupFloor !== undefined ? String(form.pickupFloor) : '0'}
          onChangeText={v => onFormChange('pickupFloor', v)}
          placeholder="0 (Giriş), 1, 2..."
          keyboardType="numbers-and-punctuation"
          leftIcon="arrow-up-circle-outline"
          error={errors.pickupFloor}
        />
        <TextField
          containerStyle={styles.flexField}
          label="Varış Katı"
          required
          value={form.deliveryFloor !== undefined ? String(form.deliveryFloor) : '0'}
          onChangeText={v => onFormChange('deliveryFloor', v)}
          placeholder="0 (Giriş), 1, 2..."
          keyboardType="numbers-and-punctuation"
          leftIcon="arrow-down-circle-outline"
          error={errors.deliveryFloor}
        />
      </View>

      <SegmentedControl
        label="Çıkış binasında asansör var mı?"
        options={yesNoOptions}
        value={form.pickupElevatorAvailable}
        onChange={v => onFormChange('pickupElevatorAvailable', v)}
      />
      {form.pickupElevatorAvailable ? (
        <SegmentedControl
          label="Çıkış asansörü eşya taşımaya uygun mu?"
          options={yesNoOptions}
          value={cargoDetails.pickupElevatorSuitable ?? true}
          onChange={v => onDetailChange('pickupElevatorSuitable', v)}
        />
      ) : null}

      <SegmentedControl
        label="Varış binasında asansör var mı?"
        options={yesNoOptions}
        value={form.deliveryElevatorAvailable}
        onChange={v => onFormChange('deliveryElevatorAvailable', v)}
      />
      {form.deliveryElevatorAvailable ? (
        <SegmentedControl
          label="Varış asansörü eşya taşımaya uygun mu?"
          options={yesNoOptions}
          value={cargoDetails.deliveryElevatorSuitable ?? true}
          onChange={v => onDetailChange('deliveryElevatorSuitable', v)}
        />
      ) : null}

      <SegmentedControl
        label="Yardımcı personel / Hamal gerekiyor mu?"
        options={helperOptions}
        value={form.helperNeeded}
        onChange={v => onFormChange('helperNeeded', v)}
      />
      {form.helperNeeded ? (
        <TextField
          label="İhtiyaç Duyulan Personel Sayısı"
          required
          value={String(form.helperCount || '1')}
          onChangeText={v => onFormChange('helperCount', v)}
          keyboardType="number-pad"
          leftIcon="people-outline"
          error={errors.helperCount}
        />
      ) : null}
    </SectionCard>
  );
}

export default function CargoDetailsStep({ form, onFormChange, onDetailChange, onChange, errors = {} }) {
  const cargoType = form.cargoType || 'diger';
  const cargoDetails = form.cargoDetails || {};
  const formChange = onFormChange || onChange || (() => {});
  const detailChange = onDetailChange || ((k, v) => {
    if (onChange) onChange('cargoDetails', { ...(form.cargoDetails || {}), [k]: v });
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Yük Detayları</Text>
      <Text style={styles.subtitle}>Taşıma ekibinin hazırlıklı gelmesi için operasyonel detayları belirleyin.</Text>

      <SectionCard title="Taşıma Bilgileri" description="Eşya türü ve adedinden araç ihtiyacı yaklaşık belirlenir. Ölçü veya hacim hesaplamanız gerekmez; son fiyat şoför teklifleriyle netleşir." icon="cube-outline">
        {['ticari_yuk', 'parsiyel_yuk', 'diger'].includes(cargoType) || (cargoType === 'ev_esyasi' && cargoDetails.moveType === 'parca') ? (
          <SegmentedControl columns={1} label="Yaklaşık ne kadar eşya taşınacak?" options={[
            { value: 'small', label: 'Birkaç koli / küçük eşya' },
            { value: 'medium', label: 'Birkaç büyük eşya' },
            { value: 'large', label: 'Çok sayıda büyük eşya' },
            { value: 'unknown', label: 'Emin değilim' },
          ]} value={cargoDetails.loadSize || 'unknown'} onChange={v => detailChange('loadSize', v)} />
        ) : null}
        <SegmentedControl label="Yüklemeyi kim yapacak?" options={responsibilityOptions} value={cargoDetails.loadingResponsibility || (form.helperNeeded ? 'driver' : 'customer')} onChange={v => detailChange('loadingResponsibility', v)} />
        <SegmentedControl label="Boşaltmayı kim yapacak?" options={responsibilityOptions} value={cargoDetails.unloadingResponsibility || (form.helperNeeded ? 'driver' : 'customer')} onChange={v => detailChange('unloadingResponsibility', v)} />
        {!['ev_esyasi', 'mobilya', 'beyaz_esya'].includes(cargoType) ? <>
          <SegmentedControl label="Yardımcı personel gerekiyor mu?" options={helperOptions} value={form.helperNeeded} onChange={v => formChange('helperNeeded', v)} />
          {form.helperNeeded ? <TextField label="Yardımcı sayısı" value={String(form.helperCount || '1')} onChangeText={v => formChange('helperCount', v)} keyboardType="number-pad" error={errors.helperCount} /> : null}
        </> : null}
      </SectionCard>

      {/* EV EŞYASI */}
      {cargoType === 'ev_esyasi' && (
        <>
          <SectionCard title="Taşıma Kapsamı" icon="home-outline">
            <SegmentedControl
              label="Taşıma Tipi"
              options={[
                { value: 'komple', label: 'Komple Ev Taşıma', icon: 'home-outline' },
                { value: 'parca', label: 'Parça Eşya', icon: 'cube-outline' },
              ]}
              value={cargoDetails.moveType || 'komple'}
              onChange={v => onDetailChange('moveType', v)}
              error={errors.moveType}
            />

            {(cargoDetails.moveType || 'komple') === 'komple' ? (
              <View style={styles.choiceGroup}>
                <Text style={styles.choiceLabel}>Ev Büyüklüğü</Text>
                <View style={styles.chipsRow}>
                  {HOME_SIZE_OPTIONS.map(opt => {
                    const isSelected = cargoDetails.homeSize === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => onDetailChange('homeSize', opt.value)}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {errors.homeSize ? <Text style={styles.errorText}>{errors.homeSize}</Text> : null}
              </View>
            ) : (
              <TextField
                label="Taşınacak Eşyalar"
                required
                multiline
                numberOfLines={3}
                value={cargoDetails.itemSummary || ''}
                onChangeText={v => onDetailChange('itemSummary', v)}
                placeholder="Örn. 1 koltuk takımı, 1 buzdolabı, 5 koli..."
                error={errors.itemSummary}
              />
            )}
          </SectionCard>

          <SectionCard title="Ek Hizmetler" description="İhtiyaç duyduğunuz özel hizmetleri seçin." icon="construct-outline">
            <SegmentedControl
              label="Paketleme & Ambalajlama hizmeti gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.packingRequired)}
              onChange={v => onDetailChange('packingRequired', v)}
            />
            <SegmentedControl
              label="Mobilya söküm (demontaj) gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.disassemblyRequired)}
              onChange={v => onDetailChange('disassemblyRequired', v)}
            />
            <SegmentedControl
              label="Mobilya montaj / kurulum gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.assemblyRequired)}
              onChange={v => onDetailChange('assemblyRequired', v)}
            />
            <SegmentedControl
              label="Dış cephe mobil taşıma asansörü gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.exteriorLiftRequired)}
              onChange={v => onDetailChange('exteriorLiftRequired', v)}
            />
            <SegmentedControl
              label="Ağır veya özel eşya var mı? (Piyano, para kasası vb.)"
              options={yesNoOptions}
              value={Boolean(cargoDetails.hasSpecialItems)}
              onChange={v => onDetailChange('hasSpecialItems', v)}
            />
            {cargoDetails.hasSpecialItems ? (
              <TextField
                label="Özel Eşya Detayı"
                required
                value={cargoDetails.specialItemsDescription || ''}
                onChangeText={v => onDetailChange('specialItemsDescription', v)}
                placeholder="Örn: 200 kg duvar tipi para kasası, akustik piyano"
                error={errors.specialItemsDescription}
              />
            ) : null}
          </SectionCard>

          <PhysicalAccessSection
            form={form}
            onFormChange={onFormChange}
            cargoDetails={cargoDetails}
            onDetailChange={onDetailChange}
            errors={errors}
          />
        </>
      )}

      {/* MOBİLYA */}
      {cargoType === 'mobilya' && (
        <>
          <SectionCard title="Mobilya Seçimi" description="Taşınacak mobilyaları ve adetlerini belirleyin." icon="bed-outline">
            <ItemCounterGrid
              catalog={FURNITURE_CATALOG}
              selectedItems={cargoDetails.items || []}
              onChange={items => onDetailChange('items', items)}
            />
            {errors.furnitureItems ? <Text style={styles.errorText}>{errors.furnitureItems}</Text> : null}

            <SegmentedControl
              label="Mobilyaların sökülmesi (demontaj) gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.disassemblyRequired)}
              onChange={v => onDetailChange('disassemblyRequired', v)}
            />
            <SegmentedControl
              label="Mobilyaların montajı gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.assemblyRequired)}
              onChange={v => onDetailChange('assemblyRequired', v)}
            />
          </SectionCard>

          <PhysicalAccessSection
            form={form}
            onFormChange={onFormChange}
            cargoDetails={cargoDetails}
            onDetailChange={onDetailChange}
            errors={errors}
          />
        </>
      )}

      {/* BEYAZ EŞYA */}
      {cargoType === 'beyaz_esya' && (
        <>
          <SectionCard title="Beyaz Eşya Seçimi" description="Taşınacak cihazları ve adetlerini seçin." icon="tv-outline">
            <ItemCounterGrid
              catalog={APPLIANCE_CATALOG}
              selectedItems={cargoDetails.items || []}
              onChange={items => onDetailChange('items', items)}
            />
            {errors.applianceItems ? <Text style={styles.errorText}>{errors.applianceItems}</Text> : null}

            <SegmentedControl
              label="Cihazların tesisattan sökülmesi gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.disassemblyRequired)}
              onChange={v => onDetailChange('disassemblyRequired', v)}
            />
            <SegmentedControl
              label="Varış yerinde kurulum / bağlantı gerekiyor mu?"
              options={yesNoOptions}
              value={Boolean(cargoDetails.assemblyRequired)}
              onChange={v => onDetailChange('assemblyRequired', v)}
            />
          </SectionCard>

          <PhysicalAccessSection
            form={form}
            onFormChange={onFormChange}
            cargoDetails={cargoDetails}
            onDetailChange={onDetailChange}
            errors={errors}
          />
        </>
      )}

      {/* MOTOSİKLET */}
      {cargoType === 'motosiklet' && (
        <SectionCard title="Motosiklet Detayları" description="Güvenli taşıma için motor bilgilerini girin." icon="bicycle-outline">
          <View style={styles.choiceGroup}>
            <Text style={styles.choiceLabel}>Motosiklet Türü</Text>
            <View style={styles.chipsRow}>
              {MOTORCYCLE_TYPES.map(type => {
                const isSelected = cargoDetails.motorcycleType === type;
                return (
                  <Pressable
                    key={type}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => onDetailChange('motorcycleType', type)}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {errors.motorcycleType ? <Text style={styles.errorText}>{errors.motorcycleType}</Text> : null}
          </View>

          <TextField
            label="Marka & Model (İsteğe bağlı)"
            value={cargoDetails.motorcycleModel || ''}
            onChangeText={v => onDetailChange('motorcycleModel', v)}
            placeholder="Örn: Honda Forza 250, Yamaha MT-07"
            leftIcon="speedometer-outline"
          />

          <TextField
            label="Tahmini Ağırlık (kg)"
            value={form.weight !== undefined ? String(form.weight) : ''}
            onChangeText={v => onFormChange('weight', v)}
            placeholder="Örn: 180"
            keyboardType="decimal-pad"
            leftIcon="barbell-outline"
          />

          <SegmentedControl
            label="Motosiklet çalışır / yürür durumda mı?"
            options={yesNoOptions}
            value={cargoDetails.motorcycleRunning ?? true}
            onChange={v => onDetailChange('motorcycleRunning', v)}
          />
          <SegmentedControl
            label="Araca yükleme için rampa gerekiyor mu?"
            options={yesNoOptions}
            value={cargoDetails.rampRequired ?? true}
            onChange={v => onDetailChange('rampRequired', v)}
          />
          <SegmentedControl
            label="Özel bağlama / sabitleme ekipmanı gerekiyor mu?"
            options={yesNoOptions}
            value={cargoDetails.specialFixingRequired ?? true}
            onChange={v => onDetailChange('specialFixingRequired', v)}
          />
        </SectionCard>
      )}

      {/* PALETLİ YÜK */}
      {cargoType === 'paletli_yuk' && (
        <SectionCard title="Palet Bilgileri" description="Endüstriyel paletleme ve ekipman detayları." icon="layers-outline">
          <TextField
            label="Palet Sayısı"
            required
            value={cargoDetails.palletCount !== undefined ? String(cargoDetails.palletCount) : ''}
            onChangeText={v => onDetailChange('palletCount', v)}
            placeholder="Örn: 4"
            keyboardType="number-pad"
            leftIcon="layers-outline"
            error={errors.palletCount}
          />

          <TextField
            label="Toplam Ağırlık (kg)"
            value={form.weight !== undefined ? String(form.weight) : ''}
            onChangeText={v => onFormChange('weight', v)}
            placeholder="Örn: 1200"
            keyboardType="decimal-pad"
            leftIcon="barbell-outline"
          />

          <View style={styles.choiceGroup}>
            <Text style={styles.choiceLabel}>Palet Ölçüsü</Text>
            <View style={styles.chipsRow}>
              {PALLET_SIZES.map(opt => {
                const isSelected = (cargoDetails.palletSize || 'euro') === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => onDetailChange('palletSize', opt.value)}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <SegmentedControl
            label="Yükleme noktasında forklift var mı?"
            options={yesNoOptions}
            value={Boolean(cargoDetails.forkliftPickup)}
            onChange={v => onDetailChange('forkliftPickup', v)}
          />
          <SegmentedControl
            label="İndirme noktasında forklift var mı?"
            options={yesNoOptions}
            value={Boolean(cargoDetails.forkliftDelivery)}
            onChange={v => onDetailChange('forkliftDelivery', v)}
          />
          <SegmentedControl
            label="Paletler üst üste istiflenebilir mi?"
            options={yesNoOptions}
            value={Boolean(cargoDetails.stackable)}
            onChange={v => onDetailChange('stackable', v)}
          />
        </SectionCard>
      )}

      {/* TİCARİ YÜK */}
      {cargoType === 'ticari_yuk' && (
        <SectionCard title="Ticari Yük Detayları" description="Ticari ve kurumsal sevkiyat bilgileri." icon="business-outline">
          <TextField
            label="Ürün / Yük Türü"
            required
            value={cargoDetails.commercialType || ''}
            onChangeText={v => onDetailChange('commercialType', v)}
            placeholder="Örn: Tekstil kolileri, yedek parça, inşaat malzemesi"
            leftIcon="cube-outline"
            error={errors.commercialType}
          />

          <View style={styles.fieldRow}>
            <TextField
              containerStyle={styles.flexField}
              label="Koli / Adet Sayısı"
              value={cargoDetails.pieceCount !== undefined ? String(cargoDetails.pieceCount) : ''}
              onChangeText={v => onDetailChange('pieceCount', v)}
              placeholder="Örn: 25"
              keyboardType="number-pad"
            />
            <TextField
              containerStyle={styles.flexField}
              label="Toplam Ağırlık (kg)"
              value={form.weight !== undefined ? String(form.weight) : ''}
              onChangeText={v => onFormChange('weight', v)}
              placeholder="Örn: 350"
              keyboardType="decimal-pad"
              leftIcon="barbell-outline"
            />
          </View>

          <SegmentedControl
            label="Forklift gerekiyor mu?"
            options={yesNoOptions}
            value={Boolean(cargoDetails.forkliftNeeded)}
            onChange={v => onDetailChange('forkliftNeeded', v)}
          />
        </SectionCard>
      )}

      {/* PARSİYEL YÜK */}
      {cargoType === 'parsiyel_yuk' && (
        <SectionCard title="Parsiyel Yük Bilgileri" description="Parça yük ve koli sevkiyatı." icon="cube-outline">
          <View style={styles.fieldRow}>
            <TextField
              containerStyle={styles.flexField}
              label="Parça / Koli Sayısı"
              required
              value={cargoDetails.pieceCount !== undefined ? String(cargoDetails.pieceCount) : ''}
              onChangeText={v => onDetailChange('pieceCount', v)}
              placeholder="Örn: 3"
              keyboardType="number-pad"
              error={errors.pieceCount}
            />
            <TextField
              containerStyle={styles.flexField}
              label="Toplam Ağırlık (kg)"
              value={form.weight !== undefined ? String(form.weight) : ''}
              onChangeText={v => onFormChange('weight', v)}
              placeholder="Örn: 80"
              keyboardType="decimal-pad"
              leftIcon="barbell-outline"
            />
          </View>

          <SegmentedControl
            label="Yük hassas / kırılabilir mi?"
            options={yesNoOptions}
            value={Boolean(cargoDetails.fragile)}
            onChange={v => onDetailChange('fragile', v)}
          />
          <SegmentedControl
            label="Üzerine başka yük konabilir mi?"
            options={yesNoOptions}
            value={cargoDetails.stackable ?? true}
            onChange={v => onDetailChange('stackable', v)}
          />
        </SectionCard>
      )}

      {/* DİĞER */}
      {cargoType === 'diger' && (
        <SectionCard title="Yük Özellikleri" description="Taşınacak yük hakkında detayları girin." icon="ellipsis-horizontal-circle-outline">
          <TextField
            label="Yük Detay Açıklaması"
            required
            multiline
            numberOfLines={4}
            value={form.description || ''}
            onChangeText={v => onFormChange('description', v)}
            placeholder="Yükün boyutları, ağırlığı, özel taşıma hassasiyetleri..."
            error={errors.description || errors.cargoTypeNote}
          />
          <View style={styles.fieldRow}>
            <TextField
              containerStyle={styles.flexField}
              label="Tahmini Ağırlık (kg)"
              value={form.weight !== undefined ? String(form.weight) : ''}
              onChangeText={v => onFormChange('weight', v)}
              placeholder="kg"
              keyboardType="decimal-pad"
            />
          </View>
        </SectionCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
  },
  title: {
    ...typography.h2,
    color: colors.ink,
    marginBottom: spacing.xxs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexField: {
    flex: 1,
  },
  choiceGroup: {
    marginBottom: spacing.md,
  },
  choiceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.smallMedium,
    color: colors.text,
  },
  chipTextSelected: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xxs,
  },
  counterGrid: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  counterItem: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  counterItemSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  counterItemName: {
    ...typography.bodyMedium,
    color: colors.ink,
    flex: 1,
  },
  counterItemNameSelected: {
    color: colors.primaryDark,
    fontWeight: '600',
  },
  counterControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  counterBtn: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  counterBtnAdd: {
    backgroundColor: colors.primarySoft,
  },
  counterValue: {
    ...typography.bodyMedium,
    color: colors.primaryDark,
    fontWeight: '700',
    minWidth: 20,
    textAlign: 'center',
  },
});
