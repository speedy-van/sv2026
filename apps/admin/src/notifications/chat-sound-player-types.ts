export interface ChatSoundPlayer {
  failed: boolean;
  play: () => Promise<void>;
  stop: () => void;
}
