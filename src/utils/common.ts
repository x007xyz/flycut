import { baseFps } from '@/data/trackConfig';

// 生成 16 进制指定长度的字符串
function getRandom(len: number) {
    return Math.floor((1 + Math.random()) * (16 ** len))
        .toString(16)
        .substring(1);
}
/**
 *  时间格式化
 * */
export function formatTime(time: number) {
    let second = Math.ceil(time / 1000);
    const s = second % 60;
    second = Math.floor(second / 60);
    const m = second % 60;
    second = Math.floor(second / 60);
    const h = second % 60;
    return {
        s,
        m,
        h,
        str: `${h === 0 ? '' : `${h < 10 ? '0' : ''}${h}:`}${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
    };
}
export function formatPlayerTime(frameCount: number) {
    let f = Math.round(frameCount % 30);
    frameCount = Math.floor(frameCount / 30);
    let s = frameCount % 60;
    frameCount = Math.floor(frameCount / 60);
    let m = frameCount % 60;
    frameCount = Math.floor(frameCount / 60);
    let h = frameCount;
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}:${f < 10 ? '0' : ''}${f}`;
}
/**
 *  获取随机ID，组件拖到预览视图后就会被设置个ID
 * */
export function getId(prefix = 't') {
    return `${prefix ? `${prefix}-` : ''}${getRandom(5)}${getRandom(3)}-${getRandom(4)}`;
}
/**
 * 下载文件
 * */
export function downloadFileUrl(href: string, fileName: string) {
    const downloadElement = document.createElement('a');
    downloadElement.href = href;
    // 下载后文件名
    downloadElement.download = fileName;
    document.body.appendChild(downloadElement);
    downloadElement.click();
    document.body.removeChild(downloadElement);
    // 释放掉blob对象
    window.URL.revokeObjectURL(href);
    downloadElement.href = '';
}
/**
 * 根据中心点计算左上角顶点位置
 */
export function calcLeftTopByCenter(center: { x: number, y: number }, width: number, height: number) {
    return {
        left: center.x - width / 2,
        top: center.y - height / 2
    };
}

// 获取canvas中文本应该显示的宽高
// export function getTextRect({ text = 'Hello World', fontSize = 40 }) {
//     const canvas = document.createElement('canvas');
//     const ctx = canvas.getContext('2d');
//     if (ctx) {
//         ctx.font = `${fontSize}px -apple-system, ".SFNSText-Regular", "SF UI Text", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", "WenQuanYi Zen Hei", "Microsoft YaHei", Arial, sans-serif`;
//         const metrics = ctx.measureText(text);
//         return {
//             width: metrics.actualBoundingBoxRight + metrics.actualBoundingBoxLeft,
//             height: fontSize * 1.2
//         };
//     }
//     return null;
// }

export function getTextRect({ text = 'Hello World', fontSize = 40, fontFamily }: { text: string, fontSize: number, fontFamily: string }) {
    const padding = 4;
    const canvas = new OffscreenCanvas(1000, 1000);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Canvas 2D context is not supported');
    }

    const lines = text.split('\n');
    ctx.font = `${fontSize}px ${fontFamily}`;
    const lineHeight = fontSize * 1.2; // Adjust line height as needed

    // Measure the widest line
    const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));

    // Calculate total height
    const totalHeight = lines.length * lineHeight;

    return {
        width: textWidth + padding * 2,
        height: totalHeight + padding * 2,
        lineHeight,
        lines
    };
}

export function calcTrackItemAttr(trackItem: Record<string, any>, canvasSize: { width: number, height: number }, trackAttr: Record<string, any> = {}) {
    const { width: sourceWidth, height: sourceHeight, type, text = '默认文本', fontSize = 40, style } = trackItem;
    const { width: playerW, height: playerH } = canvasSize;
    let defaultW = playerW;
    let defaultH = playerH;
    if (['image', 'video'].includes(type)) {
        const proportionalW = Math.floor(playerH / sourceHeight * sourceWidth); // 等高宽度
        const proportionalH = Math.floor(playerW / sourceWidth * sourceHeight); // 等宽高度
        // 默认渲染位置
        if (proportionalW > playerW) { // 等高场景下宽度溢出，则采用等宽， 高度上下留白
            defaultH = proportionalH;
        } else if (proportionalH > playerH) { // 等宽场景下高度溢出，则采用等高， 宽度左右留白
            defaultW = proportionalW;
        }

        if (sourceHeight < defaultH && sourceWidth < defaultW) {
            defaultW = sourceWidth;
            defaultH = sourceHeight;
        }
    }

    if (type === 'text') {
        const rect = getTextRect({ text, fontSize });
        console.log('🚀 ~ calcTrackItemAttr ~ rect:', rect);
        if (rect) {
            defaultW = rect.width;
            defaultH = rect.height;
        }
    }
    return {
        width: defaultW,
        height: defaultH,
        centerX: 0,
        centerY: 0,
        scale: 100,
        drawWidth: defaultW,
        drawHeight: defaultH,
        text,
        fontSize,
        // color: style.fill,
        style
    };
}

