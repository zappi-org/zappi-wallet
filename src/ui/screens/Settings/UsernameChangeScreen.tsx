import { ChangeUsernameSheet } from './ChangeUsernameSheet'

export interface UsernameChangeScreenProps {
  onBack: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

/**
 * Thin screen wrapper around the npubcash change-username bottom sheet.
 * Kept as a route target so navigation stays unchanged while the full-page
 * flow migrates to the bottom-sheet UX.
 */
export function UsernameChangeScreen({ onBack, onSaveSettings }: UsernameChangeScreenProps) {
  return (
    <div className="h-full bg-background text-foreground">
      <ChangeUsernameSheet isOpen onClose={onBack} onSaveSettings={onSaveSettings} />
    </div>
  )
}

export default UsernameChangeScreen
