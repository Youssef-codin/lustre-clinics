/**
 * The Day view cluster. `DayScreen` is the only export a navigator needs;
 * everything else is internal to the cluster and stays that way.
 */

// The exception: a visit is opened from a patient's history too, and that row
// holds two ids and nothing else. `VisitPage` is the whole stack behind them, so
// the caller needs none of this cluster's data layer.
export { VisitPage } from './components/VisitPage';
export type { OpenBookingRequest } from './DayScreen';
export { DayScreen } from './DayScreen';
export { DoctorDayScreen } from './DoctorDayScreen';
