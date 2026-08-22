import React, { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from './Icon';
import { AppButton, InlineNotice, TextField } from './primitives';
import { colors, radius, shadows, spacing, typography } from './theme';

const normalizePhone = value => { const digits = String(value || '').replace(/\D/g, '').replace(/^0/, ''); return digits.startsWith('90') ? `+${digits.slice(0, 12)}` : `+90${digits.slice(0, 10)}`; };
const isPhone = value => /^\+905\d{9}$/.test(normalizePhone(value));

function PasswordField(props) {
  const [visible, setVisible] = useState(false);
  return <TextField {...props} leftIcon="lock-closed-outline" secureTextEntry={!visible} rightAction={<Pressable hitSlop={10} accessibilityLabel={visible ? 'Şifreyi gizle' : 'Şifreyi göster'} onPress={() => setVisible(current => !current)}><Icon name={visible ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.textMuted} /></Pressable>} />;
}

function Checkbox({ checked, onPress, label, error }) {
  return <View><Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={styles.checkboxRow}><View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked ? <Icon name="checkmark" size={16} color={colors.white} /> : null}</View><Text style={styles.checkboxLabel}>{label}</Text></Pressable>{error ? <Text style={styles.checkboxError}>{error}</Text> : null}</View>;
}

export default function AuthFlow({ auth, saveSession, apiError, onSession, connectionCheck, allowedRole }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '', role: allowedRole || 'customer' });
  const [errors, setErrors] = useState({}); const [terms, setTerms] = useState(false); const [remember, setRemember] = useState(true); const [busy, setBusy] = useState(false); const [serverError, setServerError] = useState(''); const [resetSent, setResetSent] = useState(false);
  const busyRef = useRef(false); const phoneRef = useRef(null); const passwordRef = useRef(null); const confirmRef = useRef(null); const emailRef = useRef(null);
  const set = (key, value) => { setForm(old => ({ ...old, [key]: value })); setErrors(old => ({ ...old, [key]: '' })); setServerError(''); };
  const changeMode = next => { setMode(next); setErrors({}); setServerError(''); setResetSent(false); Keyboard.dismiss(); };
  const validate = () => {
    const next = {};
    if (mode === 'reset') { if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Geçerli bir e-posta adresi girin.'; }
    else {
      if (mode === 'register' && !form.name.trim()) next.name = 'Ad soyad zorunludur.';
      if (!isPhone(form.phone)) next.phone = 'Geçerli bir +90 5xx xxx xx xx numarası girin.';
      if (mode === 'register' && !/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Geçerli bir e-posta adresi girin.';
      if (!form.password) next.password = 'Şifre zorunludur.';
      if (mode === 'register' && form.password.length < 8) next.password = 'Şifre en az 8 karakter olmalıdır.';
      if (mode === 'register' && form.password !== form.confirm) next.confirm = 'Şifreler eşleşmiyor.';
      if (mode === 'register' && !terms) next.terms = 'Devam etmek için kullanım koşullarını kabul edin.';
    }
    setErrors(next); return Object.keys(next).length === 0;
  };
  const submit = async () => {
    if (busyRef.current || !validate()) return;
    busyRef.current = true; setBusy(true); setServerError('');
    try {
      if (mode === 'reset') { await auth.reset({ email: form.email.trim().toLowerCase() }); setResetSent(true); return; }
      const payload = mode === 'login' ? { phone: normalizePhone(form.phone), password: form.password } : { name: form.name.trim(), phone: normalizePhone(form.phone), email: form.email.trim().toLowerCase(), password: form.password, role: allowedRole || form.role };
      const { data } = mode === 'login' ? await auth.login(payload) : await auth.register(payload);
      if (allowedRole && data.user.role !== allowedRole) throw new Error(allowedRole === 'customer' ? 'Bu hesap Şoför uygulamasında kullanılmalıdır.' : 'Bu hesap Müşteri uygulamasında kullanılmalıdır.');
      await saveSession(data, remember); onSession(data.user);
    } catch (error) { setServerError(apiError(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const roleLabel = allowedRole === 'driver' ? 'Şoför' : 'Müşteri';
  const heading = mode === 'register' ? 'Hesabınızı oluşturun' : mode === 'reset' ? 'Şifrenizi yenileyin' : allowedRole === 'driver' ? 'Yeni işlere hazır olun' : 'Taşımanızı güvenle planlayın';
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safe}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
    <View style={styles.hero}><View style={styles.logo}><Icon name={allowedRole === 'driver' ? 'car-sport' : 'cube'} size={30} color={colors.white} /></View><Text style={styles.brand}>NakliyeGo</Text><View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{roleLabel} uygulaması</Text></View><Text style={styles.heroTitle}>{heading}</Text><Text style={styles.heroText}>{mode === 'register' ? 'Temel bilgilerinizi girerek birkaç adımda başlayın.' : mode === 'reset' ? 'Kayıtlı e-posta adresinize sıfırlama talimatı gönderelim.' : 'İlanlar, teklifler ve mesajlar tek bir güvenli akışta.'}</Text></View>
    <View style={styles.panel}>
      {mode === 'register' ? <>
        <TextField required label="Ad soyad" value={form.name} onChangeText={value => set('name', value)} error={errors.name} leftIcon="person-outline" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />
        <TextField required label="Telefon" value={form.phone} onChangeText={value => set('phone', value)} error={errors.phone} helper="Türkiye cep telefonu numaranızı girin." leftIcon="call-outline" keyboardType="phone-pad" inputRef={phoneRef} returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
        <TextField required label="E-posta" value={form.email} onChangeText={value => set('email', value)} error={errors.email} leftIcon="mail-outline" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} inputRef={emailRef} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <PasswordField required label="Şifre" value={form.password} onChangeText={value => set('password', value)} error={errors.password} helper="En az 8 karakter kullanın." inputRef={passwordRef} returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} />
        <PasswordField required label="Şifre tekrar" value={form.confirm} onChangeText={value => set('confirm', value)} error={errors.confirm} inputRef={confirmRef} returnKeyType="done" onSubmitEditing={submit} />
        {!allowedRole ? <View style={styles.rolePicker}><Text style={styles.roleTitle}>Kullanıcı tipi</Text><View style={styles.roleOptions}>{[{ value: 'customer', label: 'Müşteri', icon: 'cube-outline' }, { value: 'driver', label: 'Şoför', icon: 'car-outline' }].map(option => <Pressable key={option.value} onPress={() => set('role', option.value)} style={[styles.roleOption, form.role === option.value && styles.roleOptionOn]}><Icon name={option.icon} size={23} color={form.role === option.value ? colors.primary : colors.textMuted} /><Text style={[styles.roleOptionText, form.role === option.value && styles.roleOptionTextOn]}>{option.label}</Text></Pressable>)}</View></View> : null}
        <Checkbox checked={terms} onPress={() => { setTerms(current => !current); setErrors(old => ({ ...old, terms: '' })); }} label="Kullanım koşullarını kabul ediyorum" error={errors.terms} />
      </> : mode === 'reset' ? <><TextField required label="E-posta" value={form.email} onChangeText={value => set('email', value)} error={errors.email} leftIcon="mail-outline" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={submit} />{resetSent ? <InlineNotice tone="success" title="Talebiniz alındı" message="Hesap bulunuyorsa sıfırlama talimatları e-posta adresinize gönderildi." /> : null}</> : <>
        <TextField required label="Telefon" value={form.phone} onChangeText={value => set('phone', value)} error={errors.phone} leftIcon="call-outline" keyboardType="phone-pad" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <PasswordField required label="Şifre" value={form.password} onChangeText={value => set('password', value)} error={errors.password} inputRef={passwordRef} returnKeyType="done" onSubmitEditing={submit} />
        <View style={styles.loginOptions}><Checkbox checked={remember} onPress={() => setRemember(current => !current)} label="Beni hatırla" /><Pressable hitSlop={8} onPress={() => changeMode('reset')}><Text style={styles.link}>Şifremi unuttum</Text></Pressable></View>
      </>}
      {serverError ? <InlineNotice tone="danger" title="İşlem tamamlanamadı" message={serverError} /> : null}
      <AppButton loading={busy} label={mode === 'register' ? 'Hesap oluştur' : mode === 'reset' ? 'Talimat gönder' : 'Giriş yap'} icon={mode === 'register' ? 'person-add-outline' : mode === 'reset' ? 'mail-unread-outline' : 'log-in-outline'} onPress={submit} style={styles.submit} />
      <View style={styles.switchRow}><Text style={styles.switchText}>{mode === 'login' ? 'Hesabınız yok mu?' : mode === 'register' ? 'Zaten hesabınız var mı?' : 'Şifrenizi hatırladınız mı?'}</Text><Pressable hitSlop={8} onPress={() => changeMode(mode === 'login' ? 'register' : 'login')}><Text style={styles.switchLink}>{mode === 'login' ? 'Kayıt olun' : 'Giriş yapın'}</Text></Pressable></View>
    </View>{connectionCheck}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 }, scroll: { flexGrow: 1, paddingBottom: spacing.xxl }, hero: { alignItems: 'center', backgroundColor: colors.ink, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, paddingBottom: 54, paddingHorizontal: spacing.xl, paddingTop: spacing.xl }, logo: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.md, height: 56, justifyContent: 'center', width: 56 }, brand: { ...typography.h2, color: colors.white, marginTop: spacing.sm }, roleBadge: { backgroundColor: 'rgba(255,255,255,.1)', borderRadius: radius.pill, marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs }, roleBadgeText: { ...typography.caption, color: '#D6E0E8' }, heroTitle: { ...typography.h1, color: colors.white, marginTop: spacing.xl, textAlign: 'center' }, heroText: { ...typography.small, color: '#B9C5D2', marginTop: spacing.xs, maxWidth: 330, textAlign: 'center' }, panel: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.xl, borderWidth: 1, marginHorizontal: spacing.md, marginTop: -30, padding: spacing.lg, ...shadows.floating }, loginOptions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }, checkboxRow: { alignItems: 'center', flexDirection: 'row', minHeight: 44 }, checkbox: { alignItems: 'center', borderColor: colors.borderStrong, borderRadius: radius.xs, borderWidth: 1.5, height: 22, justifyContent: 'center', width: 22 }, checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary }, checkboxLabel: { ...typography.small, color: colors.text, marginLeft: spacing.xs }, checkboxError: { ...typography.caption, color: colors.danger }, link: { ...typography.smallMedium, color: colors.primary }, submit: { marginTop: spacing.md }, switchRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg }, switchText: { ...typography.small, color: colors.textSecondary, marginRight: spacing.xs }, switchLink: { ...typography.smallMedium, color: colors.primary }, rolePicker: { marginTop: spacing.md }, roleTitle: { ...typography.smallMedium, color: colors.text }, roleOptions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }, roleOption: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flex: 1, gap: spacing.xs, minHeight: 70, justifyContent: 'center' }, roleOptionOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, roleOptionText: { ...typography.smallMedium, color: colors.textSecondary }, roleOptionTextOn: { color: colors.primaryDark },
});
