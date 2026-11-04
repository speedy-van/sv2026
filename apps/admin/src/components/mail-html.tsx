import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { AppText } from './primitives';

export interface MailHtmlProps {
  html: string;
  text: string;
}

export function MailHtml({ html }: MailHtmlProps): React.ReactElement {
  const [failed, setFailed] = useState(false);
  const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"></head><body>${html}</body></html>`;
  return (
    <View style={styles.frame}>
      {failed ? (
        <AppText accessibilityRole="alert">
          Formatted email could not be displayed. Use the plain text version.
        </AppText>
      ) : (
        <WebView
          accessibilityLabel="Formatted email, links disabled"
          source={{ html: page }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
          javaScriptEnabled={false}
          domStorageEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          incognito
          onError={() => {
            setFailed(true);
          }}
          onOpenWindow={() => {
            setFailed(true);
          }}
          style={styles.webview}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({ frame: { height: 320 }, webview: { flex: 1 } });
