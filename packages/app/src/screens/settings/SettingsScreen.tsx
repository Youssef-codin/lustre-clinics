/**
 * Settings — one screen, not two: the role is a client-side preference, not a
 * permission, so the doctor's rows are simply absent for the secretary. There
 * is no navigator yet, so this screen is its own stack (`src/navigation`) drawn
 * with `ui/PushView`; lifting the panes into a real navigator is `push` →
 * `navigate`. The index is the root, and every pane sits one deep on top of it —
 * a pane's own editors push again from inside it.
 *
 * The index is a summary, not a menu. `settings.html` fills every row's sub
 * with that row's current answer — "default 30 min", "2 active · 1 inactive" —
 * so most questions are answered without opening anything, which is why the
 * screen loads all six summaries up front and shows skeleton rows rather than
 * drawing labels with empty subs under them.
 */
import type { ClientRole } from '@lustre/shared';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { memo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { type RouterOutput, resetDemoData, useDemoMode, useTRPC } from '../../api';
import { BrandMark, formatClock12 } from '../../components/domain';
import { Card, CardDivider, PushView, ScreenHeader, SectionLabel, useAfterSheet } from '../../components/ui';
import { isOpen, rendered, useRouteStack } from '../../navigation';
// The store module directly, not the `shell` barrel: that barrel exports
// `AppShell`, which imports this screen.
import { setLocale, useLocale } from '../../shell/localeStore';
import { color, size, space, Text } from '../../theme';
import { AppointmentsScreen } from './AppointmentsScreen';
import { AppScreen } from './AppScreen';
import { BranchesScreen } from './BranchesScreen';
import { ClinicScreen } from './ClinicScreen';
import { IdentityCard } from './components/IdentityCard';
import { DataEntryIcon, ResetDemoIcon, SettingsIcon } from './components/icons';
import { ErrorState, SkeletonRows } from './components/QueryStates';
import { RoleSwitchSheet } from './components/RoleSwitchSheet';
import { SettingsRow } from './components/SettingsRow';
import { useConnectionView } from './data/connection';
import { errorText } from './data/errors';
import { minutesFromTime } from './data/reminders';
import { DataEntryScreen } from './dataEntry';
import { PatientFieldsScreen } from './PatientFieldsScreen';
import { ProceduresScreen } from './ProceduresScreen';
import { RemindersScreen } from './RemindersScreen';
import { WorkingHoursScreen } from './WorkingHoursScreen';

/** The panes over the index. The index itself is the root and is not one. */
type Route =
    | 'app'
    | 'appointments'
    | 'reminders'
    | 'clinic'
    | 'branches'
    | 'hours'
    | 'procedures'
    | 'patientFields'
    | 'dataEntry';

const ROLE_NAME: Record<ClientRole, string> = { doctor: 'Doctor', secretary: 'Secretary' };
const ROLE_INITIAL: Record<ClientRole, string> = { doctor: 'D', secretary: 'S' };

type SettingsScreenProps = {
    role?: ClientRole;
    onChangeRole?: (role: ClientRole) => void;
    /**
     * Bumped when the fourth tab is tapped while it is already up. Home is the
     * index; the panes above it are all reads and settings already written, so
     * there is nothing in flight to protect.
     */
    goHome?: number;
};

function SettingsScreenView({ role: roleProp, onChangeRole, goHome = 0 }: SettingsScreenProps) {
    const [switching, setSwitching] = useState(false);
    // The switch redraws every tab in the shell, so it waits for the sheet that
    // asked for it to be off the screen.
    const roleDone = useAfterSheet();
    const [seenHome, setSeenHome] = useState(goHome);

    /**
     * The panes, and the hardware back with them. Nothing here answers back by
     * hand: the hook makes it `pop`, which is the same function the headers'
     * Back calls, so the two cannot come to disagree.
     *
     * What a pane has open inside itself stays the pane's own. An editor over
     * `ProceduresScreen` mounted after this stack did, and a handler that
     * mounted later is asked first, so it closes before this is reached.
     */
    const routes = useRouteStack<Route>();
    const back = routes.pop;

    if (goHome !== seenHome) {
        setSeenHome(goHome);
        routes.popToRoot();
        setSwitching(false);
    }

    const demo = useDemoMode();

    const [localRole, setLocalRole] = useState<ClientRole>('doctor');
    const role = roleProp ?? localRole;

    const locale = useLocale();

    const summary = useSummary();
    const connection = useConnectionView();

    const isDoctor = role === 'doctor';

    function changeRole(next: ClientRole) {
        setLocalRole(next);
        onChangeRole?.(next);
    }

    return (
        <View style={styles.screen}>
            <ScreenHeader title="Settings" trailing={<BrandMark variant="lockup" size={13} tone="muted" />} />

            <IdentityCard
                roleName={ROLE_NAME[role]}
                roleInitial={ROLE_INITIAL[role]}
                clinicName={summary.data?.clinicName ?? ''}
                connection={connection}
                onSwitchRole={() => setSwitching(true)}
                testID="settings-identity"
            />

            <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                {summary.loading ? <SkeletonRows count={3} /> : null}

                {summary.error ? (
                    <ErrorState
                        message={errorText(summary.error)}
                        onRetry={summary.reload}
                        retrying={summary.reloading}
                    />
                ) : null}

                {summary.data ? (
                    <>
                        <Group title="GENERAL">
                            <SettingsRow
                                icon={<SettingsIcon glyph="app" />}
                                label="App"
                                sub="Language, server connection"
                                onPress={() => routes.push('app')}
                                testID="settings-app-row"
                            />
                            <CardDivider />
                            <SettingsRow
                                icon={<SettingsIcon glyph="appointments" />}
                                label="Appointments"
                                sub={`Durations · default ${summary.data.defaultDuration} min`}
                                onPress={() => routes.push('appointments')}
                                testID="settings-appointments-row"
                            />
                            <CardDivider />
                            <SettingsRow
                                icon={<SettingsIcon glyph="reminders" />}
                                label="Reminders"
                                sub={`Due ${summary.data.leadHours}h before · notify ${formatClock12(summary.data.notifyAt)}`}
                                onPress={() => routes.push('reminders')}
                                testID="settings-reminders-row"
                            />
                        </Group>

                        {isDoctor ? (
                            <Group title="CLINIC">
                                <SettingsRow
                                    icon={<SettingsIcon glyph="clinic" />}
                                    label="Clinic"
                                    sub="Name, phone"
                                    onPress={() => routes.push('clinic')}
                                    testID="settings-clinic-row"
                                />
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="branches" />}
                                    label="Branches"
                                    sub={`${summary.data.activeBranches} active · ${summary.data.inactiveBranches} inactive`}
                                    onPress={() => routes.push('branches')}
                                    testID="settings-branches"
                                />
                                <CardDivider />
                                {/* Not in `settings.html` — see DECISIONS.md. */}
                                <SettingsRow
                                    icon={<SettingsIcon glyph="hours" />}
                                    label="Working hours"
                                    sub={`${summary.data.openDays} days open`}
                                    onPress={() => routes.push('hours')}
                                    testID="settings-hours"
                                />
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="procedures" />}
                                    label="Procedures & prices"
                                    sub={`${summary.data.procedures} procedures · ${summary.data.activeProcedures} active`}
                                    onPress={() => routes.push('procedures')}
                                    testID="settings-procedures"
                                />
                                <CardDivider />
                                <SettingsRow
                                    icon={<SettingsIcon glyph="fields" />}
                                    label="Patient fields"
                                    sub={`${summary.data.questions} questions · ${summary.data.requiredQuestions} required`}
                                    onPress={() => routes.push('patientFields')}
                                    testID="settings-patient-fields"
                                />
                            </Group>
                        ) : null}

                        {/* The secretary's, and only hers: she is the one
                            retyping the old system's register, and the doctor
                            tapping into a bulk entry form is a mis-tap with a
                            patient at the end of it. Like every other row here
                            the gate is the device-local role, which hides rows
                            and never guards access (§1). */}
                        {isDoctor ? null : (
                            <Group title="MIGRATION">
                                <SettingsRow
                                    icon={<DataEntryIcon />}
                                    label="Data entry"
                                    sub="Bulk entry from the old system"
                                    onPress={() => routes.push('dataEntry')}
                                    testID="settings-data-entry-row"
                                />
                            </Group>
                        )}

                        {/* Only in demo mode, and only here: a demo is given
                            more than once, and the second run should not open
                            on the first one's cancellations. `resetDemoData`
                            reports the reseed to `api/dataReset`, which is what
                            drops the clinic the query cache and the day view's
                            own hooks are still holding. */}
                        {demo.enabled ? (
                            <Group title="DEMO">
                                <SettingsRow
                                    icon={<ResetDemoIcon />}
                                    label="Reset demo data"
                                    sub="Back to the clinic the demo opens on"
                                    onPress={() => {
                                        void resetDemoData();
                                    }}
                                    testID="settings-reset-demo"
                                />
                            </Group>
                        ) : null}

                        <Group title="ABOUT">
                            <SettingsRow
                                icon={<SettingsIcon glyph="about" />}
                                label="About"
                                sub={`Version ${VERSION}`}
                                onPress={() => {}}
                                testID="settings-about"
                            />
                        </Group>

                        <Text variant="footnote" tone="muted" script="mono" style={styles.version}>
                            {VERSION_LINE}
                        </Text>
                    </>
                ) : null}
            </ScrollView>

            <RoleSwitchSheet
                visible={switching}
                role={role}
                fromName={ROLE_NAME[role]}
                toName={ROLE_NAME[role === 'doctor' ? 'secretary' : 'doctor']}
                onConfirm={() => {
                    setSwitching(false);
                    roleDone.after(() => {
                        changeRole(role === 'doctor' ? 'secretary' : 'doctor');
                        routes.popToRoot();
                    });
                }}
                onCancel={() => setSwitching(false)}
                onClosed={roleDone.closed}
            />

            {/* Nine near-identical blocks before the stack, each repeating its
                own route name three times. A popped pane stays in here until it
                reports the slide finished (`onClosed`), which is the only reason
                a route that is no longer open is still drawn. */}
            {rendered(routes.stack).map(({ id, route: pane }, index) => (
                <PushView
                    key={id}
                    visible={isOpen(routes.stack, index)}
                    onClosed={routes.settled}
                    testID={`settings-pane-${pane}`}
                >
                    {pane === 'app' ? (
                        <AppScreen locale={locale} onChangeLocale={setLocale} onBack={back} />
                    ) : null}
                    {pane === 'appointments' ? <AppointmentsScreen onBack={back} /> : null}
                    {pane === 'reminders' ? <RemindersScreen onBack={back} /> : null}
                    {pane === 'clinic' ? <ClinicScreen onBack={back} /> : null}
                    {pane === 'branches' ? <BranchesScreen onBack={back} /> : null}
                    {pane === 'hours' ? <WorkingHoursScreen onBack={back} /> : null}
                    {pane === 'procedures' ? <ProceduresScreen onBack={back} /> : null}
                    {pane === 'patientFields' ? <PatientFieldsScreen onBack={back} /> : null}
                    {pane === 'dataEntry' ? <DataEntryScreen onBack={back} /> : null}
                </PushView>
            ))}
        </View>
    );
}

