type ExportVideoCodec = 'avc' | 'vp9' | 'vp8';
type ExportAudioCodec = 'aac' | 'opus';
type ExportFormat = {
  extension: 'mp4' | 'webm';
  video: ExportVideoCodec;
  audio?: ExportAudioCodec;
};

export async function chooseExportFormat(
  hasAudio: boolean,
  canEncodeVideo: (codec: ExportVideoCodec) => Promise<boolean>,
  canEncodeAudio: (codec: ExportAudioCodec) => Promise<boolean>
): Promise<ExportFormat> {
  if (await canEncodeVideo('avc') && (!hasAudio || await canEncodeAudio('aac'))) {
    return { extension: 'mp4', video: 'avc', audio: hasAudio ? 'aac' : undefined };
  }

  if (!hasAudio || await canEncodeAudio('opus')) {
    const audio = hasAudio ? 'opus' : undefined;
    if (await canEncodeVideo('vp9')) return { extension: 'webm', video: 'vp9', audio };
    if (await canEncodeVideo('vp8')) return { extension: 'webm', video: 'vp8', audio };
  }
  throw new Error('当前浏览器无法以此分辨率编码项目所需的视频和音频。请尝试更新 Chrome 或 Edge 后重试。');
}
