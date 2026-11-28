export const TrackHeightMap = new Map([
    ['video', 'h-16'],
    ['audio', 'h-12'],
    ['text', 'h-6'],
    ['image', 'h-6'],
    ['effect', 'h-6'],
    ['filter', 'h-6'],
    ['transition', 'h-6']
]);

export const baseFps = 30;

/**
 * 单位帧时间，毫秒
 */
export const UnitFrame2ms = 1e3 / baseFps;
/**
 * 单位帧时间，微秒
 */
export const UnitFrame2μs = 1e6 / baseFps;

