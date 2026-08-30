/**
 * TrueMask common types and abstractions.
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type TrueMaskPrivateState } from 'leaderboard-contract';

export const trueMaskPrivateStateKey = 'trueMaskPrivateState';
export type TrueMaskPrivateStateId = typeof trueMaskPrivateStateKey;

export type TrueMaskCircuitKeys = 'submit_redaction' | 'verify_integrity';
export type TrueMaskProviders = MidnightProviders<
  TrueMaskCircuitKeys,
  TrueMaskPrivateStateId,
  TrueMaskPrivateState
>;
export type DeployedTrueMaskContract = FoundContract<any>;

/** One on-chain redaction record, hex-encoded for display. */
export interface RedactionRecordView {
  /** SHA-256 of the published image file. The ledger key. */
  readonly redactedImageHash: string;
  /** Root over every block that was NOT authorized to change. */
  readonly preservedRoot: string;
  /** Hash of the published authorization bitmap, bound to the grid. */
  readonly authorizationCommitment: string;
  readonly cols: number;
  readonly rows: number;
  readonly blockSize: number;
  /** True once `verify_integrity` has succeeded against this record. */
  readonly verified: boolean;
}

export interface TrueMaskDerivedState {
  readonly recordCount: number;
  readonly records: RedactionRecordView[];
}
