import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type BoundingBox = { x: bigint; y: bigint; width: bigint; height: bigint
                          };

export type Witnesses<PS> = {
  get_original_image_hash(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  get_redaction_boxes(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, BoundingBox[]];
}

export type ImpureCircuits<PS> = {
  verify_image(context: __compactRuntime.CircuitContext<PS>,
               redacted_hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  verify_image(context: __compactRuntime.CircuitContext<PS>,
               redacted_hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  verify_image(context: __compactRuntime.CircuitContext<PS>,
               redacted_hash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  verified_images: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
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
