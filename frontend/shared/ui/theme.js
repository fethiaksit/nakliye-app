export const colors = {
  background: '#F4F7FB',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  surfaceStrong: '#EAF0F4',
  primary: '#0F6B5D',
  primaryDark: '#0A4D43',
  primarySoft: '#E6F3F0',
  accent: '#E46D3B',
  accentSoft: '#FFF0E8',
  ink: '#132238',
  text: '#26384F',
  textSecondary: '#66758A',
  textMuted: '#8C98A8',
  border: '#DCE3EA',
  borderStrong: '#C5D0DB',
  success: '#16805D',
  successSoft: '#E8F6F0',
  warning: '#A56613',
  warningSoft: '#FFF5DF',
  danger: '#C4433B',
  dangerSoft: '#FDEDEC',
  info: '#3067B2',
  infoSoft: '#EAF2FC',
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(10, 25, 42, 0.48)',
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 26,
  pill: 999,
};

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.35 },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: '800', letterSpacing: -0.15 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyMedium: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallMedium: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
};

export const control = {
  inputHeight: 54,
  buttonHeight: 52,
  iconButton: 44,
  bottomNavHeight: 68,
};

export const shadows = {
  card: {
    shadowColor: '#183048',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  floating: {
    shadowColor: '#12263A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 8,
  },
};

export const hitSlop = { top: 10, right: 10, bottom: 10, left: 10 };

export default { colors, spacing, radius, typography, control, shadows, hitSlop };
