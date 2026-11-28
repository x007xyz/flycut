/* global FileSystemDirectoryHandle, FileSystemHandle, BufferSource, CompressionStream, DecompressionStream */
/* eslint-disable no-await-in-loop -- directory entries are read one by one */
type Data = Blob | BufferSource | string;

let root: Promise<FileSystemDirectoryHandle> | undefined;

/** 所有数据都放在 OPFS 的 flycut/ 目录下，避免与其他临时文件混在一起 */
export function flycutRoot() {
  root ??= navigator.storage.getDirectory().then(dir => dir.getDirectoryHandle('flycut', { create: true }));
  root.catch(() => {
    root = undefined;
  });
  return root;
}

export async function directory(path: string[], create = true) {
  let dir = await flycutRoot();
  for (const name of path) dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}

export async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Data | ReadableStream<Uint8Array>) {
  const handle = await dir.getFileHandle(name, { create: true });
  // createWritable 先写入临时文件，close 时原子替换
  const writable = await handle.createWritable();
  try {
    if (data instanceof ReadableStream) await data.pipeTo(writable);
    else {
      await writable.write(data);
      await writable.close();
    }
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export async function readFile(dir: FileSystemDirectoryHandle, name: string) {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  const file = await readFile(dir, name);
  return file ? JSON.parse(await file.text()) as T : null;
}

export async function childDirectories(dir: FileSystemDirectoryHandle) {
  const names: string[] = [];
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind === 'directory') names.push(name);
  }
  return names;
}

export async function removeEntry(dir: FileSystemDirectoryHandle, name: string) {
  await dir.removeEntry(name, { recursive: true }).catch(error => {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  });
}

export async function gzip(text: string) {
  const stream = new Blob([text]).stream()
.pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function gunzip(blob: Blob) {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
