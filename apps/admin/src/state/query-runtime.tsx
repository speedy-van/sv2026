import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

/** Native apps have no browser visibility events for React Query to observe. */
export function QueryRuntime(): null {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const updateFocus = (state: string | null): void => {
      // Native state can be unknown during cold launch. Do not strand polling then.
      focusManager.setFocused(state !== 'background' && state !== 'inactive');
    };
    const appState = AppState.addEventListener('change', updateFocus);
    updateFocus(AppState.currentState);
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      onlineManager.setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return () => {
      appState.remove();
      unsubscribeNetwork();
      focusManager.setFocused(undefined);
    };
  }, []);
  return null;
}
