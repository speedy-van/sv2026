import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface CompressedPhoto {
  height?: number;
  uri: string;
  width?: number;
}

export async function compressPhoto(uri: string): Promise<CompressedPhoto> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
  return image.saveAsync({ compress: 0.72, format: SaveFormat.JPEG });
}
