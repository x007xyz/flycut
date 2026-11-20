type VideoOutput = () => ReadableStream<Uint8Array>;
type ChooseDestination = () => Promise<WritableStream | undefined>;

export async function saveRenderedVideo(render: VideoOutput, chooseDestination: ChooseDestination) {
  const directory = await navigator.storage.getDirectory();
  const name = `flycut-export-${crypto.randomUUID()}.mp4`;
  const tempFile = await directory.getFileHandle(name, { create: true });
  try {
    const staging = await tempFile.createWritable();
    try {
      await render().pipeTo(staging);
    } catch (error) {
      await staging.abort().catch(() => {});
      throw error;
    }
    const video = await tempFile.getFile();
    if (video.size === 0) throw new Error('The video render produced no data');

    const destination = await chooseDestination();
    if (!destination) return false;
    await video.stream().pipeTo(destination);
    return true;
  } finally {
    await directory.removeEntry(name).catch(error => console.warn('Could not remove temporary export', error));
  }
}
