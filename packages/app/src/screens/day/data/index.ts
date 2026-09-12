/**
 * The day view's data layer — one entry point, so swapping in the real tRPC
 * client (BLOCKED.md) is this folder and nothing else.
 */
export { RequestError } from './client';
export type { BookedProcedure, PatientRef } from './day';
export { amend, api, arrive, checkInTimes, visitForAppointment } from './day';
export type { QueryResult } from './hooks';
export { useLocalMutation, useLocalQuery } from './hooks';
export type {
    Appointment,
    AppointmentProcedure,
    Branch,
    ClinicDay,
    EmbeddedPatient,
    Patient,
    PendingReminder,
    ProcedureCategory,
    ProcedureRow,
    Visit,
    VisitPayment,
} from './types';
