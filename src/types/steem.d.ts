/**
 * Minimal type surface for `steem` (steem-js 0.7.11) — the battle-tested
 * signing/broadcast library that anchored every historic SAOS weave op
 * on-chain (agent/anchor.cjs · agent/weave_batch.cjs).
 */
declare module "steem" {
  export interface SignedTransaction {
    ref_block_num: number;
    ref_block_prefix: number;
    expiration: string;
    operations: unknown[];
    extensions: unknown[];
    signatures: string[];
  }

  export interface BroadcastConfirmation {
    id?: string;
    block_num?: number;
    trx_num?: number;
  }

  export interface DynamicGlobalProperties {
    head_block_number: number;
    head_block_id: string;
    time: string;
  }

  export const auth: {
    isWif(wif: string): boolean;
    wifToPublic(wif: string): string;
    isPubkey(pub: string): boolean;
    signTransaction(
      tx: Record<string, unknown>,
      wifs: string[]
    ): SignedTransaction;
  };

  export const api: {
    setOptions(opts: { url?: string; transport?: string; websocket?: string }): void;
    getDynamicGlobalPropertiesAsync(): Promise<DynamicGlobalProperties>;
    getAccountHistoryAsync(
      account: string,
      start: number,
      limit: number
    ): Promise<Array<[number, { op: [string, Record<string, unknown>]; trx_id: string }]>>;
  };

  /** Graphene authority (owner/active/posting) — {weight, key_auths}. */
  export interface ChainAuthority {
    weight_threshold: number;
    account_auths: Array<[string, number]>;
    key_auths: Array<[string, number]>;
  }

  export const broadcast: {
    sendAsync(
      tx: Record<string, unknown>,
      wifs: string[]
    ): Promise<BroadcastConfirmation>;
    /** v41 — account recovery: signed by BOTH the old owner and the new
     *  owner authority keys ([oldWif, newWif]). */
    recoverAccount(
      wifs: string | string[],
      accountToRecover: string,
      newOwnerAuthority: ChainAuthority,
      recentOwnerAuthority: ChainAuthority,
      extensions: unknown[],
      callback?: (err: Error | null | undefined, result?: BroadcastConfirmation) => void
    ): void;
    /** v41 — post-recovery rotation of active/posting/memo (owner-signed). */
    accountUpdate(
      wif: string,
      account: string,
      active?: ChainAuthority,
      posting?: ChainAuthority,
      memoKey?: string,
      jsonMetadata?: string,
      extensions?: unknown[],
      callback?: (err: Error | null | undefined, result?: BroadcastConfirmation) => void
    ): void;
    /** v41 — move the trustee to a sovereign account (30-day delay). */
    changeRecoveryAccount(
      wif: string,
      accountToRecover: string,
      newRecoveryAccount: string,
      extensions?: unknown[],
      callback?: (err: Error | null | undefined, result?: BroadcastConfirmation) => void
    ): void;
  };

  export const config: {
    get(key: string): string;
    set(key: string, value: string): void;
  };
}