/** Memoised for the reason the other three clusters are — see `shell/AppShell.tsx`. */
export const SettingsScreen = memo(SettingsScreenView);

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.group}>
            <SectionLabel inset={false}>{title}</SectionLabel>
            <Card>{children}</Card>
        </View>
    );
}

/**
 * Everything the index's subs are counted from. Four reads go out together over
 * one batched request; the panes below read the same cache, so an edit in a
 * pane is on the index the moment it lands and nothing has to be handed back up
 * on the way out.
 *
 * The identity card names the clinic rather than the branch this phone is
 * standing in: nothing on the server tracks that yet, and a card that says the
 * wrong branch is worse than one that does not claim to know.
 */
function useSummary() {
    const trpc = useTRPC();

    const settings = useQuery(trpc.settings.get.queryOptions());
    const schedule = useQuery(trpc.settings.schedule.queryOptions());
    const branches = useQuery(trpc.branch.list.queryOptions({ includeInactive: true }));
    const procedures = useQuery(trpc.procedure.tree.queryOptions({ includeInactive: true }));
    const questions = useQuery(trpc.customQuestion.list.queryOptions({ includeInactive: true }));

    const reads = [settings, schedule, branches, procedures, questions];

    const data =
        settings.data && schedule.data && branches.data && procedures.data && questions.data
            ? summarize({
                  settings: settings.data,
                  schedule: schedule.data,
                  branches: branches.data,
                  procedures: procedures.data,
                  questions: questions.data,
              })
            : undefined;

    return {
        data,
        loading: reads.some((read) => read.isLoading),
        reloading: reads.some((read) => read.isFetching),
        error: reads.find((read) => read.error !== null)?.error ?? null,
        reload: () => {
            for (const read of reads) void read.refetch();
        },
    };
}

