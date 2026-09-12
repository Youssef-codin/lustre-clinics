// The Patients cluster. `PatientsCluster` is the entry point; the three screens
// are exported for when a real navigator mounts them as routes (SPEC §18 F3).
export type { PatientEditScreenProps } from './PatientEditScreen';
export type { PatientListScreenProps } from './PatientListScreen';
export type { PatientRecordScreenProps } from './PatientRecordScreen';
export type { OpenRecordRequest, PatientsClusterProps } from './PatientsCluster';
export { PatientsCluster } from './PatientsCluster';
