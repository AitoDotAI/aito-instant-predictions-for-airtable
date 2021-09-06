const tabs = ['train', 'predict'] as const
export type Tab = typeof tabs[number]
export const isTab = (name: any): name is Tab => tabs.includes(name)
