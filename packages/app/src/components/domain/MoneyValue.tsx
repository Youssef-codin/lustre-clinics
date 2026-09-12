/**
 * Every amount on screen (Component Inventory §7.12): integer piastres in,
 * whole EGP out — piastres are never shown. Latin numerals are pinned to Latin
 * in both languages because DM Mono has no Arabic-Indic coverage and the money
 * screens depend on tabular alignment (§7.11); in Arabic the symbol is `ج.م`
 * and trails the figure (§7.13). Until the localization scaffold lands (F4),
 * the language is inferred from the layout direction.
 *
 * The arithmetic is in `./money`, which imports no `react-native` so the logic
 * suites can format an amount without a renderer. This file adds the two things
 * that need React Native: the markup, and reading the layout direction. The
 * `formatMoney`/`formatAmount` re-exported here are that direction-aware pair —
 * they are what `components/domain` exports and what a screen should use.
 */
import type { Locale } from '@lustre/shared';
import { I18nManager, StyleSheet, View } from 'react-native';
import type { TextTone, TextVariant, TextWeight } from '../../theme';
import { space, Text } from '../../theme';
import { CURRENCY, formatAmount, formatMoney as formatIn, type MoneyOptions } from './money';

export type MoneyValueProps = {
    piastres: number;
    compact?: boolean;
    variant?: TextVariant;
    weight?: TextWeight;
    tone?: TextTone;
    /** Off for a column that has already said it holds money; a number in running text keeps it. */
    showCurrency?: boolean;
    language?: Locale;
    testID?: string;
};

const SYMBOL_VARIANT: Partial<Record<TextVariant, TextVariant>> = {
    display: 'callout',
    figure: 'callout',
    title: 'subhead',
    title2: 'subhead',
    title3: 'subhead',
    amount: 'footnote',
};

export function formatMoney(piastres: number, options: MoneyOptions = {}): string {
    return formatIn(piastres, { ...options, language: options.language ?? currentLanguage() });
}

function currentLanguage(): Locale {
    return I18nManager.isRTL ? 'ar' : 'en';
}

export function MoneyValue({
    piastres,
    compact = false,
    variant = 'amount',
    weight,
    tone = 'ink',
    showCurrency = true,
    language,
    testID,
}: MoneyValueProps) {
    const locale = language ?? currentLanguage();
    const amount = formatAmount(piastres, compact);

    const symbol = showCurrency ? (
        <Text variant={SYMBOL_VARIANT[variant] ?? 'caption'} tone={tone} script="sans">
            {CURRENCY[locale]}
        </Text>
    ) : null;

    // `script="mono"` is explicit rather than left to detection: the Arabic
    // symbol would otherwise pull the whole string — digits included — onto the
    // Naskh face and out of tabular alignment.
    const figure = (
        <Text variant={variant} weight={weight} tone={tone} script="mono">
            {amount}
        </Text>
    );

    return (
        <View
            style={styles.row}
            accessible
            accessibilityLabel={formatIn(piastres, { compact, language: locale })}
            testID={testID}
        >
            {locale === 'ar' ? (
                <>
                    {figure}
                    {symbol}
                </>
            ) : (
                <>
                    {symbol}
                    {figure}
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
});
