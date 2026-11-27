import { mappingFormItem } from '@/utils/formItemUtils';
import { animationEases, animationPresets, type AnimationKind } from '@/render/animation';

const titles: Record<AnimationKind, string> = { in: '入场', out: '出场', loop: '循环' };

// 视频、图片、文字共用的动画设置
export const animationItems = (['in', 'out', 'loop'] as AnimationKind[]).map(kind => mappingFormItem('Collapse', {
    children: [
        mappingFormItem('CollapsePane', {
            name: titles[kind],
            children: [
                mappingFormItem('Select', { name: '效果', mappingKey: `animations.${kind}.preset`, options: animationPresets[kind] }),
                mappingFormItem('Slider', {
                    attr: { min: 0.1, max: kind === 'loop' ? 5 : 3, step: 0.1 },
                    name: kind === 'loop' ? '周期' : '时长', mappingKey: `animations.${kind}.duration`, label: 's'
                }),
                mappingFormItem('Select', { name: '缓动', mappingKey: `animations.${kind}.ease`, options: animationEases })
            ]
        })
    ]
}));
