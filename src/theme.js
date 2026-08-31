// Reading Mate design theme — "reading lamp"
//
// Two palettes share the same semantic token names (ink = background,
// paper = surface, lamp = accent, etc.) so a component just asks for "the
// current colors" via useTheme() and never needs to know which mode is
// active — only the values differ between modes, the same idea as
// Tailwind's dark: variants or Material's day/night palettes.
//
// Type scale, spacing, and corner radii don't change between modes, so
// they stay as plain exports; only `colors` and the shadow shape need a
// light/dark split (see ThemeContext.js, which is what components
// actually import from).

export const fonts = {
  displayBold: 'Lora_700Bold',
  displaySemi: 'Lora_600SemiBold',
  displayRegular: 'Lora_400Regular',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

// Reading-pane font sizes (§2 "reading comfort controls") — deliberately
// separate from the UI type scale above, since the passage itself needs to
// read noticeably bigger and more spacious than any label, button, or chat
// bubble ever does. Keyed the same way `palettes` is, so ThemeContext can
// expose "the current one" via useTheme() the same way it exposes colors.
export const READING_FONT_SIZE_STEPS = ['small', 'medium', 'large'];
export const readingFontSizes = {
  small: { fontSize: 16, lineHeight: 27 },
  medium: { fontSize: 19, lineHeight: 31 },
  large: { fontSize: 23, lineHeight: 37 },
};

// "Reading lamp at night" — the original theme, and still the default for
// anyone who hasn't chosen otherwise.
const dark = {
  mode: 'dark',
  ink: '#14181D', // app background — the room at night
  paper: '#1F2530', // card / surface — the page under lamplight
  paperRaised: '#272E3B', // slightly raised surface (inputs, chips)
  lamp: '#E8A33D', // primary accent — the lamp glow
  lampSoft: 'rgba(232,163,61,0.14)',
  sage: '#6FCF97', // secondary accent — progress / success
  sageSoft: 'rgba(111,207,151,0.12)',
  coral: '#E8735D', // errors / destructive
  coralSoft: 'rgba(232,115,93,0.12)',
  textPrimary: '#F1EADC',
  textMuted: '#9AA1AE',
  textFaint: '#5C6472',
  border: '#2C3340',
  scrim: 'rgba(0,0,0,0.55)', // modal backdrop — stays dark in both modes
  statusBarStyle: 'light',
};

// "Reading lamp by day" — same room, curtains open. Same token names as
// `dark` above; every accent got nudged a shade darker/more saturated
// where it sits on a light background instead of a dark one, since hex
// values tuned to glow against charcoal read as washed-out on white paper.
const light = {
  mode: 'light',
  ink: '#F8F3E8',
  paper: '#FFFFFF',
  paperRaised: '#F1EBDC',
  lamp: '#B9701E',
  lampSoft: 'rgba(185,112,30,0.12)',
  sage: '#2F8F5B',
  sageSoft: 'rgba(47,143,91,0.12)',
  coral: '#C0452F',
  coralSoft: 'rgba(192,69,47,0.10)',
  textPrimary: '#221D14',
  textMuted: '#6B6252',
  textFaint: '#9C927E',
  border: '#E7DFCC',
  scrim: 'rgba(0,0,0,0.45)',
  statusBarStyle: 'dark',
};

export const palettes = { dark, light };

// A single "lifted off the page" shadow shape, tuned per mode — a plain
// black shadow at moderate opacity reads fine on the dark charcoal
// background, but the same shadow on white paper looks like a heavy gray
// smudge, so light mode uses a warmer, much softer one instead.
export function getShadow(mode) {
  return mode === 'light'
    ? {
        shadowColor: '#8A7A5C',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.14,
        shadowRadius: 6,
        elevation: 2,
      }
    : {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 3,
      };
}

export default { fonts, spacing, radius, palettes, getShadow, readingFontSizes, READING_FONT_SIZE_STEPS };
