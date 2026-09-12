// The Money tab, which is one screen. It was three panes on `ui/PushView` —
// dashboard → a patient's balances → one visit's payment history — and the
// middle two existed for a single reason: `visit.recordPayment` took one
// `visitId`, so before a payment could be taken someone had to walk down to a
// visit and pick it.
//
// `balance.settle` takes a payment against a *patient* and allocates it across
// their unsettled visits oldest-first, so nothing has to be picked. Tapping a
// debtor opens that patient's record, where the money is taken and where the
// per-visit history already lives — the record's rows carry the ref and what is
// still owed on each, and `VisitPage` opens the payments on any of them.
//
// So there is no route left here to hold. The cluster is a wrapper around
// `MoneyScreen` plus the two signals the shell sends every cluster, and it stays
// as a component rather than collapsing into `MoneyScreen` because `goHome` is
// the tab's business and not the dashboard's. It goes when a real navigator
// lands (SPEC §18 F3).
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { color } from '../../theme';
import { MoneyScreen } from './MoneyScreen';

type MoneyClusterProps = {
    /** Bumped when the Money tab is tapped while it is already up. Home is the dashboard. */
    goHome?: number;
    /**
     * A debtor row's destination: that patient's record, on the Patients tab.
     * The shell owns the route — a cluster cannot push into another one's stack
     * — and `AppShell.openRecord` is the same one the doctor's day view uses.
     */
    onOpenRecord?: (patientId: string) => void;
};

function MoneyClusterView({ goHome = 0, onOpenRecord }: MoneyClusterProps = {}) {
    return (
        <View style={styles.root}>
            {/* `goHome` reaches the dashboard rather than being handled here:
                home for this tab is the dashboard scrolled to the top, and the
                scroll position is the one thing only that screen knows. */}
            <MoneyScreen goHome={goHome} onOpenRecord={onOpenRecord} />
        </View>
    );
}

/**
 * Thin as this is, the memo is not: it is the boundary that keeps `MoneyScreen`
 * — the whole dashboard, its period tabs and its debtor rows — out of a tab
 * switch, since both props it passes down come from the shell unchanged.
 */
export const MoneyCluster = memo(MoneyClusterView);

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.canvas },
});
