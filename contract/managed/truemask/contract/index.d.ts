import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type RedactionRecord = { preserved_root: Uint8Array;
                                authorization_commitment: Uint8Array;
                                cols: bigint;
                                rows: bigint;
                                block_size: bigint;
                                verified: boolean
                              };

export type Witnesses<PS> = {
  get_published_lane_digests(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array[]];
  get_original_lane_digests(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array[]];
}

export type ImpureCircuits<PS> = {
  submit_redaction(context: __compactRuntime.CircuitContext<PS>,
                   redacted_hash_0: Uint8Array,
                   authorization_commitment_0: Uint8Array,
                   cols_0: bigint,
                   rows_0: bigint,
                   block_size_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verify_integrity(context: __compactRuntime.CircuitContext<PS>,
                   redacted_hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  submit_redaction(context: __compactRuntime.CircuitContext<PS>,
                   redacted_hash_0: Uint8Array,
                   authorization_commitment_0: Uint8Array,
                   cols_0: bigint,
                   rows_0: bigint,
                   block_size_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verify_integrity(context: __compactRuntime.CircuitContext<PS>,
                   redacted_hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  compute_preserved_root(lanes_0: Uint8Array[]): Uint8Array;
}

export type Circuits<PS> = {
  compute_preserved_root(context: __compactRuntime.CircuitContext<PS>,
                         lanes_0: Uint8Array[]): __compactRuntime.CircuitResults<PS, Uint8Array>;
  submit_redaction(context: __compactRuntime.CircuitContext<PS>,
                   redacted_hash_0: Uint8Array,
                   authorization_commitment_0: Uint8Array,
                   cols_0: bigint,
                   rows_0: bigint,
                   block_size_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verify_integrity(context: __compactRuntime.CircuitContext<PS>,
                   redacted_hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  records: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): RedactionRecord;
    [Symbol.iterator](): Iterator<[Uint8Array, RedactionRecord]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
