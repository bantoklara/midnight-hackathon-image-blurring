/**
 * Shared business logic for the leaderboard contract.
 *
 * Platform-agnostic — works from browser (Lace) or CLI (wallet-sdk).
 * Each platform provides its own provider implementations.
 *
 * @packageDocumentation
 */

import { Leaderboard, TrueMask } from 'leaderboard-contract';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import {
  type LeaderboardDerivedState,
  type LeaderboardEntry,
  type LeaderboardProviders,
  type DeployedLeaderboardContract,
  leaderboardPrivateStateKey,
} from './common-types.js';
import {
  CompiledLeaderboardContract,
  createLeaderboardPrivateState,
  setCustomName,
  type LeaderboardPrivateState,
} from 'leaderboard-contract';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { map, type Observable } from 'rxjs';
import {
  CompiledTrueMaskContract,
  createTrueMaskPrivateState,
  stageRedactionWitness,
  clearRedactionWitness,
} from 'leaderboard-contract';
import {
  type TrueMaskProviders,
  type TrueMaskDerivedState,
  type RedactionRecordView,
  type DeployedTrueMaskContract,
  trueMaskPrivateStateKey,
} from './truemask-common-types.js';
import type { RedactionResult } from './vision/types.js';

/**
 * API for a deployed leaderboard contract.
 *
 * Created via `LeaderboardAPI.deploy()` (admin) or `LeaderboardAPI.join()` (player).
 */
export class LeaderboardAPI {
  private constructor(
    public readonly deployedContract: DeployedLeaderboardContract,
    providers: LeaderboardProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);

    this.state$ = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(
        map((contractState) => Leaderboard.ledger(contractState.data)),
        map((ledgerState): LeaderboardDerivedState => {
          const entries: LeaderboardEntry[] = [];
          for (const [key, entry] of ledgerState.scores) {
            entries.push({
              id: Number(key),
              score: Number(entry.score),
              displayName: utils.decodeDisplayName(entry.displayName, Number(key), Number(entry.score)),
              ownerHash: entry.ownerHash.toString(),
            });
          }
          entries.sort((a, b) => b.score - a.score);
          return { entryCount: Number(ledgerState.nextId), entries };
        }),
      );
  }

  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<LeaderboardDerivedState>;

  /** Submit a score. If customName is provided, it's used as display name via witness. */
  async submitScore(score: number, customName?: string): Promise<void> {
    if (customName) {
      setCustomName(customName);
    }
    await (this.deployedContract as any).callTx.submitScore(BigInt(score), !!customName);
  }

  /** Prove ownership of a leaderboard entry. The proof is private — use it to claim a prize or verify identity. */
  async verifyOwnership(entryId: number): Promise<void> {
    await (this.deployedContract as any).callTx.verifyOwnership(BigInt(entryId));
  }

  /** Deploy a new leaderboard contract (admin operation). */
  static async deploy(providers: LeaderboardProviders, secretKey: Uint8Array, logger?: Logger): Promise<LeaderboardAPI> {
    const deployedContract = await deployContract(providers as any, {
      compiledContract: CompiledLeaderboardContract,
      privateStateId: leaderboardPrivateStateKey,
      initialPrivateState: createLeaderboardPrivateState(secretKey),
    });
    return new LeaderboardAPI(deployedContract, providers, logger);
  }

  /** Join an existing leaderboard contract (player operation). */
  static async join(
    providers: LeaderboardProviders,
    contractAddress: ContractAddress,
    secretKey: Uint8Array,
    logger?: Logger,
  ): Promise<LeaderboardAPI> {
    const deployedContract = await findDeployedContract(providers as any, {
      contractAddress,
      compiledContract: CompiledLeaderboardContract,
      privateStateId: leaderboardPrivateStateKey,
      initialPrivateState: createLeaderboardPrivateState(secretKey),
    });
    return new LeaderboardAPI(deployedContract, providers, logger);
  }
}

export * as utils from './utils/index.js';
export * from './common-types.js';

