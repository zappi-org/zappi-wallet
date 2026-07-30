export function LoadingFallback() {
  return (
    <div className="h-full bg-background flex flex-col items-center justify-center gap-3">
      <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <p className="text-caption text-foreground-muted font-medium">Loading...</p>
    </div>
  )
}

export default LoadingFallback
