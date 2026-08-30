/**
 * Shared business logic for the TrueMask contract.
 *
 * Platform-agnostic — works from browser (Lace) or CLI (wallet-sdk).
 * Each platform provides its own provider implementations.
 *
 * @packageDocumentation
 */

import { TrueMask } from 'truemask-contract';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { map, type Observable } from 'rxjs';
import {
  CompiledTrueMaskContract,
  createTrueMaskPrivateState,
  stageRedactionWitness,
  clearRedactionWitness,
} from 'truemask-contract';
import {
  type TrueMaskProviders,
  type TrueMaskDerivedState,
  type RedactionRecordView,
  type DeployedTrueMaskContract,
  trueMaskPrivateStateKey,
} from './truemask-common-types.js';
import type { RedactionResult } from './vision/types.js';


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
