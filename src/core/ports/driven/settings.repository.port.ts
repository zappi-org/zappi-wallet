export interface SettingsRepository {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  getAll(): Promise<Record<string, unknown>>
}
