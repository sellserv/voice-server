/**
 * Encode a slice of an AudioBuffer as a 16-bit PCM WAV (mono).
 */
export function encodeWavFromBuffer(buffer: AudioBuffer, startTime: number, endTime: number): Blob {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.round(startTime * sampleRate);
  const endSample = Math.round(endTime * sampleRate);
  const numSamples = endSample - startSample;
  const numChannels = 1; // mono mixdown

  // Mix channels down to mono
  const mono = new Float32Array(numSamples);
  const channelCount = buffer.numberOfChannels;
  for (let ch = 0; ch < channelCount; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      mono[i] += data[startSample + i];
    }
  }
  if (channelCount > 1) {
    for (let i = 0; i < numSamples; i++) {
      mono[i] /= channelCount;
    }
  }

  // Convert float [-1, 1] to 16-bit PCM
  const bytesPerSample = 2;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
