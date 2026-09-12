import { DMMono_400Regular } from '@expo-google-fonts/dm-mono/400Regular';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans/700Bold';
import { NotoNaskhArabic_400Regular } from '@expo-google-fonts/noto-naskh-arabic/400Regular';
import { NotoNaskhArabic_500Medium } from '@expo-google-fonts/noto-naskh-arabic/500Medium';
import { NotoNaskhArabic_600SemiBold } from '@expo-google-fonts/noto-naskh-arabic/600SemiBold';
import { NotoNaskhArabic_700Bold } from '@expo-google-fonts/noto-naskh-arabic/700Bold';
import { useFonts } from 'expo-font';

// The three bundled faces (Component Inventory §7.2). A system stack resolves
// to Roboto on Android and collapses the designs' weights and tracking, and
// Instrument Serif is deliberately absent (loaded by no design). Faces are
// imported per weight rather than from package roots, which would bundle
// ~430KB of unused italics. Keys are the family names from tailwind.config.js
// `fontFamily`; React Native selects a face by family name alone, so each
// weight is registered separately rather than as one family with a weight.
const APP_FONTS = {
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    DMMono_400Regular,
    DMMono_500Medium,
    NotoNaskhArabic_400Regular,
    NotoNaskhArabic_500Medium,
    NotoNaskhArabic_600SemiBold,
    NotoNaskhArabic_700Bold,
};

// Hold the splash screen until every face is resolved, or the first frame
// renders in the fallback face and reflows.
export function useAppFonts(): boolean {
    const [loaded, error] = useFonts(APP_FONTS);
    if (error) throw error;
    return loaded;
}
