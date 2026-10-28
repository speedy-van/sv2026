import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Custom navigation/composers do not inherit the default tab bar's keyboard handling. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      setVisible(true);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setVisible(false);
    });
    setVisible(Keyboard.isVisible());
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
