export interface TrustedAccountStore {
  getTrustedAccounts(): Promise<string[]>
  addTrustedAccount(accountId: string): Promise<string[]>
}
