import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Screen, AppText } from '@/components/primitives';
import { compressPhoto, type CompressedPhoto } from '@/media/photos';

export default function CameraScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const bookingId = params.id ?? '';
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  if (!permission?.granted) {
    return (
      <Screen title="Camera">
        <Card>
          <AppText muted>Camera permission is required for before, after and issue evidence.</AppText>
          <Button label="Enable camera" onPress={() => { void requestPermission(); }} />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen title="Evidence photo" subtitle={bookingId}>
      <View style={styles.cameraFrame}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
      </View>
      <Card>
        <Button
          label="Take photo"
          onPress={() => {
            void camera.current?.takePictureAsync({ quality: 0.7 }).then(async (captured) => {
              if (!captured.uri) return;
              setPhoto(await compressPhoto(captured.uri));
            });
          }}
        />
        <AppText muted>{photo ? `Compressed ${String(photo.width ?? 0)}x${String(photo.height ?? 0)}` : 'Photo will be compressed before upload.'}</AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: {
    aspectRatio: 3 / 4,
    borderRadius: 8,
    overflow: 'hidden'
  }
});
