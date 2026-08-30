/**
 * Witness implementations for `leaderboard.compact`.
 *
 * NOT PART OF TRUEMASK. The leaderboard is tutorial contract code inherited from
 * the project template; it is kept because it compiles, is covered by tests, and
 * documents the witness/private-state pattern the TrueMask witnesses follow. The
 * product's witnesses live in `truemask-witnesses.ts`.
 *
 * A witness runs on the prover's own machine. Whatever it returns enters the ZK
 * circuit as a private input and is never published unless the contract wraps it
 * in `disclose()`.
 */

/** Private state the leaderboard keeps per contract: the player's secret key. */
export type LeaderboardPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createLeaderboardPrivateState = (secretKey: Uint8Array): LeaderboardPrivateState => ({
  secretKey,
});

/**
 * The display name for the next `submitScore` call.
 *
 * Module-level rather than part of the private state because the private state
 * is stored per contract while the name is chosen per submission. `TrueMaskAPI`
 * uses the same staging pattern for lane digests — see `stageRedactionWitness`.
 */
let _customName = new Uint8Array(32);

/** Stage the display name to be used by the next circuit call. Truncated to 32 bytes. */
export const setCustomName = (name: string): void => {
  _customName = new Uint8Array(32);
  _customName.set(new TextEncoder().encode(name).slice(0, 32));
};

/**
 * Build the witness object the compiled contract expects.
 *
 * Each witness receives the current private state and returns
 * `[nextPrivateState, value]`. Neither of these mutates the state — the
 * leaderboard's secret key is read-only for the life of the contract.
 */
export const createWitnesses = () => ({
  /** The player's secret key. Never disclosed; only its hash reaches the ledger. */
  localSecretKey: ({
    privateState,
  }: {
    privateState: LeaderboardPrivateState;
  }): [LeaderboardPrivateState, Uint8Array] => [privateState, privateState.secretKey],
  /** The name staged by `setCustomName`, or 32 zero bytes if none was staged. */
  getCustomName: ({
    privateState,
  }: {
    privateState: LeaderboardPrivateState;
  }): [LeaderboardPrivateState, Uint8Array] => [privateState, _customName],
});