type SummaryInput = {
    settings: RouterOutput['settings']['get'];
    schedule: RouterOutput['settings']['schedule'];
    branches: RouterOutput['branch']['list'];
    procedures: RouterOutput['procedure']['tree'];
    questions: RouterOutput['customQuestion']['list'];
};

function summarize({ settings, schedule, branches, procedures, questions }: SummaryInput) {
    const flatProcedures = procedures.flatMap((node) => [node, ...node.children]);
    const activeQuestions = questions.filter((q) => q.active);

    return {
        clinicName: settings.clinicName,
        activeBranches: branches.filter((b) => b.active).length,
        inactiveBranches: branches.filter((b) => !b.active).length,
        openDays: schedule.length,
        procedures: flatProcedures.length,
        activeProcedures: flatProcedures.filter((p) => p.active).length,
        questions: activeQuestions.length,
        requiredQuestions: activeQuestions.filter((q) => q.required).length,
        defaultDuration: settings.defaultDuration,
        leadHours: settings.reminderLeadHours,
        notifyAt: minutesFromTime(settings.reminderNotifyAt),
    };
}

const VERSION = Constants.expoConfig?.version ?? '0.0.0';
const BUILD = Constants.nativeBuildVersion;
const VERSION_LINE = BUILD ? `Lustre ${VERSION} (build ${BUILD})` : `Lustre ${VERSION}`;

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    scroll: { flex: 1 },
    content: {
        paddingTop: space[4.5],
        paddingHorizontal: size.bleed,
        paddingBottom: space[12],
        gap: space[4.5],
    },
    group: { gap: space[2] },
    version: { textAlign: 'center' },
});
