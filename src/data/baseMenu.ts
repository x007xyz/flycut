interface MenuItem {
  title: string,
  key: string,
  active?: boolean,
  icon: string
}
const menuData: MenuItem[] = [
  { title: '资源', key: 'media', icon: 'icon-shangchuan_line' },
  { title: '文字', key: 'text', icon: 'icon-wenzi_line' }
];

export { menuData };
export type { MenuItem };