export function computedItemShowArea(trackItem: Record<string, any>, canvasSize: { width: number, height: number }, trackAttr: Record<string, any>) {
    let { left = 0, top = 0, scale = 100, text, fontSize } = trackAttr;
    const { width, height, type } = trackItem;
    const { width: playerW, height: playerH } = canvasSize;
    let defaultW = playerW;
    let defaultH = playerH;
    if (type === 'video') {
        const proportionalW = Math.floor(playerH / height * width); // 等高宽度
        const proportionalH = Math.floor(playerW / width * height); // 等宽高度
        // 默认渲染位置
        if (proportionalW > playerW) { // 等高场景下宽度溢出，则采用等宽， 高度上下留白
            defaultH = proportionalH;
        } else if (proportionalH > playerH) { // 等宽场景下高度溢出，则采用等高， 宽度左右留白
            defaultW = proportionalW;
        }
    }
    if (type === 'image') {
        defaultW = width;
        defaultH = width;
    }
    if (type === 'text') {
        defaultW = text.length * fontSize;
        defaultH = fontSize * 1.2;
    }
    // 由默认位置计算偏移缩放位置
    const scaleW = Math.floor(defaultW * scale / 100);
    const scaleH = Math.floor(defaultH * scale / 100);
    const scaleL = Math.floor(left + (defaultW - scaleW) / 2);
    const scaleT = Math.floor(top + (defaultH - scaleH) / 2);
    const diffW = Math.floor(playerW - scaleW);
    const diffH = Math.floor(playerH - scaleH);
    return {
        drawL: scaleL,
        drawT: scaleT,
        drawW: scaleW,
        drawH: scaleH,
        sourceWidth: width,
        sourceHeight: height,
        defaultW,
        defaultH,
        diffW,
        diffH
    };
}
export function isVideo(type: string) {
    return type === 'video';
}
// 封装json格式化, 避免error
export function getJsonParse(jsonStr: string): any {
    let res = '';
    try {
        res = JSON.parse(jsonStr);
    } catch (e) {
        console.log(e);
        res = '';
    }
    return res;
}

export const file2ArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => {
            resolve(e.target?.result as ArrayBuffer);
        };
        reader.readAsArrayBuffer(file);
    });
};

export const file2Unit8Stream = async(file: File): Promise<ReadableStream<Uint8Array>> => {
    const unit8Array = new Uint8Array(await file2ArrayBuffer(file));
    // 创建一个空的 ReadableStream
    return new ReadableStream({
        start(controller) {
            // 使用 enqueue 方法将 Uint8Array 推送到 ReadableStream
            controller.enqueue(unit8Array);

            // 关闭 ReadableStream，表示没有更多的数据会被推送
            controller.close();
        }
    });
};
/**
 * 获取当前字幕
 * @param asr 
 * @param frame 
 */
export const getCurSubtitle = (asr: { beginTime: number, endTime: number, text: string }[], frame: number) => {
    // 将frame转换为当前时间
    const time = frame * 1000 / baseFps;
    // 当time在beginTime和endTime之间时，返回当前字幕
    for (let i = 0; i < asr.length; i++) {
        const { beginTime, endTime, text } = asr[i];
        if (time >= beginTime && time <= endTime) {
            return text;
        }
    }
    return '';
};

/**
 * 精确计时器
 * @param callback 
 * @param interval 
 * @returns 
 */
export function preciseInterval(callback: () => void, interval: number) {
    let expected = performance.now() + interval;
    let stop = false;

    function step(timestamp: number) {
        if (stop) return;

        if (timestamp >= expected) {
            callback();
            // 累积期望的时间，以保持精确的间隔
            expected += interval;
        }

        requestAnimationFrame(step);
    }

    requestAnimationFrame(step);

    // 返回一个对象包含取消方法
    return {
        cancel: () => {
            stop = true;
        }
    };
}
