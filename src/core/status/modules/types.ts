/**
 * Status module descriptors. Each module names the API it needs and the
 * versions it was tested with, how to call it, what to do when this DSM lacks
 * it, which DSM App the "Open in DSM" row starts, and how its answer lands in
 * the snapshot. The model runs every module the same way; screens read only
 * the snapshot's DSM-free view models.
 */
import type { Requirement } from '../capabilities.ts';
import type { Item, StatusSnapshot } from '../model.ts';

export type StatusModule = {
  id: Item;
  requires: Requirement;
  /** Method and parameters; api and version are added by the model */
  params: Record<string, unknown>;
  /**
   * When this DSM has no such API: 'hide' for package APIs (no Hyper Backup
   * installed means no backup section), 'fallback' for one-line "Open in DSM"
   */
  missing: 'hide' | 'fallback';
  /** DSM App the fallback row opens with launchApp */
  dsmApp?: string;
  /** Codes meaning the feature is switched off in DSM: show why and offer DSM */
  disabled?: number[];
  /** The answer's data as a snapshot patch */
  apply(snapshot: StatusSnapshot, data: unknown, now: number): Partial<StatusSnapshot>;
};
/** Why a module shows a fallback row instead of its values */
export type Unavailable = 'unsupported' | 'disabled';
/** DSM App ids for "Open in DSM" */
export const dsmApps = {
  storage: 'SYNO.SDS.StorageManager.Instance',
  security: 'SYNO.SDS.SecurityScan.Instance',
  backup: 'SYNO.SDS.Backup.Application',
  resource: 'SYNO.SDS.ResourceMonitor.Instance',
  info: 'SYNO.SDS.AdminCenter.Application',
} as const;
