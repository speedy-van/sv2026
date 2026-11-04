import { useEffect, useState } from 'react';
import type { MailAttachmentContent } from '@/data/mail';
import { AppText, Button, Card } from './primitives';

interface DownloadLink {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}
const browserRuntime = globalThis as {
  document?: { createElement(tag: 'a'): DownloadLink; body: { appendChild(link: DownloadLink): void } };
};

export function MailAttachment({
  content,
  onClose,
}: {
  content: MailAttachmentContent;
  onClose: () => void;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const image = ['image/jpeg', 'image/png', 'image/webp'].includes(content.contentType);
  useEffect(() => {
    let active = true;
    let localUrl: string | undefined;
    async function prepare(): Promise<void> {
      try {
        const response = await fetch(`data:${content.contentType};base64,${content.base64}`);
        const blob = await response.blob();
        if (!active) return;
        localUrl = URL.createObjectURL(blob);
        setUrl(localUrl);
      } catch {
        if (active) setError('The attachment could not be prepared. Close it and retry.');
      }
    }
    void prepare();
    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [content]);
  function download(): void {
    if (!url || !browserRuntime.document) return;
    const link = browserRuntime.document.createElement('a');
    link.href = url;
    link.download = content.filename;
    browserRuntime.document.body.appendChild(link);
    link.click();
    link.remove();
  }
  return (
    <Card>
      <AppText weight="bold">{content.filename}</AppText>
      {error ? (
        <AppText accessibilityRole="alert" tone="danger">
          {error}
        </AppText>
      ) : null}
      {url && image ? (
        <img
          src={url}
          alt={content.filename}
          style={{ maxHeight: 360, maxWidth: '100%', objectFit: 'contain' }}
        />
      ) : null}
      {url && content.contentType === 'application/pdf' ? (
        <iframe
          src={url}
          title={`PDF preview: ${content.filename}`}
          sandbox=""
          style={{ width: '100%', height: 360, border: 0 }}
        />
      ) : null}
      {content.contentType === 'text/plain' ? (
        <AppText selectable>
          {new TextDecoder().decode(
            Uint8Array.from(atob(content.base64), (character) => character.charCodeAt(0)),
          )}
        </AppText>
      ) : null}
      <Button label="Download attachment" disabled={!url} onPress={download} />
      <Button label="Close attachment" tone="secondary" onPress={onClose} />
    </Card>
  );
}
