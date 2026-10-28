interface SoundOwner {
  stop(): void;
}

let activeSound: SoundOwner | null = null;

/** A new foreground alert replaces the previous alert instead of mixing long sounds. */
export function claimNotificationSound(stop: () => void): () => void {
  const previous = activeSound;
  activeSound = null;
  previous?.stop();
  const owner = { stop };
  activeSound = owner;
  return () => {
    if (activeSound === owner) activeSound = null;
  };
}
