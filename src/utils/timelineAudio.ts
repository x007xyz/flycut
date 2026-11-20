import { AudioBufferSink } from 'mediabunny';
import type { Input, WrappedAudioBuffer } from 'mediabunny';
import { AudioTrack } from '@/class/AudioTrack';
import { VideoTrack } from '@/class/VideoTrack';
import type { Track } from '@/class/Track';
import { baseFps } from '@/data/trackConfig';
import { openMedia } from './timelineVideo';

export const audioSampleRate = 48000;
export const samplesPerFrame = audioSampleRate / baseFps;

/* eslint-disable no-await-in-loop -- keep a bounded number of decoded packets in memory */
export function createAudioMixer() {
  const inputs = new Map<File, Input>();
  const clips: ((startSample: number, mix: AudioBuffer) => Promise<void>)[] = [];

  return {
    async add(track: Track) {
      if (!(track instanceof AudioTrack || track instanceof VideoTrack) || track.silent || track.start >= track.end) return;
      const file = track.source.file;
      let input = inputs.get(file);
      if (!input) {
        input = openMedia(file);
        inputs.set(file, input);
      }
      const audio = await input.getPrimaryAudioTrack();
      if (!audio) return;
      if (!await audio.canDecode()) throw new Error(`无法解码音频：${track.name}。可将该片段静音后重试。`);

      const zero = Math.max(0, await input.getFirstTimestamp());
      const sourceStart = zero + track.offsetL / baseFps;
      const clipStart = Math.round(track.start * samplesPerFrame);
      const clipEnd = Math.round(track.end * samplesPerFrame);
      const packets = new AudioBufferSink(audio).buffers(sourceStart, sourceStart + (track.end - track.start) / baseFps);
      const state = { packet: null as WrappedAudioBuffer | null, ended: false };
      clips.push(async(startSample, mix) => {
        const from = Math.max(clipStart, startSample);
        const to = Math.min(clipEnd, startSample + mix.length);
        if (from >= to || state.ended) return;

        while (!state.ended) {
          if (!state.packet) {
            const { value } = await packets.next();
            // eslint-disable-next-line require-atomic-updates -- only the export loop calls the mixer
            state.packet = value ?? null;
            if (!state.packet) {
              state.ended = true;
              break;
            }
          }
          const { packet } = state;
          const at = clipStart + Math.round((packet.timestamp - sourceStart) * audioSampleRate);
          const end = at + Math.round(packet.buffer.duration * audioSampleRate);
          if (at >= to) break;
          const step = packet.buffer.sampleRate / audioSampleRate;
          for (let channel = 0; channel < mix.numberOfChannels; channel++) {
            const source = packet.buffer.getChannelData(Math.min(channel, packet.buffer.numberOfChannels - 1));
            const output = mix.getChannelData(channel);
            for (let sample = Math.max(at, from); sample < Math.min(end, to); sample++) {
              const position = (sample - at) * step;
              const left = Math.min(source.length - 1, Math.floor(position));
              const fraction = position - left;
              output[sample - startSample] += source[left] + (source[Math.min(left + 1, source.length - 1)] - source[left]) * fraction;
            }
          }
          if (end > to) break;
          state.packet = null;
        }
      });
    },
    get hasAudio() {
      return clips.length > 0;
    },
    async mix(startSample: number, length: number) {
      const audio = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: audioSampleRate });
      for (const clip of clips) await clip(startSample, audio);
      for (let channel = 0; channel < audio.numberOfChannels; channel++) {
        const output = audio.getChannelData(channel);
        for (let i = 0; i < output.length; i++) output[i] = Math.min(1, Math.max(-1, output[i]));
      }
      return audio;
    },
    dispose() {
      for (const input of inputs.values()) input.dispose();
      inputs.clear();
    }
  };
}
