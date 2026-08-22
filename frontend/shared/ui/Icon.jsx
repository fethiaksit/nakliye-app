import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from './theme';

export default function Icon({ name, size = 22, color = colors.textSecondary, style, ...props }) {
  return <Ionicons accessibilityElementsHidden accessible={false} importantForAccessibility="no-hide-descendants" name={name} size={size} color={color} style={style} {...props} />;
}
