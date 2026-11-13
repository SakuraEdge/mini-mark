const maximumBytes = 10 * 1024 * 1024;
const maximumPixels = 40_000_000;

export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  let width = 0, height = 0;
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 4) === 'PNG' && ascii(12, 16) === 'IHDR') {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = ascii(offset, offset + 4), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (size > bytes.length - start) break;
      if (type === 'VP8X' && size >= 10) {
        width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
        break;
      }
      if (type === 'VP8 ' && size >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
        width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
        break;
      }
      if (type === 'VP8L' && size >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        break;
      }
      offset = start + size + (size & 1);
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  }
  if (!width || !height) throw new Error('图片格式无效，请选择 PNG、JPEG 或 WebP。');
  if (width * height > maximumPixels || width > 32768 || height > 32768) throw new Error('图片尺寸过大，请使用不超过 4000 万像素的图片。');
  return { width, height };
}

export async function prepareBackground(file: File): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  if (!file.size || file.size > maximumBytes) throw new Error('背景图片需在 10 MB 以内。');
  imageDimensions(new Uint8Array(await file.arrayBuffer()));
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > maximumPixels) throw new Error('图片尺寸过大或无法读取。');
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理背景图片。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片转换失败。')), type, 0.9));
    let blob = await encode('image/webp');
    if (blob.size > 8 * 1024 * 1024) blob = await encode('image/jpeg');
    if (blob.size > 8 * 1024 * 1024) throw new Error('图片转换后仍过大，请使用较小的图片。');
    canvas.width = canvas.height = 1;
    return blob;
  } finally { image.src = ''; URL.revokeObjectURL(url); }
}
