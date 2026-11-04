import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { View } from 'react-native';
import { MailAttachment } from '../src/components/mail-attachment';
import { MailHtml } from '../src/components/mail-html';
import { mailContent } from './mail-fixtures';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  readAsStringAsync: jest.fn(() => Promise.resolve('Attachment text')),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-webview', () => ({ WebView: (props: unknown) => mockWebView(props) }));
const mockWebView = jest.fn((props: unknown) => (
  <View
    testID="mail-webview"
    accessibilityLabel={
      typeof props === 'object' && props && 'accessibilityLabel' in props
        ? String(props.accessibilityLabel)
        : 'preview'
    }
  />
));
beforeEach(() => {
  jest.clearAllMocks();
});

it('prepares an authenticated attachment locally, shares it, and removes the temporary file on close', async () => {
  const close = jest.fn();
  const view = await render(<MailAttachment content={mailContent} onClose={close} />);
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Share or save attachment' })).toBeEnabled();
  });
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/cache\/sv-mail-.*-move\.pdf$/u),
    mailContent.base64,
    { encoding: 'base64' },
  );
  await fireEvent.press(view.getByRole('button', { name: 'Share or save attachment' }));
  expect(Sharing.shareAsync).toHaveBeenCalledWith(expect.stringMatching(/move\.pdf$/u), {
    mimeType: 'application/pdf',
    dialogTitle: 'move.pdf',
  });
  await view.unmount();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.stringMatching(/move\.pdf$/u), {
    idempotent: true,
  });
});

it('disables scripting and only permits the exact local PDF preview URL', async () => {
  const view = await render(<MailAttachment content={mailContent} onClose={jest.fn()} />);
  await waitFor(() => {
    expect(view.getByTestId('mail-webview')).toBeTruthy();
  });
  const props = mockWebView.mock.calls.at(-1)?.[0];
  expect(props).toEqual(
    expect.objectContaining({
      javaScriptEnabled: false,
      domStorageEnabled: false,
      sharedCookiesEnabled: false,
      allowUniversalAccessFromFileURLs: false,
    }),
  );
  if (
    typeof props !== 'object' ||
    !props ||
    !('onShouldStartLoadWithRequest' in props) ||
    typeof props.onShouldStartLoadWithRequest !== 'function'
  )
    throw new Error('Navigation guard missing');
  const guard = props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
  expect(guard({ url: 'https://outside.example.test' })).toBe(false);
  expect(guard({ url: 'file:///cache/another-user.pdf' })).toBe(false);
});

it('blocks external HTML navigation and adds a no-network content policy with scripts disabled', async () => {
  await render(<MailHtml html="<p>Email body</p>" text="Email body" />);
  const props = mockWebView.mock.calls.at(-1)?.[0];
  expect(props).toEqual(
    expect.objectContaining({
      javaScriptEnabled: false,
      allowFileAccess: false,
      sharedCookiesEnabled: false,
      incognito: true,
    }),
  );
  if (
    typeof props !== 'object' ||
    !props ||
    !('onShouldStartLoadWithRequest' in props) ||
    typeof props.onShouldStartLoadWithRequest !== 'function' ||
    !('source' in props)
  )
    throw new Error('HTML guard missing');
  const guard = props.onShouldStartLoadWithRequest as (request: { url: string }) => boolean;
  expect(guard({ url: 'about:blank' })).toBe(true);
  expect(guard({ url: 'https://outside.example.test' })).toBe(false);
  const source = props.source;
  if (typeof source !== 'object' || !source || !('html' in source) || typeof source.html !== 'string')
    throw new Error('HTML source missing');
  expect(source.html).toContain("default-src 'none'");
});

it('shows sharing failures and still allows the user to close the attachment', async () => {
  jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('Share unavailable'));
  const close = jest.fn();
  const view = await render(<MailAttachment content={mailContent} onClose={close} />);
  await waitFor(() => {
    expect(view.getByRole('button', { name: 'Share or save attachment' })).toBeEnabled();
  });
  await act(async () => {
    await fireEvent.press(view.getByRole('button', { name: 'Share or save attachment' }));
  });
  expect(view.getByText('The attachment could not be shared. Try again.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Close attachment' }));
  expect(close).toHaveBeenCalled();
});
