import type { NasProfile } from './config';

/** The Android App keeps any number of NAS; the web build serves exactly one, the DSM it came from */
export const singleNas = false;
/** The web build's only NAS; the App has none */
export function fixedProfile(_saved?: NasProfile): NasProfile | undefined { return undefined; }
