// Design tokens V2 — constantes de layout e paleta de cores estáticas.
//
// C: paleta de cores estáticas (dark-mode). Para telas que respondem ao tema
//    light/dark, use useMvTheme() em vez de C.* diretamente.
// S: constantes de layout usadas para medidas não cobertas por MvTypography
//    (touchMin, navH, itemH). Para borderRadius de cards, use radius.xl (16)
//    de MvTypography — S.cardR e S.btnR são mantidos apenas para
//    retrocompatibilidade com componentes client existentes.
// DISPLAY/UI*: aliases de fontFamily — use estes nomes em fontFamily.

export const C = {
  green:        '#24E66D',
  greenDim:     'rgba(36,230,109,0.12)',
  greenGlow:    'rgba(36,230,109,0.22)',
  greenBorder:  'rgba(36,230,109,0.20)',
  amber:        '#F5A623',
  amberDim:     'rgba(245,166,35,0.12)',
  amberBorder:  'rgba(245,166,35,0.20)',
  sky:          '#38BDF8',
  skyDim:       'rgba(56,189,248,0.12)',
  skyBorder:    'rgba(56,189,248,0.20)',
  surface0:     '#030806',
  surface1:     '#07120C',
  surface2:     '#0D1F14',
  border:       'rgba(255,255,255,0.07)',
  borderMid:    'rgba(255,255,255,0.11)',
  white:        '#FFFFFF',
  zinc300:      '#D4D4D8',
  zinc400:      '#A1A1AA',
  zinc500:      '#71717A',
  zinc600:      '#52525B',
} as const;

export const S = {
  px:       20,   // padding lateral de tela
  gap:      24,   // gap entre seções
  cardPad:  14,   // padding interno de cards
  /** @deprecated Novos usos: radius.xl (16) de MvTypography */
  cardR:    24,
  chipR:    99,   // border radius de chips/pills
  /** @deprecated Novos usos: radius.xl (16) de MvTypography */
  btnR:     18,
  btnH:     52,   // altura de botões primários
  touchMin: 44,   // altura mínima de qualquer elemento interativo
  itemH:    56,   // altura mínima de itens de lista
  navH:     64,   // altura da bottom nav
} as const;

// Aliases de fonte — use estes nomes em fontFamily
export const DISPLAY      = 'PlusJakartaSans_800ExtraBold';
export const DISPLAY_BOLD = 'PlusJakartaSans_700Bold';
export const UI           = 'DMSans_400Regular';
export const UI_MED       = 'DMSans_500Medium';
export const UI_BOLD      = 'DMSans_700Bold';
