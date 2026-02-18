export function LoadingFallback() {
  return (
    <div className="h-dvh bg-background flex flex-col items-center justify-center gap-3">
      <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      <p className="text-sm text-foreground/60 font-medium">Loading...</p>
    </div>
  )
}

export default LoadingFallback
