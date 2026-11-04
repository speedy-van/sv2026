import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { uuid } from 'expo-modules-core';
import * as Sentry from '@sentry/react-native';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MailAttachmentContent } from '@/data/mail';
import { AppText, Button, Card } from './primitives';

export function MailAttachment({
  content,
  onClose,
}: {
  content: MailAttachmentContent;
  onClose: () => void;
}): React.ReactElement {
  const [uri, setUri] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const image = ['image/jpeg', 'image/png', 'image/webp'].includes(content.contentType);
  const pdf = content.contentType === 'application/pdf';
  useEffect(() => {
    let active = true;
    let path: string | undefined;
    async function prepare(): Promise<void> {
      try {
        if (!FileSystem.cacheDirectory) throw new Error('File storage is unavailable on this device.');
        const safeName = content.filename.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'attachment';
        path = `${FileSystem.cacheDirectory}sv-mail-${uuid.v4()}-${safeName}`;
        await FileSystem.writeAsStringAsync(path, content.base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const plain = content.contentType === 'text/plain' ? await FileSystem.readAsStringAsync(path) : null;
        if (active) {
          setUri(path);
          setText(plain);
        } else await FileSystem.deleteAsync(path, { idempotent: true });
      } catch {
        if (active) setError('The attachment could not be prepared. Close it and try again.');
      }
    }
    void prepare();
    return () => {
      active = false;
      if (path)
        void FileSystem.deleteAsync(path, { idempotent: true }).catch((cause: unknown) => {
          Sentry.captureException(cause, { tags: { feature: 'mail-file-cleanup' } });
        });
    };
  }, [content, image, pdf]);
  async function share(): Promise<void> {
    if (!uri || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
      await Sharing.shareAsync(uri, { mimeType: content.contentType, dialogTitle: content.filename });
    } catch {
      setError('The attachment could not be shared. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <AppText accessibilityRole="header" weight="bold">
        {content.filename}
      </AppText>
      <AppText muted size="sm">
        {Math.ceil(content.size / 1024)} KB · {content.contentType}
      </AppText>
      {error ? (
        <AppText accessibilityRole="alert" tone="danger">
          {error}
        </AppText>
      ) : null}
      {!uri && !error ? <AppText accessibilityRole="progressbar">Preparing attachment…</AppText> : null}
      {uri && image ? (
        <Image
          accessibilityLabel={content.filename}
          source={{ uri }}
          resizeMode="contain"
          style={styles.preview}
          onError={() => {
            setError('This image could not be displayed. You can share the file instead.');
          }}
        />
      ) : null}
      {uri && pdf ? (
        <View style={styles.preview}>
          <WebView
            accessibilityLabel={`PDF preview: ${content.filename}`}
            source={{ uri }}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(request) => request.url === uri || request.url === 'about:blank'}
            javaScriptEnabled={false}
            javaScriptCanOpenWindowsAutomatically={false}
            domStorageEnabled={false}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            incognito
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            allowingReadAccessToURL={uri}
            onError={() => {
              setError('This PDF could not be displayed. You can share the file instead.');
            }}
            onOpenWindow={() => {
              setError('Links are disabled in attachment previews.');
            }}
          />
        </View>
      ) : null}
      {text !== null ? <AppText selectable>{text}</AppText> : null}
      {uri && !image && !pdf && text === null ? (
        <AppText>Preview is unavailable for this file type.</AppText>
      ) : null}
      <Button
        label="Share or save attachment"
        loading={busy}
        disabled={!uri}
        onPress={() => {
          void share();
        }}
      />
      <Button label="Close attachment" tone="secondary" disabled={busy} onPress={onClose} />
    </Card>
  );
}
const styles = StyleSheet.create({ preview: { height: 360, width: '100%' } });