/**
 * API for a deployed TrueMask contract.
 *
 * Created via `TrueMaskAPI.deploy()` (first publication) or `TrueMaskAPI.join()`
 * (an editor or reader checking an existing registry).
 *
 * The image itself never reaches this class. `redactImage()` in `./vision` runs
 * entirely on the journalist's machine and produces the lane digests; only the
 * folded 32-byte root, a commitment to the redaction bitmap, and the grid
 * dimensions are ever submitted.
 */
export class TrueMaskAPI {
  private constructor(
    public readonly deployedContract: DeployedTrueMaskContract,
    providers: TrueMaskProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);

    this.state$ = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(
        map((contractState) => TrueMask.ledger(contractState.data)),
        map((ledgerState): TrueMaskDerivedState => {
          const records: RedactionRecordView[] = [];
          for (const [redactedImageHash, record] of ledgerState.records) {
            records.push({
              redactedImageHash: toHex(redactedImageHash),
              preservedRoot: toHex(record.preserved_root),
              authorizationCommitment: toHex(record.authorization_commitment),
              cols: Number(record.cols),
              rows: Number(record.rows),
              blockSize: Number(record.block_size),
              verified: record.verified,
            });
          }
          return { recordCount: records.length, records };
        }),
      );
  }

  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<TrueMaskDerivedState>;

  /**
   * Register a redacted image.
   *
   * `redactedImageHash` must be the SHA-256 of the exact bytes that get published
   * — the lossless PNG. Hashing a re-encoded (e.g. JPEG) copy produces a record
   * nobody can ever verify.
   */
  async submitRedaction(
    redactedImageHash: Uint8Array,
    redaction: RedactionResult,
  ): Promise<SubmittedRecord> {
    const { grid, authorizationCommitment, laneDigests } = redaction.plan;
    stageRedactionWitness(laneDigests, redaction.originalLaneDigests);
    try {
      this.logger?.info({ cols: grid.cols, rows: grid.rows }, 'submitting redaction');
      const finalized = await (this.deployedContract as any).callTx.submit_redaction(
        redactedImageHash,
        authorizationCommitment,
        BigInt(grid.cols),
        BigInt(grid.rows),
        BigInt(grid.blockSize),
      );
      return {
        txId: String(finalized?.public?.txId ?? ''),
        status: String(finalized?.public?.status ?? 'unknown'),
        contractAddress: String(this.deployedContractAddress),
      };
    } finally {
      clearRedactionWitness();
    }
  }

  /**
   * Re-check a registered image against the copy the caller holds.
   *
   * `laneDigests` come from `computeLaneDigests(publishedImage, grid, authorizedBlocks)`
   * where the grid and the authorized blocks are rebuilt from the published bitmap.
   * Throws if any non-redacted block has changed since submission.
   */
  async verifyIntegrity(redactedImageHash: Uint8Array, laneDigests: Uint8Array[]): Promise<void> {
    stageRedactionWitness(laneDigests, laneDigests);
    try {
      await (this.deployedContract as any).callTx.verify_integrity(redactedImageHash);
    } finally {
      clearRedactionWitness();
    }
  }

  /** Deploy a new TrueMask registry. */
  static async deploy(providers: TrueMaskProviders, logger?: Logger): Promise<TrueMaskAPI> {
    const deployedContract = await deployContract(providers as any, {
      compiledContract: CompiledTrueMaskContract,
      privateStateId: trueMaskPrivateStateKey,
      initialPrivateState: createTrueMaskPrivateState(),
    });
    return new TrueMaskAPI(deployedContract, providers, logger);
  }

  /** Connect to an existing TrueMask registry. */
  static async join(
    providers: TrueMaskProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
  ): Promise<TrueMaskAPI> {
    const deployedContract = await findDeployedContract(providers as any, {
      contractAddress,
      compiledContract: CompiledTrueMaskContract,
      privateStateId: trueMaskPrivateStateKey,
      initialPrivateState: createTrueMaskPrivateState(),
    });
    return new TrueMaskAPI(deployedContract, providers, logger);
  }
}

/** What a successful publish reports back, so the UI can show a real receipt. */
export interface SubmittedRecord {
  /** Transaction id assigned by the network. */
  readonly txId: string;
  /** Finalization status reported by the SDK. */
  readonly status: string;
  /** The contract the record now lives in. */
  readonly contractAddress: string;
}

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export * from './truemask-common-types.js';
export * as vision from './vision/index.js';
