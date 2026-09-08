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
    setOptions(opts: { url?: string; transport?: string }): void;
    getDynamicGlobalPropertiesAsync(): Promise<DynamicGlobalProperties>;
    getAccountHistoryAsync(
      account: string,
      start: number,
      limit: number
    ): Promise<Array<[number, { op: [string, Record<string, unknown>]; trx_id: string }]>>;
  };

  export const broadcast: {
    sendAsync(
      tx: Record<string, unknown>,
      wifs: string[]
    ): Promise<BroadcastConfirmation>;
  };

  export const config: {
    get(key: string): string;
    set(key: string, value: string): void;
  };
}
